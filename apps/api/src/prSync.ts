import { createLogger, isAppError } from '@cbi/shared';
import { REVIEW_VERSION } from '@cbi/pr-reviewer';
import { jobQueue } from './queue.js';
import { listAllRepos, type RepoRecord } from './services.js';
import { resolveGitHubAccess } from './github.js';
import { claimScheduled, hasBlockedComments, hasReviewForHead, recordPullRequest } from './prStore.js';

const log = createLogger({ component: 'pr-sync' });

/**
 * Polls GitHub for pull requests aimed at the configured base branch.
 *
 * The webhook is the fast path, but it only exists once the GitHub App is
 * installed on the repository — without it, PRs silently never got reviewed.
 * This poller is the safety net: any open PR against the repository's tracked
 * branch whose head sha has not been reviewed yet gets queued, exactly once.
 */

const DEFAULT_INTERVAL_MS = 180_000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let rateLimitedUntil = 0;

export function startPrSync(): void {
  if (timer || process.env.PR_SYNC_DISABLED === '1') return;
  const interval = Math.max(15_000, Number(process.env.PR_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS));
  timer = setInterval(() => void runOnce(), interval);
  timer.unref?.();
  // First pass shortly after boot: an already-open PR must not wait a whole
  // interval (webhooks only arrive once the App is installed).
  const kickoff = setTimeout(() => void runOnce(), 8_000);
  kickoff.unref?.();
  log.info('pr_sync.started', { intervalMs: interval });
}

export function stopPrSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runOnce(): Promise<{ checked: number; enqueued: number }> {
  if (running || Date.now() < rateLimitedUntil) return { checked: 0, enqueued: 0 };
  running = true;
  let checked = 0;
  let enqueued = 0;
  try {
    const repos = await listAllRepos();
    for (const repo of repos) {
      try {
        const result = await syncRepository(repo);
        checked += result.checked;
        enqueued += result.enqueued;
      } catch (e) {
        if (isAppError(e) && e.code === 'GITHUB_RATE_LIMITED') {
          rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
          log.warn('pr_sync.rate_limited', { backoffMs: RATE_LIMIT_BACKOFF_MS });
          break;
        }
        log.warn('pr_sync.repository_failed', {
          repositoryId: repo.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    running = false;
  }
  if (enqueued > 0) log.info('pr_sync.completed', { checked, enqueued });
  return { checked, enqueued };
}

async function syncRepository(repo: RepoRecord): Promise<{ checked: number; enqueued: number }> {
  // The base branch is whatever this repository tracks in the site config.
  const target = repo.branch || repo.defaultBranch;
  const access = await resolveGitHubAccess(repo.owner, repo.name, repo.organizationId);
  if (!access.capability.canComment) return { checked: 0, enqueued: 0 };
  const prs = await access.client.listPullRequests(repo.owner, repo.name, 'open');

  let enqueued = 0;
  for (const pr of prs) {
    if (pr.draft) continue;
    if (pr.baseBranch !== target) continue;
    if (!pr.headSha) continue;

    recordPullRequest(repo.id, {
      number: pr.number,
      title: pr.title,
      author: pr.author,
      state: pr.state,
      draft: pr.draft,
      baseBranch: pr.baseBranch,
      headBranch: pr.headBranch,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      url: pr.htmlUrl,
      updatedAt: pr.updatedAt,
    });

    // Already reviewed? Retry only when the review finished but GitHub refused
    // its comments *and* the credential can now write — that self-heals a PR
    // the moment the App is granted write permissions, without touching it.
    const reviewed = hasReviewForHead(repo.id, pr.number, pr.headSha);
    const retryComments =
      reviewed && access.capability.canComment && hasBlockedComments(repo.id, pr.number, pr.headSha);
    if (reviewed && !retryComments) continue;
    if (!claimScheduled(repo.id, pr.number, pr.headSha)) continue;
    if (retryComments) {
      log.info('pr_sync.comment_retry', { repositoryId: repo.id, number: pr.number, capability: access.capability.mode });
    }

    jobQueue.enqueue(
      'review',
      repo.id,
      {
        owner: repo.owner,
        repo: repo.name,
        pullRequestNumber: pr.number,
        title: pr.title,
        baseBranch: pr.baseBranch,
        baseSha: pr.baseSha,
        headSha: pr.headSha,
        checkoutPath: repo.checkoutPath,
        reviewVersion: REVIEW_VERSION,
      },
      'pr-sync',
    );
    enqueued++;
    log.info('pr_sync.review_queued', {
      repositoryId: repo.id,
      number: pr.number,
      base: pr.baseBranch,
      capability: access.capability.mode,
    });
  }

  return { checked: prs.length, enqueued };
}

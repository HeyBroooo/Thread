import { createLogger, uuid, type Finding } from '@cbi/shared';
import { readState, writeState, writeStateDebounced } from './state.js';

const log = createLogger({ component: 'prStore' });

/**
 * In-memory (disk-mirrored) PR and review registry.
 *
 * When PostgreSQL is unavailable the pipeline has nowhere to put its results,
 * so the PR list and the findings table came back empty even after a
 * successful review. This store keeps the last reviews per repository so the
 * UI always reflects what the service actually did.
 */

export interface PullRequestRecord {
  number: number;
  title: string;
  author: string | null;
  state: string;
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  baseSha: string | null;
  headSha: string;
  url: string;
  updatedAt: string;
}

export interface ReviewFindingRecord {
  id: string;
  severity: string;
  category: string;
  filePath: string;
  line: number;
  title: string;
  explanation: string;
  suggestion: string | null;
  confidence: number;
  origin: string;
  analyzer: string | null;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  prNumber: number;
  headSha: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  findings: ReviewFindingRecord[];
  summary: string;
  aiStatus: string;
  inlineComments: number;
  summaryCommentId: number | null;
  commentErrors: string[];
  error: string | null;
  startedAt: string;
  completedAt: string;
}

interface PersistedState {
  prs: Record<string, PullRequestRecord[]>;
  reviews: Record<string, ReviewRecord[]>;
}

const MAX_REVIEWS_PER_PR = 10;

const prsByRepo = new Map<string, Map<number, PullRequestRecord>>();
const reviewsByRepo = new Map<string, Map<number, ReviewRecord[]>>();
/** head shas already handed to the queue, so a poll tick cannot double-enqueue. */
const scheduled = new Set<string>();

function hydrate(): void {
  const state = readState<PersistedState>('prs.json', { prs: {}, reviews: {} });
  for (const [repoId, list] of Object.entries(state.prs ?? {})) {
    prsByRepo.set(repoId, new Map(list.map((pr) => [pr.number, pr])));
  }
  for (const [repoId, list] of Object.entries(state.reviews ?? {})) {
    const byNumber = new Map<number, ReviewRecord[]>();
    for (const review of list) {
      const bucket = byNumber.get(review.prNumber) ?? [];
      // Re-derive finding ids from content: older records used positional ids,
      // which collide across reviews and break React's list keys.
      bucket.push({
        ...review,
        findings: (review.findings ?? []).map((f) => ({
          ...f,
          id: `fnd_${shortHash(`${f.filePath}:${f.line}:${f.title}`)}`,
        })),
      });
      byNumber.set(review.prNumber, bucket);
    }
    // Collapse any historical duplicates: only the newest verdict per commit
    // is meaningful, and stale copies make the UI (and the retry logic) lie.
    for (const [number, bucket] of byNumber) {
      const newest = new Map<string, ReviewRecord>();
      for (const r of bucket) {
        const key = r.headSha || r.id;
        const prev = newest.get(key);
        if (!prev || (r.completedAt ?? '') > (prev.completedAt ?? '')) newest.set(key, r);
      }
      byNumber.set(
        number,
        [...newest.values()].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
      );
    }
    reviewsByRepo.set(repoId, byNumber);
  }
}
hydrate();

function persist(): void {
  const prs: Record<string, PullRequestRecord[]> = {};
  for (const [repoId, map] of prsByRepo) prs[repoId] = [...map.values()];
  const reviews: Record<string, ReviewRecord[]> = {};
  for (const [repoId, map] of reviewsByRepo) {
    reviews[repoId] = [...map.values()].flat();
  }
  writeStateDebounced('prs.json', () => ({ prs, reviews }), 300);
}

export function recordPullRequest(repositoryId: string, pr: PullRequestRecord): void {
  let map = prsByRepo.get(repositoryId);
  if (!map) {
    map = new Map();
    prsByRepo.set(repositoryId, map);
  }
  const existing = map.get(pr.number);
  // Merge instead of overwrite: some callers (the review job) only know a
  // subset of the fields and must not blank out GitHub's metadata.
  const merged: PullRequestRecord = existing
    ? {
        ...existing,
        ...pr,
        title: pr.title || existing.title,
        author: pr.author ?? existing.author,
        headBranch: pr.headBranch || existing.headBranch,
        baseBranch: pr.baseBranch || existing.baseBranch,
        url: pr.url || existing.url,
      }
    : pr;
  map.set(pr.number, merged);
  persist();
}

export function listMemoryPullRequests(repositoryId: string): PullRequestRecord[] {
  return [...(prsByRepo.get(repositoryId)?.values() ?? [])].sort((a, b) => b.number - a.number);
}

export function recordReview(repositoryId: string, review: ReviewRecord): void {
  let map = reviewsByRepo.get(repositoryId);
  if (!map) {
    map = new Map();
    reviewsByRepo.set(repositoryId, map);
  }
  const bucket = map.get(review.prNumber) ?? [];
  // One live record per commit: a re-run (manual "Review now", a webhook plus
  // the poller, two clicks while a review was queued) supersedes the previous
  // record for the same head sha instead of stacking duplicates.
  const existing = bucket.findIndex((r) => r.id === review.id || r.headSha === review.headSha);
  if (existing >= 0) bucket[existing] = review;
  else bucket.unshift(review);
  if (bucket.length > MAX_REVIEWS_PER_PR) bucket.length = MAX_REVIEWS_PER_PR;
  map.set(review.prNumber, bucket);
  scheduled.delete(`${repositoryId}:${review.prNumber}:${review.headSha}`);
  persist();
}

export function listMemoryReviews(repositoryId: string, prNumber?: number): ReviewRecord[] {
  const map = reviewsByRepo.get(repositoryId);
  if (!map) return [];
  if (prNumber !== undefined) return map.get(prNumber) ?? [];
  return [...map.values()].flat().sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

/** Findings across every review of a repository (for the findings table). */
export function listMemoryFindings(repositoryId: string, limit = 100): ReviewFindingRecord[] {
  const seen = new Set<string>();
  const out: ReviewFindingRecord[] = [];
  for (const review of listMemoryReviews(repositoryId)) {
    for (const finding of review.findings) {
      const key = `${finding.filePath}:${finding.line}:${finding.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(finding);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * True when this exact head sha already has a review. A QUEUED/RUNNING record
 * only counts while it is plausibly alive: a job that died with the process
 * must not block the PR forever.
 */
const STALE_RUNNING_MS = 15 * 60_000;

export function hasReviewForHead(repositoryId: string, prNumber: number, headSha: string): boolean {
  const reviews = reviewsByRepo.get(repositoryId)?.get(prNumber) ?? [];
  return reviews.some((r) => {
    if (r.headSha !== headSha || r.status === 'FAILED') return false;
    if (r.status === 'COMPLETED') return true;
    const ts = Date.parse(r.completedAt || r.startedAt || '');
    return Number.isFinite(ts) ? Date.now() - ts < STALE_RUNNING_MS : false;
  });
}

/** Claim a head sha for the queue; returns false when already reviewed or scheduled. */
export function claimForScheduling(repositoryId: string, prNumber: number, headSha: string): boolean {
  if (hasReviewForHead(repositoryId, prNumber, headSha)) return false;
  return claimScheduled(repositoryId, prNumber, headSha);
}

/**
 * Claim a head sha against in-flight work only, ignoring completed reviews.
 * Used when a review finished but GitHub refused the comments — the run is
 * repeated once a writable credential appears, so nothing has to be pushed to
 * the PR to get the comment it was always meant to have.
 */
export function claimScheduled(repositoryId: string, prNumber: number, headSha: string): boolean {
  const key = `${repositoryId}:${prNumber}:${headSha}`;
  if (scheduled.has(key)) return false;
  scheduled.add(key);
  return true;
}

/**
 * A completed review whose comments GitHub refused. Retrying is only useful
 * once the credential may actually write, which the caller checks first.
 */
export function hasBlockedComments(repositoryId: string, prNumber: number, headSha: string): boolean {
  const reviews = (reviewsByRepo.get(repositoryId)?.get(prNumber) ?? []).filter(
    (r) => r.headSha === headSha,
  );
  if (reviews.length === 0) return false;
  // Only the newest verdict for this commit counts — older refused attempts
  // must not keep the retry loop alive after a later run succeeded.
  const latest = reviews.reduce((a, b) => ((a.completedAt ?? '') >= (b.completedAt ?? '') ? a : b));
  return latest.status === 'COMPLETED' && latest.commentErrors.length > 0;
}

export function releaseScheduled(repositoryId: string, prNumber: number, headSha: string): void {
  scheduled.delete(`${repositoryId}:${prNumber}:${headSha}`);
}

export function newReviewId(): string {
  return `rev_${uuid().slice(0, 10)}`;
}

/** Small stable hash — finding ids must be content-derived, not positional. */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function toFindingRecord(finding: Finding, _index?: number): ReviewFindingRecord {
  return {
    id: `fnd_${shortHash(`${finding.file}:${finding.line}:${finding.title}`)}`,
    severity: finding.severity,
    category: finding.category,
    filePath: finding.file,
    line: finding.line,
    title: finding.title,
    explanation: finding.explanation,
    suggestion: finding.suggestion ?? null,
    confidence: finding.confidence,
    origin: finding.origin ?? 'deterministic',
    analyzer: finding.analyzer ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function logStoreStats(): void {
  log.info('pr_store.loaded', {
    repositories: prsByRepo.size,
    pullRequests: [...prsByRepo.values()].reduce((n, m) => n + m.size, 0),
    reviews: [...reviewsByRepo.values()].reduce((n, m) => n + [...m.values()].flat().length, 0),
  });
}

import type { Convention, RuleConfig } from '@cbi/analyzer';
import type { AIProvider } from '@cbi/ai';
import type { GitHubApi } from '@cbi/github';
import type { GraphStore } from '@cbi/graph';
import type { SourceRegistry } from '@cbi/shared';
import { createLogger } from '@cbi/shared';
import * as db from '@cbi/db';
import {
  postReviewToGitHub,
  reviewPullRequest,
  type ReviewOutcome,
} from '@cbi/reviewer';

const log = createLogger({ component: 'pr-reviewer' });

export const REVIEW_VERSION = 1;

export interface ReviewJobInput {
  repositoryId: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  title: string;
  baseSha: string | null;
  headSha: string;
  store: GraphStore;
  sources: SourceRegistry;
  github: GitHubApi;
  appUrl?: string;
  postNewComment?: boolean;
  ai?: AIProvider;
  conventions?: Convention[];
  ruleConfig?: RuleConfig;
  minimumConfidence?: number;
  graphIsPartial?: boolean;
  model?: string;
  /** The org-scoped repository row id used for persistence. */
  persist?: boolean;
}

export interface ReviewJobResult {
  outcome: ReviewOutcome;
  reviewId: string | null;
  postedFindings: number;
  inlineCommentIds: number[];
  summaryCommentId: number | null;
  /** Why comments could not be posted (empty when everything landed). */
  commentErrors: string[];
  /** True when this exact commit already had a review comment. */
  alreadyPosted: boolean;
  duplicate: boolean;
}

export async function runReviewJob(input: ReviewJobInput): Promise<ReviewJobResult> {
  const persist = input.persist ?? db.hasDatabase();
  const startedAt = new Date();

  let pullRequestId: string | null = null;
  let reviewId: string | null = null;

  if (persist) {
    const pr = await db.upsertPullRequest({
      repositoryId: input.repositoryId,
      number: input.pullRequestNumber,
      baseSha: input.baseSha,
      headSha: input.headSha,
      title: input.title,
      author: null,
      status: 'OPEN',
    });
    pullRequestId = pr.id;
    const review = await db.createPrReview({ pullRequestId, headSha: input.headSha, reviewVersion: REVIEW_VERSION });
    reviewId = review.id;

    if (review.status !== 'QUEUED' && (!input.postNewComment || review.status === 'RUNNING')) {
      log.info('review.duplicate_skipped', { reviewId, headSha: input.headSha });
      return {
        outcome: emptyOutcome(),
        reviewId,
        postedFindings: 0,
        inlineCommentIds: [],
        summaryCommentId: null,
        commentErrors: [],
        alreadyPosted: true,
        duplicate: true,
      };
    }
    await db.updatePrReview(reviewId, { status: 'RUNNING', startedAt, error: null });
  }

  try {
    const diff = await input.github.getPullRequestDiff(input.owner, input.repo, input.pullRequestNumber);

    const outcome = await reviewPullRequest(
      { store: input.store, sources: input.sources, ...(input.ai ? { ai: input.ai } : {}) },
      {
        repositoryId: input.repositoryId,
        pullRequestNumber: input.pullRequestNumber,
        title: input.title,
        baseSha: input.baseSha,
        headSha: input.headSha,
        diff,
        conventions: input.conventions ?? [],
        ruleConfig: input.ruleConfig ?? {},
        ...(input.minimumConfidence !== undefined ? { minimumConfidence: input.minimumConfidence } : {}),
        graphIsPartial: input.graphIsPartial ?? false,
        model: input.model,
      },
    );

    const posted = await postReviewToGitHub(input.github, {
      owner: input.owner,
      repo: input.repo,
      pullRequestNumber: input.pullRequestNumber,
      commitId: input.headSha,
      appUrl: input.appUrl,
      postNewComment: input.postNewComment,
      findings: outcome.accepted,
      summary: outcome.summary,
      parsedDiff: outcome.parsedDiff,
      aiStatus: outcome.aiStatus,
    });

    if (persist && reviewId) {
      const reviewRowId = reviewId;
      if (input.postNewComment) await db.deleteFindingsForReview(reviewRowId);
      const findingRows = await db.insertFindings(
        outcome.accepted.map((finding) => ({ prReviewId: reviewRowId, repositoryId: input.repositoryId, finding })),
      );
      // Every finding lives inside the one review comment, so they all point
      // at the same comment id.
      const reviewCommentId = posted.summaryCommentId ?? posted.inlineCommentIds[0] ?? null;
      if (reviewCommentId !== null) {
        for (const findingRow of findingRows) {
          await db.setFindingCommentId(findingRow.id, reviewCommentId);
        }
      }
      await db.updatePrReview(reviewId, {
        status: 'COMPLETED',
        summary: outcome.summary,
        aiStatus: outcome.aiStatus,
        completedAt: new Date(),
      });
      await db.writeAuditLog({
        repositoryId: input.repositoryId,
        action: 'pr.reviewed',
        metadata: {
          pullRequestNumber: input.pullRequestNumber,
          headSha: input.headSha,
          findings: outcome.accepted.length,
          rejected: outcome.rejected.length,
          aiStatus: outcome.aiStatus,
          reviewCommentId: posted.summaryCommentId,
          commentUpdated: posted.alreadyPosted,
        },
      });
    }

    log.info('review.completed', {
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
      findings: outcome.accepted.length,
      rejected: outcome.rejected.length,
      aiStatus: outcome.aiStatus,
      reviewComment: posted.summaryCommentId,
      commentUpdated: posted.alreadyPosted,
      commentErrors: posted.errors.length,
    });

    return {
      outcome,
      reviewId,
      postedFindings: posted.alreadyPosted ? 0 : outcome.accepted.length,
      inlineCommentIds: posted.inlineCommentIds,
      summaryCommentId: posted.summaryCommentId,
      commentErrors: posted.errors,
      alreadyPosted: posted.alreadyPosted,
      duplicate: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (persist && reviewId) {
      await db.updatePrReview(reviewId, { status: 'FAILED', error: message, completedAt: new Date() }).catch(() => undefined);
    }
    log.error('review.failed', { repositoryId: input.repositoryId, pullRequestNumber: input.pullRequestNumber, message });
    throw e;
  }
}

function emptyOutcome(): ReviewOutcome {
  return {
    parsedDiff: { files: [], changedFiles: [], addedLineSet: new Map(), touchedLineSet: new Map() },
    changedSymbols: { changedFiles: [], changedNodes: [], changedFileNodes: [], unindexedFiles: [], byFile: new Map() },
    impact: { distances: new Map(), nodes: [], direct: [], indirect: [], truncated: false },
    deterministicFindings: [],
    aiFindings: [],
    accepted: [],
    rejected: [],
    aiStatus: 'SKIPPED',
    summary: '',
  };
}

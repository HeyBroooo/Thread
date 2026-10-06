import type { EdgeType, Finding, GraphNode, SourceRegistry } from '@cbi/shared';
import { createLogger, isAppError, uniqueBy } from '@cbi/shared';
import type { GraphStore } from '@cbi/graph';
import { loadGraphView } from '@cbi/graph';
import { runDeterministicRules, type Convention, type RuleConfig } from '@cbi/analyzer';
import { generateAiReview, type AIProvider } from '@cbi/ai';
import type { GitHubApi } from '@cbi/github';
import { allChangedLines, parseUnifiedDiff, type ParsedDiff } from './diff.js';
import {
  collectSymbolRelationships,
  computeImpact,
  mapChangedSymbols,
  type ChangedSymbolResult,
  type ImpactAnalysis,
} from './analysis.js';
import { runDiffAnalyzers, detectVersionBumps } from './analyzers.js';
import { buildValidationContext, validateFindings } from './validation.js';

const log = createLogger({ component: 'reviewer' });

export interface ReviewDeps {
  store: GraphStore;
  sources: SourceRegistry;
  ai?: AIProvider;
}

export interface ReviewInput {
  repositoryId: string;
  pullRequestNumber: number;
  title: string;
  baseSha: string | null;
  headSha: string | null;
  diff: string;
  conventions: Convention[];
  ruleConfig?: RuleConfig;
  graphIsPartial?: boolean;
  runAi?: boolean;
  model?: string;
  minimumConfidence?: number;
  maxFindings?: number;
}

export interface ReviewOutcome {
  parsedDiff: ParsedDiff;
  changedSymbols: ChangedSymbolResult;
  impact: ImpactAnalysis;
  deterministicFindings: Finding[];
  aiFindings: Finding[];
  accepted: Finding[];
  rejected: Array<{ finding: Finding; reason: string }>;
  aiStatus: 'OK' | 'SKIPPED' | 'AI_REVIEW_FAILED';
  summary: string;
}

export async function reviewPullRequest(deps: ReviewDeps, input: ReviewInput): Promise<ReviewOutcome> {
  const parsedDiff = parseUnifiedDiff(input.diff);
  const changedSymbols = await mapChangedSymbols(deps.store, input.repositoryId, parsedDiff);
  const anchorIds = [...changedSymbols.changedNodes, ...changedSymbols.changedFileNodes].map((n) => n.id);
  const impact = await computeImpact(deps.store, anchorIds, { depth: 3, maxNodes: 400 });

  // ---- deterministic analyzers -------------------------------------------------
  const graph = await loadGraphView(deps.store, input.repositoryId);
  const impactedFiles = new Set(
    impact.nodes.map((n) => n.filePath).filter((f): f is string => Boolean(f)),
  );
  const changedFiles = new Set(parsedDiff.changedFiles);
  const graphRules = runDeterministicRules(graph, {
    ...(input.ruleConfig ?? {}),
    // At review time we only surface rules on the changed / impacted region.
  }).filter((f) => changedFiles.has(f.file) || impactedFiles.has(f.file));

  const diffFindings = runDiffAnalyzers(parsedDiff, deps.sources, {
    security: input.ruleConfig?.security !== false,
    dependency: input.ruleConfig?.dependency !== false,
    performance: input.ruleConfig?.performance !== false,
  });
  // Version bumps are compared from the diff itself (old vs new line) and
  // verified against the npm registry, so a bump to an unreleased version
  // cannot slip through just because it replaced an existing entry.
  const versionFindings =
    input.ruleConfig?.dependency === false ? [] : await detectVersionBumps(parsedDiff);
  const deterministicFindings = uniqueBy(
    [...graphRules, ...diffFindings, ...versionFindings],
    (f) => `${f.file}:${f.line}:${f.title}`,
  );

  // ---- AI reasoning (failure never fails the deterministic review) -------------
  let aiFindings: Finding[] = [];
  let aiStatus: ReviewOutcome['aiStatus'] = 'SKIPPED';
  let summary = '';

  if (input.runAi !== false && deps.ai) {
    try {
      const relationshipBundles = await collectSymbolRelationships(
        deps.store,
        changedSymbols.changedNodes.length > 0 ? changedSymbols.changedNodes : changedSymbols.changedFileNodes,
      );
      const result = await generateAiReview(
        deps.ai,
        {
          repositoryId: input.repositoryId,
          pullRequestNumber: input.pullRequestNumber,
          title: input.title,
          baseSha: input.baseSha,
          headSha: input.headSha,
          diff: input.diff,
          changedFiles: parsedDiff.changedFiles,
          changedSymbols: relationshipBundles,
          impact: impact.nodes,
          conventions: input.conventions,
          deterministicFindings,
          graphIsPartial: input.graphIsPartial,
        },
        { model: input.model },
      );
      aiFindings = result.findings;
      summary = result.summary;
      aiStatus = 'OK';
    } catch (e) {
      aiStatus = 'AI_REVIEW_FAILED';
      log.error('review.ai_failed', {
        repositoryId: input.repositoryId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- validation & noise control ---------------------------------------------
  const allNodes: GraphNode[] = graph.nodes;
  const ctx = buildValidationContext({
    nodes: allNodes,
    changedLines: allChangedLines(parsedDiff),
    changedFiles: new Set(parsedDiff.changedFiles),
    changedNodes: changedSymbols.changedNodes.length > 0 ? changedSymbols.changedNodes : changedSymbols.changedFileNodes,
    minimumConfidence: input.minimumConfidence ?? input.ruleConfig?.minimumConfidence ?? 0.6,
    requireChangedLine: false,
  });

  const deterministicValidated = validateFindings(deterministicFindings, ctx);

  // AI findings must point at lines that are genuinely part of the PR.
  const aiCtx = { ...ctx, requireChangedLine: true };
  const aiValidated = validateFindings(aiFindings, aiCtx);

  const maxFindings = input.maxFindings ?? 12;
  const accepted = [...deterministicValidated.accepted, ...aiValidated.accepted]
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.confidence - a.confidence)
    .slice(0, maxFindings);

  return {
    parsedDiff,
    changedSymbols,
    impact,
    deterministicFindings,
    aiFindings,
    accepted,
    rejected: [...deterministicValidated.rejected, ...aiValidated.rejected],
    aiStatus,
    summary,
  };
}

function severityWeight(s: Finding['severity']): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s];
}

export interface PostReviewOptions {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  commitId: string;
  appUrl?: string;
  postNewComment?: boolean;
  findings: Finding[];
  summary?: string;
  parsedDiff: ParsedDiff;
  aiStatus: ReviewOutcome['aiStatus'];
}

/**
 * Identity marker placed in the single review comment.
 *
 * It is deliberately *not* keyed by commit: automatic reviews update the
 * newest Codebase Intelligence comment. A manual request can explicitly add
 * a fresh comment when the user wants a new visible timeline entry.
 */
export const REVIEW_COMMENT_MARKER = '<!-- cbi-review-bot -->';

const SEVERITY_ORDER: Finding['severity'][] = ['critical', 'high', 'medium', 'low'];

function severityLabel(severity: Finding['severity']): string {
  return `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
}

function severityBadge(severity: Finding['severity']): string {
  return severityLabel(severity);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A link to the finding's line on GitHub (falls back to plain text). */
function fileLink(finding: Finding, owner: string, repo: string, commitId: string): string {
  const path = finding.file.replace(/^\/+/, '');
  const label = `\`${finding.file}:${finding.line}\``;
  if (!commitId || !owner || !repo) return label;
  const url = `https://github.com/${owner}/${repo}/blob/${commitId}/${encodeURI(path)}#L${finding.line}`;
  return `[${label}](${url})`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

/** One finding, fully expanded — used inside the collapsible details block. */
export function formatFindingComment(finding: Finding): string {
  const lines = [
    `#### ${severityBadge(finding.severity)} · ${finding.title}`,
    '',
    `**Location** \`${finding.file}:${finding.line}\``,
    '',
    finding.explanation,
  ];
  if (finding.evidence) {
    lines.push('', '**Evidence**', '', '```', finding.evidence.slice(0, 700), '```');
  }
  if (finding.suggestion) {
    lines.push('', `**Suggestion:** ${finding.suggestion}`);
  }
  lines.push(
    '',
    `<sub>${finding.category} · ${Math.round(finding.confidence * 100)}% confidence · ${finding.origin ?? 'ai'}${finding.analyzer ? ` (${finding.analyzer})` : ''}</sub>`,
  );
  return lines.join('\n');
}

export interface SummaryCommentOptions {
  owner: string;
  repo: string;
  commitId: string;
  appUrl?: string;
  /** Findings that are also surfaced as their own inline comment. */
  inlineCount?: number;
}

const ARCHTHREAD_ICON_URL = 'https://github.com/identicons/app/app/archthread';

function hostedLogoUrl(appUrl?: string): string | null {
  if (!appUrl) return null;
  try {
    const base = new URL(appUrl);
    const host = base.hostname.toLowerCase();
    const localHost =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (base.protocol !== 'https:' || localHost) return null;
    return new URL('/logo-128.png', base).href;
  } catch {
    return null;
  }
}

/**
 * The whole review, as one well-formed GitHub comment.
 *
 * Layout: header → headline stats → severity roll-up → findings table →
 * collapsible evidence per finding → footer. Everything the reviewer produced
 * lives in this single comment so a PR never collects a wall of bot noise.
 */
export function buildSummaryComment(
  outcome: ReviewOutcome,
  options: SummaryCommentOptions | number = { owner: '', repo: '', commitId: '' },
): string {
  const opts: SummaryCommentOptions =
    typeof options === 'number'
      ? { owner: '', repo: '', commitId: '', inlineCount: options }
      : options;

  const direct = outcome.impact.direct.length;
  const indirect = outcome.impact.indirect.length;
  const files = outcome.parsedDiff.changedFiles.length;
  const symbols = outcome.changedSymbols.changedNodes.length;
  const shortSha = opts.commitId ? opts.commitId.slice(0, 8) : 'working tree';

  const counts = SEVERITY_ORDER.map((s) => ({
    severity: s,
    n: outcome.accepted.filter((f) => f.severity === s).length,
  })).filter((c) => c.n > 0);

  const hasBlocking = outcome.accepted.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const rollUp = counts.map((c) => `**${c.n} ${c.severity}**`).join(' · ');
  const logoUrl = hostedLogoUrl(opts.appUrl) ?? ARCHTHREAD_ICON_URL;
  const header = `<p><img src="${logoUrl}" width="30" height="30" alt="ArchThread" align="middle" /> <strong>Codebase Intelligence</strong><br /><sub>Automated pull request review · <code>${shortSha}</code></sub></p>`;

  const lines: string[] = [
    REVIEW_COMMENT_MARKER,
    '',
    header,
    '',
  ];

  // GitHub renders these callouts as coloured panels — the closest thing
  // markdown has to a designed status card, and it works everywhere.
  if (outcome.accepted.length === 0) {
    lines.push('> [!TIP]', '> **No issues found.** Nothing in this diff crossed the validation threshold.');
  } else if (hasBlocking) {
    lines.push(
      '> [!WARNING]',
      `> ${rollUp}`,
      '>',
      '> At least one finding looks blocking — worth addressing before merge.',
    );
  } else {
    lines.push('> [!NOTE]', `> ${rollUp}`, '>', '> Nothing blocking, but worth a look.');
  }
  lines.push('');

  lines.push(
    `**Scope** ${plural(files, 'file')} · ${plural(symbols, 'changed symbol')} · ${direct} direct / ${indirect} indirect nodes · ${outcome.rejected.length} filtered`,
    '',
  );

  if (outcome.aiStatus === 'AI_REVIEW_FAILED') {
    lines.push('> AI reasoning was unavailable for this review; deterministic analysis only.', '');
  }

  if (outcome.summary) {
    lines.push('### Assessment', '', outcome.summary, '');
  }

  if (outcome.accepted.length > 0) {
    lines.push('### Findings', '', '| Severity | Location | Finding |', '| :--- | :--- | :--- |');
    for (const f of outcome.accepted.slice(0, 20)) {
      lines.push(
        `| **${severityLabel(f.severity)}** | ${fileLink(f, opts.owner, opts.repo, opts.commitId)} | ${escapeCell(f.title)} |`,
      );
    }
    lines.push('');

    lines.push(
      '<details>',
      `<summary><strong>Evidence and suggested fixes</strong> — ${plural(outcome.accepted.length, 'finding')}</summary>`,
      '',
      '<br />',
      '',
    );
    outcome.accepted.slice(0, 20).forEach((f, i) => {
      if (i > 0) lines.push('', '---', '');
      lines.push(formatFindingComment(f));
    });
    lines.push('', '</details>', '');
  }

  lines.push('---');
  lines.push(
    '<sub><strong>Codebase Intelligence</strong> · Every finding is source-backed · GitHub still owns approval and merge</sub>',
  );
  return lines.join('\n');
}

/**
 * Publish a review comment on the pull request.
 *
 * Automatic runs edit the newest matching comment in place. An explicit
 * `postNewComment` request creates a fresh timeline entry instead.
 */
export async function postReviewToGitHub(
  github: GitHubApi,
  options: PostReviewOptions,
): Promise<{
  inlineCommentIds: number[];
  summaryCommentId: number | null;
  skippedInline: Finding[];
  errors: string[];
  writeDenied: boolean;
  /** True when the existing single comment was updated rather than created. */
  alreadyPosted: boolean;
}> {
  const inlineCommentIds: number[] = [];
  const skippedInline: Finding[] = [];
  const errors: string[] = [];
  let writeDenied = false;

  const body = buildSummaryComment(
    {
      parsedDiff: options.parsedDiff,
      changedSymbols: {
        changedFiles: options.parsedDiff.changedFiles,
        changedNodes: [],
        changedFileNodes: [],
        unindexedFiles: [],
        byFile: new Map(),
      },
      impact: { distances: new Map(), nodes: [], direct: [], indirect: [], truncated: false },
      deterministicFindings: [],
      aiFindings: [],
      accepted: options.findings,
      rejected: [],
      aiStatus: options.aiStatus,
      summary: options.summary ?? '',
    },
    { owner: options.owner, repo: options.repo, commitId: options.commitId, appUrl: options.appUrl },
  );

  let existing: { id: number; body: string } | undefined;
  if (!options.postNewComment && github.listIssueComments) {
    try {
      const comments = await github.listIssueComments(
        options.owner,
        options.repo,
        options.pullRequestNumber,
      );
      existing = comments
        .filter((comment) => comment.body.includes(REVIEW_COMMENT_MARKER))
        .sort((a, b) => b.id - a.id)[0];
    } catch (e) {
      // Not being able to read comments must never block a review.
      log.warn('review.comment_lookup_failed', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (existing) {
    if (github.updateIssueComment) {
      try {
        const res = await github.updateIssueComment(
          options.owner,
          options.repo,
          existing.id,
          { body },
        );
        log.info('review.comment_updated', {
          owner: options.owner,
          repo: options.repo,
          number: options.pullRequestNumber,
          commentId: res.id,
          commitId: options.commitId,
        });
        return {
          inlineCommentIds,
          summaryCommentId: res.id,
          skippedInline,
          errors,
          writeDenied,
          alreadyPosted: true,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (isAppError(e) && e.code === 'GITHUB_WRITE_DENIED') writeDenied = true;
        if (!errors.includes(message)) errors.push(message);
        log.warn('review.comment_update_failed', { message });
      }
    }
    // Without the ability to edit, leaving the existing comment alone is still
    // better than posting a second one.
    return {
      inlineCommentIds,
      summaryCommentId: existing.id,
      skippedInline,
      errors,
      writeDenied,
      alreadyPosted: true,
    };
  }

  let summaryCommentId: number | null = null;
  if (writeDenied) {
    log.warn('review.comments_denied', {
      owner: options.owner,
      repo: options.repo,
      reason: errors[0] ?? 'no GitHub credential that may write',
    });
  } else {
    try {
      const res = await github.createIssueComment(options.owner, options.repo, options.pullRequestNumber, {
        body,
      });
      summaryCommentId = res.id;
      log.info('review.comment_created', {
        owner: options.owner,
        repo: options.repo,
        number: options.pullRequestNumber,
        commentId: res.id,
        commitId: options.commitId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isAppError(e) && e.code === 'GITHUB_WRITE_DENIED') writeDenied = true;
      if (!errors.includes(message)) errors.push(message);
      log.warn('review.summary_comment_failed', { message });
    }
  }

  return { inlineCommentIds, summaryCommentId, skippedInline, errors, writeDenied, alreadyPosted: false };
}

export const IMPACT_EDGE_TYPES: EdgeType[] = ['CALLS', 'RENDERS', 'USES', 'CALLS_API', 'IMPORTS', 'DEPENDS_ON', 'TESTS', 'USES_CONTEXT', 'USES_STORE'];

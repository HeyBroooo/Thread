'use client';
import { demoResponse } from '@/lib/demo';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { useRepositoryContext } from '@/components/RepositoryLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ReviewSummary {
  id: string;
  status: string;
  headSha: string;
  findings: number;
  aiStatus: string;
  inlineComments: number;
  summaryCommentId: number | null;
  commentErrors: string[];
  error: string | null;
  startedAt: string;
  completedAt: string;
}

interface PullRequestRow {
  id: string;
  number: number;
  title: string | null;
  author: string | null;
  status: string;
  headSha: string | null;
  updatedAt: string;
  url?: string;
  state?: string;
  draft?: boolean;
  baseBranch?: string | null;
  headBranch?: string | null;
  review?: ReviewSummary | null;
}

interface CommentCapability {
  mode: 'app' | 'token' | 'anonymous';
  canComment: boolean;
  appConfigured: boolean;
  requiresInstall: boolean;
  message: string;
  installUrl: string | null;
  appSettingsUrl: string | null;
  appPermissionsUrl?: string | null;
  installationUrl?: string | null;
  installationId?: number | null;
  missingPermissions?: string[];
  permissionUpdatePending?: boolean;
  accessibleRepoCount?: number | null;
  repoAccessible?: boolean | null;
  rateLimited?: boolean;
  tokenSource?: 'env' | 'runtime' | 'none';
}

interface FindingRow {
  id: string;
  severity: string;
  category: string;
  file_path: string;
  line: number;
  title: string;
  explanation: string;
  suggestion: string | null;
  confidence: number;
  origin: string;
  created_at: string;
}

interface ReviewJobRow {
  id: string;
  status: string;
  stage: string;
  progress: number;
  number: number | null;
  headSha: string | null;
  error: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  if (path.startsWith('/api/repositories/demo/')) return demoResponse(path) as T;
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical') return 'severity-critical';
  if (s === 'high') return 'severity-high';
  if (s === 'medium') return 'severity-medium';
  return 'severity-low';
}

const listStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const row = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

function reviewBadge(review: ReviewSummary | null | undefined, jobActive: boolean, jobError?: string | null) {
  if (!review) {
    if (jobActive) return { label: 'Queued…', cls: 'pill' };
    return { label: jobError ? 'Failed' : 'Not reviewed', cls: 'pill' };
  }
  switch (review.status) {
    case 'QUEUED':
      return { label: 'Queued…', cls: 'pill' };
    case 'RUNNING':
      return { label: 'Reviewing…', cls: 'pill' };
    case 'FAILED':
      return { label: 'Failed', cls: 'pill severity-high' };
    default:
      return { label: `Reviewed · ${review.findings} finding${review.findings === 1 ? '' : 's'}`, cls: 'pill severity-low' };
  }
}

export default function PullRequestsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { repository } = useRepositoryContext();
  const [pullRequests, setPullRequests] = useState<PullRequestRow[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [capability, setCapability] = useState<CommentCapability | null>(null);
  const [jobs, setJobs] = useState<ReviewJobRow[]>([]);
  const [active, setActive] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPr, setBusyPr] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPrs = useCallback(async () => {
    const data = await getJson<{ pullRequests: PullRequestRow[]; commentCapability?: CommentCapability }>(
      `/api/repositories/${id}/prs`,
    );
    setPullRequests(data.pullRequests ?? []);
    if (data.commentCapability) setCapability(data.commentCapability);
  }, [id]);

  const loadFindings = useCallback(async () => {
    const data = await getJson<{ findings: FindingRow[] }>(`/api/repositories/${id}/findings`);
    setFindings(data.findings ?? []);
  }, [id]);

  const loadReviews = useCallback(async () => {
    const data = await getJson<{ reviews: ReviewSummary[]; jobs: ReviewJobRow[]; active: boolean }>(
      `/api/repositories/${id}/reviews`,
    );
    setJobs(data.jobs ?? []);
    setActive(Boolean(data.active));
    return Boolean(data.active);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        await Promise.all([loadPrs(), loadFindings(), loadReviews()]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };
    void boot();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [loadPrs, loadFindings, loadReviews]);

  // While a review runs, poll the local status endpoint (it never touches
  // GitHub), then refresh the PR list once the queue settles.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let settled = 0;
    const tick = async () => {
      if (cancelled) return;
      try {
        const stillActive = await loadReviews();
        if (stillActive) {
          settled = 0;
        } else {
          settled += 1;
          if (settled === 1) await Promise.all([loadPrs(), loadFindings()]);
        }
      } catch {
        // ignore transient polling errors
      }
      if (!cancelled) pollRef.current = setTimeout(() => void tick(), active ? 2500 : 4000);
    };
    pollRef.current = setTimeout(() => void tick(), 2500);
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [active, loadReviews, loadPrs, loadFindings]);

  if (initialLoading) {
    return (
      <div className="section space-y-3" aria-label="Loading pull requests">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24" />
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-20" />
        ))}
      </div>
    );
  }

  /** Save or clear the personal access token the service posts comments with. */
  async function persistToken(value: string) {
    setTokenBusy(true);
    setTokenMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/github/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: value }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        ok?: boolean;
        login?: string;
        scopes?: string | null;
      };
      if (!res.ok) throw new Error(body.error?.message ?? `Could not save the token (${res.status})`);
      if (value.trim()) {
        const missingScopes =
          body.scopes && !/repo/.test(body.scopes)
            ? ' This token has no `repo` scope, so private repositories will stay unreadable.'
            : '';
        setTokenMsg(`Token accepted for ${body.login ?? 'the account'}.${missingScopes} Re-checking access…`);
      } else {
        setTokenMsg('Token cleared — the service is back to anonymous reads.');
      }
      setTokenInput('');
      await Promise.all([loadPrs(), loadFindings()]);
    } catch (e) {
      setTokenMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTokenBusy(false);
    }
  }

  async function reviewNow(pr: PullRequestRow, postNewComment = false) {
    if (id === 'demo') { setError('Sample workspace is read-only. Connect your repository to run a review.'); return; }
    setBusyPr(pr.number);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/repositories/${id}/prs/${pr.number}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postNewComment }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Review failed (${res.status})`);
      setActive(true);
      await loadReviews();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPr(null);
    }
  }

  const severityCounts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity.toLowerCase()] = (acc[f.severity.toLowerCase()] ?? 0) + 1;
    return acc;
  }, {});

  const jobFor = (pr: PullRequestRow) =>
    jobs.find((j) => j.number === pr.number && (j.status === 'QUEUED' || j.status === 'RUNNING'));

  return (
      <div className="section">
        <motion.div
          className="page-head"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          <div>
            <h1 className="page-title">Pull requests</h1>
            <p className="page-sub">
              Every PR raised against <code>{repository.branch}</code> is reviewed automatically — open, synchronized or
              reopened. GitHub still owns approval and merge.
            </p>
          </div>
          <div className="page-actions">
            <Button
              type="button"
              variant="outline"
              className="btn-outline"
              onClick={() => void loadPrs().catch((e) => setError(String(e)))}
            >
              Refresh
            </Button>
          </div>
        </motion.div>

        {id !== 'demo' && capability && !capability.canComment && (
          <motion.div
            style={{ marginBottom: 16 }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Alert variant="warning">
            <AlertTitle>Reviews run, comments are blocked</AlertTitle>
            <AlertDescription>{capability.message}</AlertDescription>
            {(capability.permissionUpdatePending || capability.accessibleRepoCount === 0) && (
              <p className="small" style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
                {capability.permissionUpdatePending && (
                  <>
                    <strong>Next step:</strong> the App now asks for the right permissions, but the install must accept
                    the change — GitHub keeps the old grants until you approve it.
                  </>
                )}
                {capability.permissionUpdatePending && capability.accessibleRepoCount === 0 && ' '}
                {capability.accessibleRepoCount === 0 && (
                  <>
                    <strong>Also:</strong> the installation currently grants access to <strong>no repositories</strong> —
                    add this one under “Repository access”.
                  </>
                )}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {capability.installationUrl && capability.permissionUpdatePending && (
                <a className="btn-primary" href={capability.installationUrl} target="_blank" rel="noreferrer">
                  Review &amp; accept permissions →
                </a>
              )}
              {capability.appPermissionsUrl && (
                <a
                  className={capability.permissionUpdatePending ? 'link-button' : 'btn-primary'}
                  href={capability.appPermissionsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Grant App write permissions →
                </a>
              )}
              {capability.installationUrl && (
                <a href={capability.installationUrl} target="_blank" rel="noreferrer" className="link-button">
                  Add this repository to the installation
                </a>
              )}
              {capability.installUrl && (
                <a href={capability.installUrl} target="_blank" rel="noreferrer" className="link-button">
                  Install the GitHub App
                </a>
              )}
              {capability.appSettingsUrl && (
                <a href={capability.appSettingsUrl} target="_blank" rel="noreferrer" className="link-button">
                  App settings
                </a>
              )}
            </div>
            {capability.missingPermissions && capability.missingPermissions.length > 0 && (
              <p className="muted small" style={{ marginTop: 8 }}>
                Missing permissions:{' '}
                {capability.missingPermissions.map((p) => (
                  <code key={p} style={{ marginRight: 6 }}>
                    {p}
                  </code>
                ))}
              </p>
            )}
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--border, rgba(255,255,255,0.08))',
              }}
            >
              <Input
                type="password"
                placeholder="github_pat_… or ghp_… (repo scope)"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                style={{ flex: '1 1 280px', minWidth: 220 }}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                className="btn-primary"
                disabled={tokenBusy || tokenInput.trim().length === 0}
                onClick={() => void persistToken(tokenInput)}
              >
                {tokenBusy ? 'Saving…' : 'Save token'}
              </Button>
              {capability.tokenSource === 'runtime' && (
                <Button type="button" variant="link" className="link-button" disabled={tokenBusy} onClick={() => void persistToken('')}>
                  Remove saved token
                </Button>
              )}
            </div>
            <p className="muted small" style={{ marginTop: 8, lineHeight: 1.6 }}>
              A token (classic <code>repo</code> scope, or fine-grained with <strong>Contents: read</strong> and{' '}
              <strong>Pull requests: write</strong>) is stored on this machine only and works for private repositories too.
              {capability.rateLimited && (
                <>
                  {' '}
                  GitHub&apos;s unauthenticated limit is currently exhausted — a token fixes reads immediately.
                </>
              )}
            </p>
            {tokenMsg && <p className="text-xs text-muted-foreground">{tokenMsg}</p>}
            </Alert>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Tracked pull requests</CardTitle>
            <Badge variant="secondary">{pullRequests.length}</Badge>
          </CardHeader>
          <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {pullRequests.length === 0 ? (
            <p className="muted small">
              No pull requests found yet. They appear as soon as GitHub reports them — the service checks for open PRs
              against <code>{repository.branch}</code> on a timer and from the <code>pull_request</code> webhook.
            </p>
          ) : (
            <motion.ul className="pr-list" variants={listStagger} initial="hidden" animate="show">
              {pullRequests.map((pr) => {
                const job = jobFor(pr);
                const badge = reviewBadge(pr.review, Boolean(job), job?.error);
                const jobActive = Boolean(job) || pr.review?.status === 'QUEUED' || pr.review?.status === 'RUNNING';
                const commentUrl = pr.url && pr.review?.summaryCommentId
                  ? `${pr.url}#issuecomment-${pr.review.summaryCommentId}`
                  : null;
                const commentBlocked = pr.review && pr.review.commentErrors.length > 0;
                return (
                  <motion.li key={pr.id} variants={row}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong>#{pr.number}</strong>
                      {pr.url ? (
                        <a href={pr.url} target="_blank" rel="noreferrer">
                          {pr.title || `Pull request #${pr.number}`}
                        </a>
                      ) : (
                        <span>{pr.title}</span>
                      )}
                      <span className={badge.cls}>{badge.label}</span>
                      {pr.state && pr.state !== 'open' && <Badge variant="outline" className="pill">{pr.state}</Badge>}
                      {pr.draft && <Badge variant="secondary" className="pill">draft</Badge>}
                      {commentUrl && (
                        <a
                          className="pill severity-low review-comment-link"
                          href={commentUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open the review comment on GitHub"
                        >
                          <MessageSquare size={12} aria-hidden="true" /> View comment
                          <ExternalLink size={11} aria-hidden="true" />
                        </a>
                      )}
                      {commentBlocked && (
                        <Badge variant="outline" className="pill severity-medium">
                          <MessageSquare size={12} aria-hidden="true" />
                          {commentUrl ? 'Update failed' : 'Not posted'}
                        </Badge>
                      )}
                    </div>
                    <div
                      className="muted small"
                      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}
                    >
                      <span>
                        {pr.author ?? 'unknown'} · {pr.headSha?.slice(0, 8)} ·{' '}
                        {new Date(pr.updatedAt).toLocaleString()}
                      </span>
                      {pr.baseBranch && (
                        <span>
                          {pr.headBranch || '?'} → <strong>{pr.baseBranch}</strong>
                        </span>
                      )}
                      {pr.review?.aiStatus && pr.review.status === 'COMPLETED' && (
                        <span>ai: {pr.review.aiStatus}</span>
                      )}
                      {pr.review?.error && <span className="error small">{pr.review.error}</span>}
                      <Button
                        type="button"
                        onClick={() => void reviewNow(pr, Boolean(commentUrl))}
                        disabled={id === 'demo' || jobActive || busyPr === pr.number}
                        style={{ marginLeft: 'auto' }}
                        title={commentUrl ? 'Publish a fresh GitHub comment for this review' : 'Run a PR review'}
                      >
                        {jobActive
                          ? 'Reviewing…'
                          : busyPr === pr.number
                            ? 'Queued…'
                            : commentUrl
                              ? 'Post new comment'
                              : 'Review now'}
                      </Button>
                    </div>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
          </CardContent>
          </Card>
        </motion.div>

        <motion.div
          style={{ marginTop: 16 }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: 'easeOut' }}
        >
          <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Validated findings</CardTitle>
            {findings.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(severityCounts).map(([sev, count]) => (
                  <span key={sev} className={`severity-badge severity-${sev}`}>
                    {sev} {count}
                  </span>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
          {findings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No findings yet.</p>
          ) : (
            <motion.div variants={listStagger} initial="hidden" animate="show">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Finding</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map((f) => (
                    <motion.tr key={f.id} variants={row} className="border-b border-border align-top">
                      <TableCell>
                        <span className={`severity-badge ${severityClass(f.severity)}`}>{f.severity}</span>
                      </TableCell>
                      <TableCell>{f.category}</TableCell>
                      <TableCell>
                        <code>
                          {f.file_path}:{f.line}
                        </code>
                      </TableCell>
                      <TableCell>
                        <strong className="font-medium">{f.title}</strong>
                        <div className="mt-1 text-xs text-muted-foreground">{f.explanation}</div>
                        {f.suggestion && (
                          <div className="mt-1 text-xs text-muted-foreground">Suggestion: {f.suggestion}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {Math.round(f.confidence * 100)}%
                        <div className="text-xs text-muted-foreground">{f.origin}</div>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </motion.div>
          )}
          </CardContent>
          </Card>
        </motion.div>
      </div>
  );
}

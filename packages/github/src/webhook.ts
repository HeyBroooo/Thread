import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookEventKind =
  | 'pull_request'
  | 'installation'
  | 'installation_repositories'
  | 'push'
  | 'unknown';

export interface NormalizedWebhook {
  kind: WebhookEventKind;
  deliveryId: string;
  eventType: string;
  action: string;
  installationId: number | null;
  repositoryGithubId: number | null;
  owner: string | null;
  repo: string | null;
  defaultBranch: string | null;
  branch: string | null;
  pullRequestNumber: number | null;
  /** Branch the PR targets — reviews are gated on this. */
  baseBranch: string | null;
  baseSha: string | null;
  headSha: string | null;
  title: string | null;
  author: string | null;
  draft: boolean;
  /** account that installed the app (installation events) */
  accountLogin: string | null;
  accountType: string | null;
}

/** Constant-time HMAC verification of `X-Hub-Signature-256` (doc §57). */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const SUPPORTED_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);

export function normalizeWebhook(eventType: string, payload: Record<string, unknown>): NormalizedWebhook | null {
  const action = typeof payload.action === 'string' ? payload.action : '';
  const installation = (payload.installation as { id?: number } | undefined) ?? undefined;
  const repository = (payload.repository as
    | { id?: number; name?: string; default_branch?: string; owner?: { login?: string } }
    | undefined) ?? undefined;

  const base: Omit<NormalizedWebhook, 'kind'> = {
    deliveryId: '',
    eventType,
    action,
    installationId: installation?.id ?? null,
    repositoryGithubId: repository?.id ?? null,
    owner: repository?.owner?.login ?? null,
    repo: repository?.name ?? null,
    defaultBranch: repository?.default_branch ?? null,
    branch: null,
    pullRequestNumber: null,
    baseBranch: null,
    baseSha: null,
    headSha: null,
    title: null,
    author: null,
    draft: false,
    accountLogin: null,
    accountType: null,
  };

  switch (eventType) {
    case 'pull_request': {
      if (!SUPPORTED_PR_ACTIONS.has(action)) return null;
      const pr = (payload.pull_request as
        | {
            number?: number;
            title?: string;
            draft?: boolean;
            user?: { login?: string };
            base?: { sha?: string; ref?: string };
            head?: { sha?: string; ref?: string };
          }
        | undefined) ?? undefined;
      if (!pr) return null;
      return {
        ...base,
        kind: 'pull_request',
        branch: pr.head?.ref ?? null,
        pullRequestNumber: pr.number ?? null,
        baseBranch: pr.base?.ref ?? null,
        baseSha: pr.base?.sha ?? null,
        headSha: pr.head?.sha ?? null,
        title: pr.title ?? null,
        author: pr.user?.login ?? null,
        draft: pr.draft ?? false,
      };
    }
    case 'installation': {
      const acct = (payload.installation as { account?: { login?: string; type?: string } } | undefined)?.account;
      return {
        ...base,
        kind: 'installation',
        accountLogin: acct?.login ?? null,
        accountType: acct?.type ?? null,
      };
    }
    case 'installation_repositories':
      return { ...base, kind: 'installation_repositories' };
    case 'push': {
      return {
        ...base,
        kind: 'push',
        branch: typeof payload.ref === 'string' ? payload.ref.replace('refs/heads/', '') : null,
        headSha: typeof payload.after === 'string' ? payload.after : null,
      };
    }
    default:
      return null;
  }
}

export function shouldTriggerReview(event: NormalizedWebhook | null | undefined, trackedBranch?: string | null): boolean {
  if (!event || event.kind !== 'pull_request') return false;
  // Only review PRs aimed at the branch we actually track for this repository.
  // Without this, every PR in the repo triggers a full review and a comment.
  if (trackedBranch && event.baseBranch && event.baseBranch !== trackedBranch) return false;
  if (event.action === 'ready_for_review') return true;
  return SUPPORTED_PR_ACTIONS.has(event.action);
}

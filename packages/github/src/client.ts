import { AppError, createLogger } from '@cbi/shared';
import { createAppJwt, createInstallationToken } from './auth.js';

const log = createLogger({ component: 'github' });

export interface GitHubRepo {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  language: string | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  author: string | null;
  baseSha: string;
  headSha: string;
  baseBranch: string;
  headBranch: string;
  state: string;
  draft: boolean;
  body: string | null;
}

export interface GitHubChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  previousFilename?: string;
  patch?: string;
}

export interface GitHubCompareResult {
  baseSha: string;
  headSha: string;
  files: GitHubChangedFile[];
}

/** A PR as listed by `listPullRequests` (enough to decide what to review). */
export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  author: string | null;
  state: string;
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  updatedAt: string;
  htmlUrl: string;
}

/** How the client authenticates — drives whether comments can be posted. */
export type GitHubAuthMode = 'app' | 'token' | 'anonymous';

export interface ReviewCommentInput {
  path: string;
  line: number;
  body: string;
  side?: 'RIGHT' | 'LEFT';
  startLine?: number;
}

export interface PullRequestCommentInput {
  body: string;
}

/** Interface so the reviewer can be tested against a mock GitHub. */
export interface GitHubApi {
  getRepository(owner: string, repo: string): Promise<GitHubRepo>;
  listInstallationRepositories(installationId: number | string): Promise<GitHubRepo[]>;
  getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest>;
  listPullRequests(owner: string, repo: string, state?: 'open' | 'closed' | 'all'): Promise<GitHubPullRequestSummary[]>;
  getPullRequestDiff(owner: string, repo: string, number: number): Promise<string>;
  compareCommits(owner: string, repo: string, base: string, head: string): Promise<GitHubCompareResult>;
  getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string>;
  createReviewComment(
    owner: string,
    repo: string,
    number: number,
    commitId: string,
    comment: ReviewCommentInput,
  ): Promise<{ id: number }>;
  createIssueComment(owner: string, repo: string, number: number, comment: PullRequestCommentInput): Promise<{ id: number }>;
  /** Existing PR comments — lets a re-triggered review detect it already posted. */
  listIssueComments?(owner: string, repo: string, number: number): Promise<Array<{ id: number; body: string }>>;
  /** Edit an existing comment so one PR keeps exactly one review comment. */
  updateIssueComment?(
    owner: string,
    repo: string,
    commentId: number,
    comment: PullRequestCommentInput,
  ): Promise<{ id: number }>;
  listBranchNames(owner: string, repo: string): Promise<string[]>;
}

export interface GitHubClientOptions {
  appId?: string;
  privateKey?: string;
  installationId?: number | string;
  token?: string;
  baseUrl?: string;
  /**
   * Allow unauthenticated reads of public repositories. Without it a client
   * with no usable credential throws instead of silently calling GitHub.
   */
  anonymous?: boolean;
  /**
   * Use the credential for reads only. Set when the installation is known to
   * lack write permissions, so a write fails with an actionable error instead
   * of a bare 403 from GitHub.
   */
  forceReadOnly?: boolean;
}

export class GitHubClient implements GitHubApi {
  private baseUrl: string;
  private token: string | null;
  private appId?: string;
  private privateKey?: string;
  private installationId?: number | string;
  private tokenExpiry = 0;
  private allowAnonymous: boolean;
  /** Whether this client can post comments (needs a real credential). */
  readonly canComment: boolean;
  readonly mode: GitHubAuthMode;

  constructor(options: GitHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.token = options.token ?? null;
    this.appId = options.appId;
    this.privateKey = options.privateKey;
    this.installationId = options.installationId;
    this.allowAnonymous = options.anonymous ?? false;
    const appReady = Boolean(this.appId && this.privateKey && this.installationId !== undefined);
    this.mode = appReady ? 'app' : this.token ? 'token' : 'anonymous';
    // An installation token or a PAT can write; anonymous traffic cannot, and
    // a read-only client refuses to write even with a token attached.
    this.canComment = options.forceReadOnly ? false : Boolean(this.token) || appReady;
  }

  /** Resolves a bearer token, or null when the request must go out anonymously. */
  private async authToken(): Promise<string | null> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    if (this.token && this.tokenExpiry === 0) return this.token;
    if (!this.appId || !this.privateKey || this.installationId === undefined) {
      if (this.token) return this.token;
      if (this.allowAnonymous) return null;
      throw new AppError('GITHUB_NOT_CONFIGURED', 'GitHub App credentials are not configured.', 503);
    }
    const jwt = createAppJwt(this.appId, this.privateKey.replace(/\\n/g, '\n'));
    const { token, expiresAt } = await createInstallationToken(this.installationId, jwt, this.baseUrl);
    this.token = token;
    this.tokenExpiry = new Date(expiresAt).getTime() - 60_000;
    return token;
  }

  private async request<T>(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<T> {
    const token = await this.authToken();
    // Writing without a writable credential is never going to work — fail with
    // an actionable message instead of a bare 401/403 from GitHub.
    if (init.method && init.method !== 'GET' && !this.canComment) {
      throw new AppError(
        'GITHUB_WRITE_DENIED',
        'This server has no GitHub credential that may post comments. Install the GitHub App on the repository (pull_requests: write) or set GITHUB_TOKEN in .env.',
        403,
      );
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'codebase-intelligence',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 404) {
      throw new AppError('GITHUB_NOT_FOUND', `GitHub resource not found: ${path}`, 404);
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      throw new AppError('GITHUB_RATE_LIMITED', `GitHub rate limit hit (remaining=${remaining ?? '?'}).`, 429);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError('GITHUB_API_ERROR', `GitHub request failed (${res.status}): ${text.slice(0, 300)}`, 502);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
    const json = await this.request<{
      id: number;
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
      language: string | null;
      owner: { login: string };
    }>(`/repos/${owner}/${repo}`);
    return {
      id: json.id,
      owner: json.owner.login,
      name: json.name,
      defaultBranch: json.default_branch,
      private: json.private,
      language: json.language,
    };
  }

  async listInstallationRepositories(installationId: number | string): Promise<GitHubRepo[]> {
    const out: GitHubRepo[] = [];
    let page = 1;
    for (;;) {
      const json = await this.request<{
        repositories: Array<{
          id: number;
          name: string;
          default_branch: string;
          private: boolean;
          language: string | null;
          owner: { login: string };
        }>;
      }>(`/installation/repositories?per_page=100&page=${page}`, {}, 'application/vnd.github+json');
      for (const r of json.repositories) {
        out.push({
          id: r.id,
          owner: r.owner.login,
          name: r.name,
          defaultBranch: r.default_branch,
          private: r.private,
          language: r.language,
        });
      }
      if (json.repositories.length < 100) break;
      page++;
    }
    return out;
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest> {
    const json = await this.request<{
      number: number;
      title: string;
      state: string;
      draft: boolean;
      body: string | null;
      user: { login: string } | null;
      base: { sha: string; ref: string };
      head: { sha: string; ref: string };
    }>(`/repos/${owner}/${repo}/pulls/${number}`);
    return {
      number: json.number,
      title: json.title,
      author: json.user?.login ?? null,
      baseSha: json.base.sha,
      headSha: json.head.sha,
      baseBranch: json.base.ref,
      headBranch: json.head.ref,
      state: json.state,
      draft: json.draft,
      body: json.body,
    };
  }

async listPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<GitHubPullRequestSummary[]> {
    const json = await this.request<Array<{
      number: number;
      title: string;
      state: string;
      draft: boolean;
      html_url: string;
      updated_at: string;
      user: { login: string } | null;
      base: { sha: string; ref: string };
      head: { sha: string; ref: string };
    }>>(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=30&sort=updated&direction=desc`);
    return json.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? null,
      state: p.state,
      draft: p.draft,
      baseBranch: p.base.ref,
      headBranch: p.head.ref,
      baseSha: p.base.sha,
      headSha: p.head.sha,
      updatedAt: p.updated_at,
      htmlUrl: p.html_url,
    }));
  }

  async getPullRequestDiff(owner: string, repo: string, number: number): Promise<string> {
    const token = await this.authToken();
    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/pulls/${number}`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: 'application/vnd.github.v3.diff',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'codebase-intelligence',
      },
    });
    if (!res.ok) throw new AppError('GITHUB_API_ERROR', `Failed to fetch PR diff (${res.status}).`, 502);
    const text = await res.text();
    // Bound the diff so a huge PR cannot exhaust memory or the AI budget.
    return text.length > 400_000 ? text.slice(0, 400_000) : text;
  }

  async compareCommits(owner: string, repo: string, base: string, head: string): Promise<GitHubCompareResult> {
    const json = await this.request<{
      base_commit: { sha: string };
      head_commit?: { sha: string } | null;
      files?: Array<{
        filename: string;
        status: GitHubChangedFile['status'];
        additions: number;
        deletions: number;
        previous_filename?: string;
        patch?: string;
      }>;
    }>(`/repos/${owner}/${repo}/compare/${base}...${head}`);
    return {
      baseSha: json.base_commit.sha,
      headSha: json.head_commit?.sha ?? head,
      files: (json.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        previousFilename: f.previous_filename,
        patch: f.patch,
      })),
    };
  }

  async getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string> {
    const json = await this.request<{ commit: { sha: string } }>(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    );
    return json.commit.sha;
  }

  async listBranchNames(owner: string, repo: string): Promise<string[]> {
    const json = await this.request<Array<{ name: string }>>(`/repos/${owner}/${repo}/branches?per_page=100`);
    return json.map((b) => b.name);
  }

  async createReviewComment(
    owner: string,
    repo: string,
    number: number,
    commitId: string,
    comment: ReviewCommentInput,
  ): Promise<{ id: number }> {
    const body = {
      body: comment.body,
      commit_id: commitId,
      path: comment.path,
      line: comment.line,
      side: comment.side ?? 'RIGHT',
      ...(comment.startLine ? { start_line: comment.startLine, start_side: comment.side ?? 'RIGHT' } : {}),
    };
    const json = await this.request<{ id: number }>(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    log.info('github.comment.created', { owner, repo, number, commentId: json.id });
    return json;
  }

  async createIssueComment(
    owner: string,
    repo: string,
    number: number,
    comment: PullRequestCommentInput,
  ): Promise<{ id: number }> {
    const json = await this.request<{ id: number }>(`/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: comment.body }),
    });
    log.info('github.issue_comment.created', { owner, repo, number, commentId: json.id });
    return json;
  }

  async listIssueComments(
    owner: string,
    repo: string,
    number: number,
  ): Promise<Array<{ id: number; body: string }>> {
    const json = await this.request<Array<{ id: number; body?: string }>>(
      `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    );
    return json.map((c) => ({ id: c.id, body: c.body ?? '' }));
  }

  async updateIssueComment(
    owner: string,
    repo: string,
    commentId: number,
    comment: PullRequestCommentInput,
  ): Promise<{ id: number }> {
    const json = await this.request<{ id: number }>(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: comment.body }),
    });
    log.info('github.issue_comment.updated', { owner, repo, commentId: json.id });
    return json;
  }
}

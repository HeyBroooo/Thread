import { createLogger, getConfig, isAppError } from '@cbi/shared';
import { GitHubClient, createAppJwt, createInstallationToken } from '@cbi/github';

const log = createLogger({ component: 'api.github' });

/**
 * How (and whether) this server can talk to GitHub for one repository.
 *
 * Four tiers, in order of preference:
 *  1. a GitHub App installation that covers the repo *and* may write,
 *  2. a personal access token (GITHUB_TOKEN / a token pasted in the UI) — the
 *     reliable path for private repositories,
 *  3. a GitHub App installation used for reads only,
 *  4. anonymous access — public reads only, and only while the 60/hour
 *     unauthenticated budget lasts.
 *
 * The capability is reported in full so the UI can explain *why* a comment was
 * not posted and link straight to the setting that fixes it.
 */
export interface CommentCapability {
  mode: 'app' | 'token' | 'anonymous';
  canComment: boolean;
  appConfigured: boolean;
  requiresInstall: boolean;
  message: string;
  /** Where the user can install the app on a repository/account. */
  installUrl: string | null;
  /** The app's permission settings page. */
  appSettingsUrl: string | null;
  /** The app's *permissions* page (grant Pull requests / Issues: write). */
  appPermissionsUrl: string | null;
  /** The installation's repository-selection page. */
  installationUrl: string | null;
  installationId: number | null;
  /** Declared permissions the app is still missing (e.g. `pull_requests: write`). */
  missingPermissions: string[];
  /**
   * The App declares write permissions but this installation has not accepted
   * them yet — the installer must approve the permission update on GitHub.
   */
  permissionUpdatePending: boolean;
  /** How many repositories the installation grants access to (0 = no repos). */
  accessibleRepoCount: number | null;
  /** Whether the credential can actually read this repository. */
  repoAccessible: boolean | null;
  /** True when unauthenticated reads are exhausted. */
  rateLimited: boolean;
  /** Whether a token came from `.env` or the UI. */
  tokenSource: 'env' | 'runtime' | 'none';
}

export interface GitHubAccess {
  client: GitHubClient;
  capability: CommentCapability;
}

const REQUIRED_WRITE_PERMISSIONS = ['pull_requests: write', 'issues: write'] as const;

function appHeaders(jwt: string): Record<string, string> {
  return {
    authorization: `Bearer ${jwt}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'codebase-intelligence',
  };
}

let slugCache: string | null | undefined;
let declaredPermissionsCache: Record<string, string> | undefined;

/** Best-effort lookup of the GitHub App slug (for install/settings links). */
async function appSlug(appId: string, privateKey: string): Promise<string | null> {
  if (slugCache !== undefined) return slugCache;
  try {
    const jwt = createAppJwt(appId, privateKey.replace(/\\n/g, '\n'));
    const res = await fetch('https://api.github.com/app', { headers: appHeaders(jwt) });
    if (!res.ok) {
      slugCache = null;
      return null;
    }
    const json = (await res.json()) as { slug?: string };
    slugCache = json.slug ?? null;
  } catch {
    slugCache = null;
  }
  return slugCache;
}

/**
 * The permissions the App *declares*. When these are broader than what an
 * installation was granted, GitHub is waiting for the installer to accept the
 * change — a state that looks identical to "no permissions" from the token.
 */
async function declaredAppPermissions(appId: string, privateKey: string): Promise<Record<string, string>> {
  if (declaredPermissionsCache !== undefined) return declaredPermissionsCache;
  try {
    const jwt = createAppJwt(appId, privateKey.replace(/\\n/g, '\n'));
    const res = await fetch('https://api.github.com/app', { headers: appHeaders(jwt) });
    if (!res.ok) {
      declaredPermissionsCache = {};
      return declaredPermissionsCache;
    }
    const json = (await res.json()) as { permissions?: Record<string, string> };
    declaredPermissionsCache = json.permissions ?? {};
  } catch {
    declaredPermissionsCache = {};
  }
  return declaredPermissionsCache;
}

interface InstallationListing {
  id: number;
  account: string | null;
  repositorySelection: string | null;
}

async function listInstallations(jwt: string): Promise<InstallationListing[]> {
  const res = await fetch('https://api.github.com/app/installations?per_page=100', {
    headers: appHeaders(jwt),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as Array<{
    id: number;
    account?: { login?: string } | null;
    repository_selection?: string;
  }>;
  return json.map((i) => ({
    id: i.id,
    account: i.account?.login ?? null,
    repositorySelection: i.repository_selection ?? null,
  }));
}

interface MintedToken {
  token: string | null;
  permissions: Record<string, string>;
  selection: string | null;
  /** How many repositories this installation actually grants access to. */
  repositoryCount: number | null;
}

/** Mint an installation token and learn which permissions the app actually has. */
async function mintInstallationToken(jwt: string, installationId: number): Promise<MintedToken> {
  // `POST /app/installations/{id}/access_tokens` is the single call that both
  // mints the token and reports the *granted* permissions. An installation
  // whose permissions were never accepted reports `{}` even when the App itself
  // declares plenty.
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: appHeaders(jwt),
  });
  if (!res.ok) {
    log.warn('github.installation_token_failed', { installationId, status: res.status });
    return { token: null, permissions: {}, selection: null, repositoryCount: null };
  }
  const json = (await res.json()) as {
    token?: string;
    permissions?: Record<string, string>;
    repository_selection?: string;
  };
  const token = json.token ?? null;
  let repositoryCount: number | null = null;
  if (token) {
    try {
      const r = await fetch('https://api.github.com/installation/repositories?per_page=1', {
        headers: appHeaders(token),
      });
      if (r.ok) repositoryCount = ((await r.json()) as { total_count?: number }).total_count ?? null;
    } catch {
      /* not fatal — the count is only used for diagnostics */
    }
  }
  return {
    token,
    permissions: json.permissions ?? {},
    selection: json.repository_selection ?? null,
    repositoryCount,
  };
}

/** Can this token read the repository? (Also proves the repo is selected.) */
async function probeRepoAccess(token: string, owner: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: appHeaders(token),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function missingWritePermissions(permissions: Record<string, string>): string[] {
  const missing: string[] = [];
  if (permissions['pull_requests'] !== 'write') missing.push('pull_requests: write');
  if (permissions['issues'] !== 'write') missing.push('issues: write');
  return missing;
}

interface AccessContext {
  slug: string | null;
  installationId: number | null;
  missingPermissions: string[];
  permissionUpdatePending: boolean;
  accessibleRepoCount: number | null;
  repoAccessible: boolean | null;
  tokenSource: 'env' | 'runtime' | 'none';
}

function links(ctx: AccessContext): Pick<
  CommentCapability,
  'installUrl' | 'appSettingsUrl' | 'appPermissionsUrl' | 'installationUrl' | 'installationId'
> {
  return {
    installUrl: ctx.slug ? `https://github.com/apps/${ctx.slug}/installations/new` : null,
    appSettingsUrl: ctx.slug ? `https://github.com/settings/apps/${ctx.slug}` : null,
    appPermissionsUrl: ctx.slug ? `https://github.com/settings/apps/${ctx.slug}/permissions` : null,
    installationUrl: ctx.installationId
      ? `https://github.com/settings/installations/${ctx.installationId}`
      : null,
    installationId: ctx.installationId,
  };
}

function tokenAccess(token: string, ctx: AccessContext): GitHubAccess {
  return {
    client: new GitHubClient({ token }),
    capability: {
      mode: 'token',
      canComment: true,
      appConfigured: Boolean(getConfig().github.appId && getConfig().github.privateKey),
      requiresInstall: false,
      message:
        ctx.tokenSource === 'env'
          ? 'Using GITHUB_TOKEN from .env — reviews are read from GitHub and posted as PR comments, including private repositories.'
          : 'Using the GitHub token saved in this app — reviews are read from GitHub and posted as PR comments, including private repositories.',
      ...links(ctx),
      missingPermissions: [],
      permissionUpdatePending: false,
      accessibleRepoCount: ctx.accessibleRepoCount,
      repoAccessible: ctx.repoAccessible,
      rateLimited: false,
      tokenSource: ctx.tokenSource,
    },
  };
}

/**
 * Resolve a client for `owner/name`, falling back through the tiers instead of
 * throwing, so reads keep working when the GitHub App is not installed on the
 * repository.
 */
export async function resolveGitHubAccess(owner: string, name: string): Promise<GitHubAccess> {
  const config = getConfig();
  const appId = config.github.appId;
  const privateKey = config.github.privateKey;
  const appConfigured = Boolean(appId && privateKey);
  const { resolveToken, tokenStatus } = await import('./credentials.js');
  const pat = resolveToken();
  const status = tokenStatus();
  const slug = appConfigured ? await appSlug(appId!, privateKey!) : null;

  const ctx: AccessContext = {
    slug,
    installationId: null,
    missingPermissions: [],
    permissionUpdatePending: false,
    accessibleRepoCount: null,
    repoAccessible: null,
    tokenSource: status.source,
  };

  let appToken: string | null = null;
  let appCanWrite = false;
  let appError: string | null = null;

  if (appConfigured) {
    try {
      const jwt = createAppJwt(appId!, privateKey!.replace(/\\n/g, '\n'));

      // Tier 1: the app is installed on this exact repository.
      let installationId: number | null = null;
      const direct = await fetch(`https://api.github.com/repos/${owner}/${name}/installation`, {
        headers: appHeaders(jwt),
      });
      if (direct.ok) {
        installationId = ((await direct.json()) as { id: number }).id;
      } else if (direct.status === 401 || direct.status === 403) {
        appError = 'GitHub rejected the App credentials — check GITHUB_APP_ID and GITHUB_PRIVATE_KEY.';
      } else {
        // Tier 1b: installed on the account, but this repository was not
        // selected. The installation token still reads public repositories and
        // is what removes the 60/hour anonymous limit.
        const installations = await listInstallations(jwt);
        const match = installations.find(
          (i) => i.account?.toLowerCase() === owner.replace(/^.*\//, '').toLowerCase(),
        );
        if (match) installationId = match.id;
        else appError = `The GitHub App is not installed on ${owner}.`;
      }

      if (installationId !== null) {
        ctx.installationId = installationId;
        const minted = await mintInstallationToken(jwt, installationId);
        appToken = minted.token;
        ctx.accessibleRepoCount = minted.repositoryCount;
        ctx.missingPermissions = missingWritePermissions(minted.permissions);
        // The App may *declare* write permissions the installation has not
        // accepted yet. Detecting that here is what turns a confusing "no
        // permissions" message into the actual next step.
        const declared = await declaredAppPermissions(appId!, privateKey!);
        const declaredWrite =
          declared['pull_requests'] === 'write' && declared['issues'] === 'write';
        ctx.permissionUpdatePending = declaredWrite && ctx.missingPermissions.length > 0;
        appCanWrite = appToken !== null && ctx.missingPermissions.length === 0;
        ctx.repoAccessible = appToken ? await probeRepoAccess(appToken, owner, name) : false;
      }
    } catch (e) {
      const code = isAppError(e) ? e.code : 'UNKNOWN';
      appError =
        code === 'GITHUB_APP_KEY_INVALID'
          ? 'GITHUB_PRIVATE_KEY could not be used to sign a request.'
          : e instanceof Error
            ? e.message
            : String(e);
      log.warn('github.app_access_unavailable', { owner, name, code, message: appError });
    }
  }

  // The app can write and reach the repo — the best credential there is.
  if (appToken && appCanWrite && ctx.repoAccessible !== false) {
    return {
      client: new GitHubClient({
        appId: appId!,
        privateKey: privateKey!,
        installationId: ctx.installationId!,
        token: appToken,
      }),
      capability: {
        mode: 'app',
        canComment: true,
        appConfigured: true,
        requiresInstall: false,
        message: `The GitHub App is installed on ${owner} — reviews are posted as PR comments.`,
        ...links(ctx),
        missingPermissions: [],
        permissionUpdatePending: false,
        accessibleRepoCount: ctx.accessibleRepoCount,
        repoAccessible: true,
        rateLimited: false,
        tokenSource: status.source,
      },
    };
  }

  // A token is the reliable path for private repositories and for apps that
  // were never granted write permissions.
  if (pat) return tokenAccess(pat, ctx);

  const configuredNote = appConfigured
    ? ''
    : ' No GitHub App is configured. Add GITHUB_APP_ID / GITHUB_PRIVATE_KEY (or paste a token) to post review comments.';

  if (appToken) {
    const reason = (() => {
      // A repository the app cannot even read outranks a permission gap: a
      // private repo that was never selected is invisible until it is added.
      if (ctx.repoAccessible === false) {
        return `The GitHub App cannot read ${owner}/${name} — the repository is not selected for the installation${
          ctx.installationId
            ? ` (add it at https://github.com/settings/installations/${ctx.installationId})`
            : ''
        }. Private repositories need it selected.`;
      }
      if (ctx.permissionUpdatePending) {
        return `The GitHub App declares the right permissions, but its installation has not accepted them yet — GitHub keeps the old grants until the installer approves the request. Open https://github.com/settings/installations/${
          ctx.installationId
        }, click “Review request” and accept.`;
      }
      if (ctx.missingPermissions.length > 0) {
        return `The GitHub App is installed on ${owner} but has no write permissions (missing ${ctx.missingPermissions.join(
          ', ',
        )}). Grant them in the App's Permissions page, then change any PR (or click “Review now”).`;
      }
      if (ctx.accessibleRepoCount === 0) {
        return `The GitHub App installation grants access to no repositories, so it has no scope to comment with — select ${owner}/${name} under Repository access on the installation page.`;
      }
      return 'The GitHub App cannot post comments for this repository.';
    })();
    return {
      client: new GitHubClient({
        appId: appId!,
        privateKey: privateKey!,
        installationId: ctx.installationId!,
        token: appToken,
        forceReadOnly: true,
      }),
      capability: {
        mode: 'app',
        canComment: false,
        appConfigured: true,
        requiresInstall: ctx.repoAccessible === false,
        message: `${reason} Meanwhile reviews still run and are listed here; paste a GitHub token to post comments now.`,
        ...links(ctx),
        missingPermissions: ctx.missingPermissions,
        permissionUpdatePending: ctx.permissionUpdatePending,
        accessibleRepoCount: ctx.accessibleRepoCount,
        repoAccessible: ctx.repoAccessible,
        rateLimited: false,
        tokenSource: status.source,
      },
    };
  }

  // Anonymous: public reads only, and the 60/hour budget is easy to exhaust.
  const anonymous = new GitHubClient({ anonymous: true });
  const rateLimited = await anonymousRateLimited();
  return {
    client: anonymous,
    capability: {
      mode: 'anonymous',
      canComment: false,
      appConfigured,
      requiresInstall: appConfigured,
      message: rateLimited
        ? `GitHub's unauthenticated rate limit is exhausted, so reads are failing right now. Paste a GitHub token (or fix the App installation) to restore access.${configuredNote}`
        : `${appError ?? `Reading ${owner}/${name} anonymously.`} Comments need a GitHub App installation or a token.${configuredNote}`,
      ...links(ctx),
      missingPermissions: [],
      permissionUpdatePending: false,
      accessibleRepoCount: ctx.accessibleRepoCount,
      repoAccessible: null,
      rateLimited,
      tokenSource: status.source,
    },
  };
}

/** `/rate_limit` is free and tells us whether anonymous reads can work at all. */
async function anonymousRateLimited(): Promise<boolean> {
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'codebase-intelligence' },
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { resources?: { core?: { remaining?: number } } };
    return (json.resources?.core?.remaining ?? 1) <= 0;
  } catch {
    return false;
  }
}

/** Backwards-compatible helper: the client only. */
export async function githubClientFor(owner: string, name: string): Promise<GitHubClient> {
  const access = await resolveGitHubAccess(owner, name);
  if (!access.capability.canComment) {
    log.warn('github.write_unavailable', { owner, name, message: access.capability.message });
  }
  return access.client;
}

/**
 * The token git should clone with: the App installation when it exists, else
 * the saved PAT (which is what makes private repositories cloneable without an
 * App installation).
 */
export async function resolveCloneCredential(options: {
  owner: string;
  name: string;
}): Promise<{ token: string | null; installationId: number | null; source: 'app' | 'token' | 'none' }> {
  const config = getConfig();
  if (config.github.appId && config.github.privateKey) {
    try {
      const jwt = createAppJwt(config.github.appId, config.github.privateKey.replace(/\\n/g, '\n'));
      const res = await fetch(
        `https://api.github.com/repos/${options.owner}/${options.name}/installation`,
        { headers: appHeaders(jwt) },
      );
      if (res.ok) {
        const id = ((await res.json()) as { id: number }).id;
        const { token } = await createInstallationToken(id, jwt);
        return { token, installationId: id, source: 'app' };
      }
    } catch (e) {
      log.warn('clone.app_token_failed', {
        owner: options.owner,
        name: options.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const { resolveToken } = await import('./credentials.js');
  const pat = resolveToken();
  if (pat) return { token: pat, installationId: null, source: 'token' };
  return { token: null, installationId: null, source: 'none' };
}

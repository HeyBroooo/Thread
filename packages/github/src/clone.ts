import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '@cbi/shared';
import { createAppJwt, createInstallationToken } from './auth.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** What a parsed repository reference gives us. */
export interface RepoRef {
  owner: string;
  name: string;
  branch: string | null;
}

/**
 * Accepts the shapes people actually paste: a full clone URL, an https page
 * URL, `owner/name`, or `owner/name#branch`. Returns null when nothing parses.
 */
export function parseRepoReference(input: string): RepoRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // Split off a `#branch` fragment.
  let body = raw;
  let branch: string | null = null;
  const hash = body.indexOf('#');
  if (hash >= 0) {
    branch = body.slice(hash + 1).trim() || null;
    body = body.slice(0, hash);
  }

  // Strip a trailing `.git` and any trailing slash.
  body = body.replace(/\.git$/i, '').replace(/\/+$/, '');

  const parts = body.split('/').filter(Boolean);
  let owner: string | undefined;
  let name: string | undefined;

  if (parts.length >= 2 && /^https?:$/.test(parts[0]!)) {
    owner = parts[parts.length - 2];
    name = parts[parts.length - 1];
  } else if (parts.length >= 2) {
    owner = parts[parts.length - 2];
    name = parts[parts.length - 1];
  } else if (parts.length === 1 && parts[0]!.includes(':') && !parts[0]!.includes('://')) {
    // scp-like git@github.com:owner/name
    const [host, tail] = parts[0]!.split(':');
    const segs = (tail ?? '').split('/').filter(Boolean);
    if (segs.length >= 2) {
      owner = segs[segs.length - 2];
      name = segs[segs.length - 1];
    } else {
      void host;
    }
  }

  if (!owner || !name) return null;
  return { owner: owner.replace(/\.git$/i, ''), name: name.replace(/\.git$/i, ''), branch };
}

/** Where a repository's checkout lives on disk. */
export function checkoutDirFor(owner: string, name: string, baseDir?: string): string {
  const base = baseDir ?? process.env.CBI_CHECKOUT_DIR ?? resolve(process.cwd(), '.cbi', 'checkouts');
  return resolve(base, `${owner}__${name}`);
}

async function git(args: string[], cwd: string, token?: string | null): Promise<string> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
  } as NodeJS.ProcessEnv;
  if (token) {
    // Keep the token out of argv so it never lands in a process listing.
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  }
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env,
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/**
 * Resolves the installation that can reach a repository and mints a short-lived
 * clone token for it. Public repositories still work without an App — git can
 * clone them anonymously — so an App failure is reported, not fatal, unless the
 * repository turns out to be private.
 */
export async function resolveCloneToken(options: {
  appId?: string | null;
  privateKey?: string | null;
  owner: string;
  name: string;
  apiBaseUrl?: string;
}): Promise<{ token: string | null; installationId: number | null }> {
  const { appId, privateKey, owner, name } = options;
  if (!appId || !privateKey) return { token: null, installationId: null };

  const apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const jwt = createAppJwt(appId, privateKey.replace(/\\n/g, '\n'));

  // GET /repos/{owner}/{repo}/installation answers "does my App touch this repo?"
  const res = await fetch(`${apiBaseUrl}/repos/${owner}/${name}/installation`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'codebase-intelligence',
    },
  });

  if (res.status === 404) {
    throw new AppError(
      'REPO_ACCESS_REQUIRED',
      `The GitHub App is not installed on ${owner}/${name}. Install it from https://github.com/settings/installations (choose this app, then select ${owner}/${name}) and retry.`,
      403,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new AppError(
      'GITHUB_AUTH_FAILED',
      'GitHub rejected the App credentials. Check GITHUB_APP_ID and GITHUB_PRIVATE_KEY.',
      502,
    );
  }
  if (!res.ok) {
    throw new AppError('GITHUB_API_ERROR', `Could not check App access to ${owner}/${name} (${res.status}).`, 502);
  }

  const json = (await res.json()) as { id: number };
  const { token } = await createInstallationToken(json.id, jwt, apiBaseUrl);
  return { token, installationId: json.id };
}

export interface CloneResult {
  checkoutPath: string;
  branch: string;
  commitSha: string;
  reused: boolean;
}

/**
 * Clones a repository into the checkout directory, or pulls the latest
 * revision when the directory already holds a clone. This is the step that
 * makes "paste a URL, get a graph" work without a local checkout.
 */
export async function cloneOrPull(options: {
  owner: string;
  name: string;
  branch?: string | null;
  token?: string | null;
  baseDir?: string;
  /** Directory that already contains a git checkout — left untouched. */
  existingPath?: string | null;
}): Promise<CloneResult> {
  const requestedBranch = options.branch ?? undefined;
  const { owner, name } = options;
  const token = options.token ?? undefined;

  // An explicit local checkout always wins — never clone over real files.
  if (options.existingPath && existsSync(options.existingPath)) {
    const sha = await git(['rev-parse', 'HEAD'], options.existingPath, token).catch(() => '');
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], options.existingPath, token).catch(() => 'HEAD');
    return { checkoutPath: options.existingPath, branch: branch.trim() || 'HEAD', commitSha: sha.trim(), reused: true };
  }

  const dir = checkoutDirFor(owner, name, options.baseDir);
  const isClone = !existsSync(resolve(dir, '.git'));

  if (isClone) {
    mkdirSync(dirname(dir), { recursive: true });
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const url = `https://github.com/${owner}/${name}.git`;
    try {
      await git(['clone', '--origin', 'origin', ...(requestedBranch ? ['--branch', requestedBranch] : []), url, dir], process.cwd(), token);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      const message = e instanceof Error ? e.message : String(e);
      if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(message)) {
        throw new AppError(
          'REPO_ACCESS_REQUIRED',
          `Could not authenticate while cloning ${owner}/${name}. If it is private, install the GitHub App on that repository, then retry.`,
          403,
        );
      }
      if (/Remote branch .* not found|couldn't find remote ref/i.test(message)) {
        throw new AppError(
          'BRANCH_NOT_FOUND',
          `Branch "${requestedBranch ?? ''}" was not found in ${owner}/${name}. Leave the branch blank to use the default branch.`,
          400,
        );
      }
      throw new AppError('CLONE_FAILED', `Cloning ${owner}/${name} failed: ${message.slice(0, 300)}`, 502);
    }
  } else {
    await git(['fetch', '--all', '--prune', '--tags'], dir, token).catch(() => undefined);
    if (requestedBranch) {
      await git(['checkout', requestedBranch], dir, token).catch(() => undefined);
      await git(['pull', '--ff-only', 'origin', requestedBranch], dir, token).catch(() => undefined);
    } else {
      await git(['pull', '--ff-only'], dir, token).catch(() => undefined);
    }
  }

  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir, token).catch(() => 'HEAD')).trim() || 'HEAD';
  const commitSha = (await git(['rev-parse', 'HEAD'], dir, token).catch(() => '')).trim();
  return { checkoutPath: dir, branch, commitSha, reused: !isClone };
}
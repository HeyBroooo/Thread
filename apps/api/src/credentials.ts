import { createLogger } from '@cbi/shared';
import { readState, writeState } from './state.js';

const log = createLogger({ component: 'credentials' });

/**
 * The GitHub credential this server writes comments with.
 *
 * A GitHub App installation is the preferred credential, but a freshly created
 * App often has no permissions granted and no repositories selected yet — in
 * that state the App can read nothing and write nothing. A personal access
 * token is the escape hatch: it works for public *and* private repositories
 * with a single paste, no App configuration required.
 *
 * The token can come from `.env` (GITHUB_TOKEN / GITHUB_PAT) or from the UI,
 * which stores it in `.cbi/state/credentials.json` so it survives a restart.
 * Environment variables always win so a deployment can override the UI.
 */

interface PersistedCredentials {
  token: string | null;
  login: string | null;
  savedAt: string | null;
}

let runtime: PersistedCredentials = hydrate();

function hydrate(): PersistedCredentials {
  const state = readState<PersistedCredentials>('credentials.json', {
    token: null,
    login: null,
    savedAt: null,
  });
  return {
    token: typeof state.token === 'string' && state.token.trim() ? state.token.trim() : null,
    login: state.login ?? null,
    savedAt: state.savedAt ?? null,
  };
}

function envToken(): string | null {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_PAT?.trim() || null;
}

/** The token to authenticate with, env first so deployments can override. */
export function resolveToken(): string | null {
  return envToken() ?? runtime.token;
}

export interface TokenStatus {
  hasToken: boolean;
  source: 'env' | 'runtime' | 'none';
  login: string | null;
  masked: string | null;
  savedAt: string | null;
}

export function tokenStatus(): TokenStatus {
  const env = envToken();
  if (env) {
    return { hasToken: true, source: 'env', login: null, masked: mask(env), savedAt: null };
  }
  if (runtime.token) {
    return {
      hasToken: true,
      source: 'runtime',
      login: runtime.login,
      masked: mask(runtime.token),
      savedAt: runtime.savedAt,
    };
  }
  return { hasToken: false, source: 'none', login: null, masked: null, savedAt: null };
}

function mask(token: string): string {
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

/**
 * Validate a token against GitHub and, if it works, remember it. Returns the
 * authenticated login. Throws a readable message when GitHub rejects it.
 */
export async function saveToken(token: string): Promise<{ login: string; scopes: string | null }> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Paste a token first.');

  const res = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${trimmed}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'codebase-intelligence',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitHub rejected that token (${res.status}). ${body.slice(0, 160)}`.trim(),
    );
  }
  const json = (await res.json()) as { login?: string };
  const login = json.login ?? 'unknown';
  const scopes = res.headers.get('x-oauth-scopes');
  runtime = { token: trimmed, login, savedAt: new Date().toISOString() };
  writeState('credentials.json', runtime);
  log.info('credentials.token_saved', { login, scopes });
  return { login, scopes };
}

export function clearToken(): void {
  runtime = { token: null, login: null, savedAt: null };
  writeState('credentials.json', runtime);
  log.info('credentials.token_cleared');
}

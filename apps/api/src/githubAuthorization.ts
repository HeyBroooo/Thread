import * as db from "@cbi/db";
import { getConfig } from "@cbi/shared";
import { encrypt, decrypt } from "./credentials.js";
import { readState, writeState } from "./state.js";

export interface GitHubAuthorization {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  userId: number;
  login: string;
}
interface Stored {
  encrypted: string;
}
function durable() {
  if (!db.hasDatabase() && getConfig().nodeEnv === "production")
    throw new Error("GitHub authorization requires durable storage.");
}
export async function saveAuthorization(
  workspace: string,
  value: GitHubAuthorization,
): Promise<void> {
  durable();
  const encrypted = encrypt(JSON.stringify(value), workspace);
  if (db.hasDatabase()) {
    await db.query(
      "INSERT INTO github_user_authorizations (organization_id, encrypted_authorization) VALUES ($1,$2) ON CONFLICT (organization_id) DO UPDATE SET encrypted_authorization=EXCLUDED.encrypted_authorization, updated_at=now()",
      [workspace, encrypted],
    );
  } else {
    const all = readState<Record<string, Stored>>(
      "github-authorizations.json",
      {},
    );
    all[workspace] = { encrypted };
    writeState("github-authorizations.json", all);
  }
}
export async function clearAuthorization(workspace: string): Promise<void> {
  durable();
  if (db.hasDatabase())
    await db.query(
      "DELETE FROM github_user_authorizations WHERE organization_id=$1",
      [workspace],
    );
  else {
    const all = readState<Record<string, Stored>>(
      "github-authorizations.json",
      {},
    );
    delete all[workspace];
    writeState("github-authorizations.json", all);
  }
}
async function storedAuthorization(
  workspace: string,
): Promise<GitHubAuthorization | null> {
  durable();
  const record = db.hasDatabase()
    ? await db.queryOne<{ encrypted: string } & Record<string, unknown>>(
        "SELECT encrypted_authorization AS encrypted FROM github_user_authorizations WHERE organization_id=$1",
        [workspace],
      )
    : readState<Record<string, Stored>>("github-authorizations.json", {})[
        workspace
      ];
  return record
    ? (JSON.parse(decrypt(record.encrypted, workspace)) as GitHubAuthorization)
    : null;
}
export async function exchangeGitHubCode(
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const config = getConfig().github;
  if (!config.clientId || !config.clientSecret)
    throw new Error("GitHub authorization is not configured.");
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      ...body,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = (await response.json()) as Record<string, unknown>;
  if (
    !response.ok ||
    tokens.error ||
    typeof tokens.access_token !== "string" ||
    tokens.token_type !== "bearer"
  )
    throw new Error("GitHub authorization was not completed.");
  return tokens;
}
export function authorizationFromTokens(
  tokens: Record<string, unknown>,
  user: { id: number; login: string },
): GitHubAuthorization {
  return {
    accessToken: tokens.access_token as string,
    refreshToken:
      typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    expiresAt:
      typeof tokens.expires_in === "number"
        ? Date.now() + tokens.expires_in * 1000
        : null,
    refreshExpiresAt:
      typeof tokens.refresh_token_expires_in === "number"
        ? Date.now() + tokens.refresh_token_expires_in * 1000
        : null,
    userId: user.id,
    login: user.login,
  };
}
const refreshing = new Map<string, Promise<GitHubAuthorization | null>>();
export async function getAuthorization(
  workspace: string,
): Promise<GitHubAuthorization | null> {
  const current = await storedAuthorization(workspace);
  if (
    !current ||
    current.expiresAt === null ||
    current.expiresAt > Date.now() + 60000
  )
    return current;
  const pending = refreshing.get(workspace);
  if (pending) return pending;
  const refresh = (async () => {
    if (
      !current.refreshToken ||
      (current.refreshExpiresAt !== null &&
        current.refreshExpiresAt <= Date.now())
    ) {
      await clearAuthorization(workspace);
      return null;
    }
    try {
      const tokens = await exchangeGitHubCode({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      });
      const next = authorizationFromTokens(tokens, {
        id: current.userId,
        login: current.login,
      });
      await saveAuthorization(workspace, next);
      return next;
    } catch {
      return null;
    }
  })();
  refreshing.set(workspace, refresh);
  try {
    return await refresh;
  } finally {
    refreshing.delete(workspace);
  }
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "archthread",
  };
}
export async function githubFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...githubHeaders(token), ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
}

export interface SelectedRepository {
  id: number;
  full_name: string;
  private: boolean;
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
}
/** The user's intersection with this installation, never the App's global repository list. */
export async function selectedRepository(
  token: string,
  installationId: number,
  owner: string,
  name: string,
): Promise<SelectedRepository | null> {
  const expected = `${owner}/${name}`.toLowerCase();
  for (let page = 1; page <= 100; page++) {
    const response = await githubFetch(
      `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      token,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      repositories?: SelectedRepository[];
      total_count?: number;
    };
    const repos = body.repositories ?? [];
    const repo = repos.find(
      (item) => item.full_name.toLowerCase() === expected,
    );
    if (repo) return repo;
    if (repos.length < 100 || page * 100 >= (body.total_count ?? Infinity))
      return null;
  }
  return null;
}

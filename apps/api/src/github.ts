import { AppError, getConfig } from "@cbi/shared";
import { GitHubClient, createAppJwt } from "@cbi/github";
import {
  getAuthorization,
  clearAuthorization,
  githubFetch,
  selectedRepository,
} from "./githubAuthorization.js";

export interface CommentCapability {
  mode: "app" | "token" | "anonymous";
  canComment: boolean;
  appConfigured: boolean;
  requiresInstall: boolean;
  message: string;
  installUrl: string | null;
  appSettingsUrl: string | null;
  appPermissionsUrl: string | null;
  installationUrl: string | null;
  installationId: number | null;
  missingPermissions: string[];
  permissionUpdatePending: boolean;
  accessibleRepoCount: number | null;
  repoAccessible: boolean | null;
  rateLimited: boolean;
  tokenSource: "none";
  authorizationRequired: boolean;
}
export interface GitHubAccess {
  client: GitHubClient;
  capability: CommentCapability;
  cloneToken?: string;
}
export function githubAppConfigured(): boolean {
  const config = getConfig().github;
  return Boolean(
    config.appId && config.privateKey && config.clientId && config.clientSecret,
  );
}
export function appJwt(): string {
  const config = getConfig().github;
  if (!config.appId || !config.privateKey)
    throw new Error("GitHub App is not configured.");
  return createAppJwt(config.appId, config.privateKey.replace(/\\n/g, "\n"));
}
export async function appInfo(): Promise<{
  slug: string;
  permissions: Record<string, string>;
}> {
  const response = await githubFetch("/app", appJwt());
  if (!response.ok) throw new Error("GitHub App is unavailable.");
  const app = (await response.json()) as {
    slug?: string;
    permissions?: Record<string, string>;
  };
  if (!app.slug || !/^[a-z0-9-]+$/i.test(app.slug))
    throw new Error("GitHub App is unavailable.");
  return { slug: app.slug, permissions: app.permissions ?? {} };
}
export function minimumAppPermissions(
  permissions: Record<string, string>,
): boolean {
  const allowed: Record<string, string> = {
    contents: "read",
    pull_requests: "write",
    issues: "write",
    metadata: "read",
  };
  return (
    permissions.contents === "read" &&
    permissions.pull_requests === "write" &&
    permissions.issues === "write" &&
    Object.entries(permissions).every(
      ([name, value]) => value === "none" || allowed[name] === value,
    )
  );
}
function connectUrl(owner: string, name: string): string {
  return `/api/github/connect/start?repo=${encodeURIComponent(`${owner}/${name}`)}`;
}
export async function resolveGitHubAccess(
  owner: string,
  name: string,
  workspace?: string,
): Promise<GitHubAccess> {
  const configured = githubAppConfigured();
  const capability: CommentCapability = {
    mode: "anonymous",
    canComment: false,
    appConfigured: configured,
    requiresInstall: true,
    message: configured
      ? "Enable GitHub reviews to select this repository and approve access on GitHub."
      : "GitHub connection is temporarily unavailable. Please contact the workspace administrator.",
    installUrl: configured ? connectUrl(owner, name) : null,
    appSettingsUrl: null,
    appPermissionsUrl: null,
    installationUrl: null,
    installationId: null,
    missingPermissions: [],
    permissionUpdatePending: false,
    accessibleRepoCount: null,
    repoAccessible: null,
    rateLimited: false,
    tokenSource: "none",
    authorizationRequired: true,
  };
  let userToken: string | null = null;
  if (workspace && configured) {
    const authorization = await getAuthorization(workspace);
    userToken = authorization?.accessToken ?? null;
    if (userToken) {
      // A discovered installation ID is never sufficient proof of user access.
      const installationResponse = await githubFetch(
        `/repos/${owner}/${name}/installation`,
        appJwt(),
      );
      if (installationResponse.ok) {
        const installation = (await installationResponse.json()) as {
          id: number;
          permissions?: Record<string, string>;
          suspended_at?: string | null;
        };
        const repo = installation.suspended_at
          ? null
          : await selectedRepository(userToken, installation.id, owner, name);
        if (repo) {
          const probe = await githubFetch(`/repos/${owner}/${name}`, userToken);
          if (probe.status === 401) {
            await clearAuthorization(workspace);
            userToken = null;
          }
          if (probe.ok) {
            const metadata = (await probe.json()) as {
              permissions?: { push?: boolean; admin?: boolean };
            };
            const permissions = installation.permissions ?? {};
            const missing = [
              "contents: read",
              "pull_requests: write",
              "issues: write",
            ].filter((value) => {
              const [key, level] = value.split(": ");
              return level === "read"
                ? !["read", "write"].includes(permissions[key!] ?? "")
                : permissions[key!] !== "write";
            });
            const canManage =
              metadata.permissions?.push === true ||
              metadata.permissions?.admin === true;
            const canComment = missing.length === 0 && canManage;
            // Mint a token for this repository only, and only after checking user access.
            const minted = await githubFetch(
              `/app/installations/${installation.id}/access_tokens`,
              appJwt(),
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  repository_ids: [repo.id],
                  permissions: {
                    contents: "read",
                    ...(canComment
                      ? { pull_requests: "write", issues: "write" }
                      : {}),
                  },
                }),
              },
            );
            if (minted.ok) {
              const token = (await minted.json()) as { token?: string };
              if (token.token) {
                return {
                  // Supplying only a scoped token prevents the client from refreshing to an unrestricted App token.
                  client: new GitHubClient({
                    token: token.token,
                    forceReadOnly: !canComment,
                  }),
                  cloneToken: token.token,
                  capability: {
                    ...capability,
                    mode: "app",
                    canComment,
                    repoAccessible: true,
                    requiresInstall: !canComment,
                    authorizationRequired: false,
                    installationId: installation.id,
                    installationUrl: `https://github.com/settings/installations/${installation.id}`,
                    missingPermissions: missing,
                    permissionUpdatePending: missing.length > 0,
                    message: canComment
                      ? "GitHub is connected. Pull requests can be reviewed and comments posted automatically."
                      : !canManage
                        ? "A repository maintainer must enable automatic PR reviews. Your read access is connected."
                        : "Approve the updated permissions for this repository on GitHub to enable reviews.",
                  },
                };
              }
            }
          }
        }
      }
    }
  }
  // Anonymous access is checked explicitly; private or unverified repositories never clone blindly.
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${name}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "archthread",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  const publicRepo =
    response.ok &&
    ((await response.json()) as { private?: boolean }).private === false;
  capability.repoAccessible = publicRepo;
  capability.rateLimited = response.status === 403 || response.status === 429;
  if (!publicRepo && configured)
    capability.message =
      "This repository is private or needs access. Continue to GitHub, select this repository, and approve the App permissions.";
  return { client: new GitHubClient({ anonymous: true }), capability };
}
export async function githubClientFor(
  owner: string,
  name: string,
): Promise<GitHubClient> {
  return (await resolveGitHubAccess(owner, name)).client;
}
export async function resolveCloneCredential(options: {
  owner: string;
  name: string;
  organizationId?: string;
}): Promise<{
  token: string | null;
  installationId: number | null;
  source: "app" | "token" | "none";
}> {
  const access = await resolveGitHubAccess(
    options.owner,
    options.name,
    options.organizationId,
  );
  if (access.capability.repoAccessible !== true)
    throw new AppError(
      "GITHUB_ACCESS_REQUIRED",
      "Connect this repository through GitHub before continuing.",
      403,
    );
  return {
    token: access.cloneToken ?? null,
    installationId: access.capability.installationId,
    source: access.cloneToken ? "app" : "none",
  };
}

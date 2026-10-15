import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "@cbi/shared";
import { createApp } from "../apps/api/src/app.js";
import {
  issueGoogleSession,
  workspaceIdFor,
} from "../apps/api/src/identity.js";
import {
  getAuthorization,
  saveAuthorization,
} from "../apps/api/src/githubAuthorization.js";
import {
  resolveGitHubAccess,
  resolveCloneCredential,
} from "../apps/api/src/github.js";

const secret = "github-flow-test-session-secret-at-least-32-characters";
const origin = "https://thread.example.com";
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
let dir: string, alice: string, bob: string;
let app: ReturnType<typeof createApp>;
const workspace = () => workspaceIdFor("github-alice");
const permissions = {
  contents: "read",
  pull_requests: "write",
  issues: "write",
};
const repository = {
  id: 42,
  full_name: "acme/private",
  private: true,
  permissions: { push: true, pull: true },
};
let repoSelected: boolean, userCanWrite: boolean;
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/app")
      return Response.json({ slug: "archthread-test", permissions });
    if (url.pathname === "/login/oauth/access_token")
      return Response.json({
        access_token: "ghu_alice",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_alice",
        refresh_token_expires_in: 15897600,
      });
    if (url.pathname === "/user")
      return Response.json({ id: 101, login: "alice" });
    if (url.pathname === "/user/installations/123/repositories")
      return Response.json({
        total_count: repoSelected ? 1 : 0,
        repositories: repoSelected ? [repository] : [],
      });
    if (url.pathname === "/repos/acme/private/installation")
      return Response.json({ id: 123, permissions });
    if (
      url.pathname === "/repos/acme/private" &&
      authorization === "Bearer ghu_alice"
    )
      return Response.json({
        ...repository,
        permissions: { push: userCanWrite },
      });
    if (url.pathname === "/app/installations/123/access_tokens")
      return Response.json({ token: "scoped-installation-token" });
    if (url.pathname === "/repos/acme/public")
      return Response.json({ id: 43, private: false });
    return Response.json({ message: "Not Found" }, { status: 404 });
  },
);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "archthread-github-flow-"));
  for (const [key, value] of Object.entries({
    APP_URL: origin,
    SESSION_SECRET: secret,
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fake-key",
    NODE_ENV: "test",
    DATABASE_URL: "",
    CBI_STATE_DIR: dir,
    GITHUB_APP_ID: "1234",
    GITHUB_PRIVATE_KEY: privateKey,
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    GITHUB_TOKEN: "must-not-be-used",
  }))
    vi.stubEnv(key, value);
  resetConfigCache();
  alice = `cbi_admin_session=${await issueGoogleSession("github-alice", "alice@example.com", secret)}`;
  bob = `cbi_admin_session=${await issueGoogleSession("github-bob", "bob@example.com", secret)}`;
  repoSelected = true;
  userCanWrite = true;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  app = createApp();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetConfigCache();
  rmSync(dir, { recursive: true, force: true });
});
const headers = (cookie = alice) => ({
  cookie,
  origin,
  "content-type": "application/json",
});
async function start() {
  const response = await app.request("/api/github/connect/start", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ repo: "acme/private", branch: "feature/context" }),
  });
  expect(response.status).toBe(200);
  const url = new URL((await response.json()).url);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { url, cookie };
}
async function installed() {
  const initial = await start();
  const response = await app.request(
    `/api/github/connect/setup?installation_id=123&setup_action=install&state=${initial.url.searchParams.get("state")}`,
    { headers: headers(`${alice}; ${initial.cookie}`) },
  );
  expect(response.status).toBe(302);
  const authorize = new URL(response.headers.get("location")!);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { authorize, cookie };
}
async function callback(
  flow: Awaited<ReturnType<typeof installed>>,
  cookie = alice,
  suffix = "&code=one-time-code",
) {
  return app.request(
    `/api/github/connect/callback?state=${flow.authorize.searchParams.get("state")}${suffix}`,
    { headers: headers(`${cookie}; ${flow.cookie}`) },
  );
}

describe("GitHub App connection", () => {
  it("installs, authorizes with PKCE, and resumes the selected repository and branch", async () => {
    const flow = await installed();
    expect(flow.authorize.origin).toBe("https://github.com");
    expect(flow.authorize.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(flow.authorize.searchParams.get("redirect_uri")).toBe(
      `${origin}/api/github/connect/callback`,
    );
    const response = await callback(flow);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("github")).toBe("connected");
    expect(destination.searchParams.get("repo")).toBe("acme/private");
    expect(destination.searchParams.get("branch")).toBe("feature/context");
    expect(destination.hash).toBe("#connect");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await getAuthorization(workspace())).toMatchObject({
      userId: 101,
      login: "alice",
    });
    expect(await getAuthorization(workspaceIdFor("github-bob"))).toBeNull();
    const disk = readFileSync(join(dir, "github-authorizations.json"), "utf8");
    expect(disk).not.toContain("ghu_alice");
    expect(disk).not.toContain("ghr_alice");
    const exchange = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/login/oauth/access_token"),
    )!;
    expect(JSON.parse(exchange[1]!.body as string).code_verifier).toHaveLength(
      43,
    );
  });
  it("rejects cross-user callbacks before exchanging the code", async () => {
    const flow = await installed();
    fetchMock.mockClear();
    expect((await callback(flow, bob)).headers.get("location")).toContain(
      "github=expired",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects forged state and missing cookies", async () => {
    const flow = await installed();
    fetchMock.mockClear();
    for (const cookie of [alice, `${alice}; cbi_github_connect=forged`]) {
      const response = await app.request(
        "/api/github/connect/callback?state=forged&code=code",
        { headers: headers(cookie) },
      );
      expect(response.headers.get("location")).toContain("github=expired");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not link a repository omitted from the user installation selection", async () => {
    const flow = await installed();
    repoSelected = false;
    expect((await callback(flow)).headers.get("location")).toContain(
      "github=repository-not-selected",
    );
    expect(await getAuthorization(workspace())).toBeNull();
  });
  it("handles organization approval requests without claiming success", async () => {
    const flow = await start();
    const response = await app.request(
      `/api/github/connect/setup?setup_action=request&state=${flow.url.searchParams.get("state")}`,
      { headers: headers(`${alice}; ${flow.cookie}`) },
    );
    expect(response.headers.get("location")).toContain("github=pending");
    expect(await getAuthorization(workspace())).toBeNull();
  });
  it("handles user cancellation without credentials or a clone", async () => {
    const flow = await installed();
    fetchMock.mockClear();
    expect(
      (await callback(flow, alice, "&error=access_denied")).headers.get(
        "location",
      ),
    ).toContain("github=cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires a signed-in user and same-origin start request", async () => {
    expect(
      (await app.request("/api/github/connect/start?repo=acme/private")).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/github/connect/start", {
          method: "POST",
          headers: { cookie: alice, origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });
  it("retired manual token submission", async () => {
    const response = await app.request("/api/github/credentials", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ token: "not-accepted" }),
    });
    expect(response.status).toBe(410);
  });
  it("refuses to send users to a GitHub App requesting unnecessary privileges", async () => {
    fetchMock.mockImplementationOnce(async () =>
      Response.json({
        slug: "archthread-test",
        permissions: { ...permissions, administration: "write" },
      }),
    );
    const response = await app.request("/api/github/connect/start", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ repo: "acme/private" }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "GITHUB_PERMISSIONS_NOT_READY",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("rejects a previous sign-in session even for the same Google user", async () => {
    const flow = await installed();
    const renewed = `cbi_admin_session=${await issueGoogleSession("github-alice", "alice@example.com", secret)}`;
    fetchMock.mockClear();
    expect((await callback(flow, renewed)).headers.get("location")).toContain(
      "github=expired",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not trust an arbitrary installation ID supplied to the setup callback", async () => {
    const initial = await start();
    const setup = await app.request(
      `/api/github/connect/setup?installation_id=999&state=${initial.url.searchParams.get("state")}`,
      { headers: headers(`${alice}; ${initial.cookie}`) },
    );
    const url = new URL(setup.headers.get("location")!);
    const cookie = setup.headers.get("set-cookie")!.split(";")[0]!;
    const response = await callback({ authorize: url, cookie });
    expect(response.headers.get("location")).toContain(
      "github=repository-not-selected",
    );
    expect(await getAuthorization(workspace())).toBeNull();
  });
  it("rejects return destinations referencing another user repository", async () => {
    expect(
      (
        await app.request("/api/github/connect/start", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            repo: "acme/private",
            repositoryId: "foreign-repo",
          }),
        })
      ).status,
    ).toBe(404);
  });
});
describe("repository-scoped authorization", () => {
  async function authorized() {
    await callback(await installed());
    fetchMock.mockClear();
  }
  it("only mints installation tokens after verifying user access, scoped to the exact repository", async () => {
    await authorized();
    const access = await resolveGitHubAccess("acme", "private", workspace());
    expect(access.capability.canComment).toBe(true);
    const mint = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/access_tokens"),
    )!;
    expect(JSON.parse(mint[1]!.body as string)).toEqual({
      repository_ids: [42],
      permissions,
    });
    expect(
      (
        await resolveCloneCredential({
          owner: "acme",
          name: "private",
          organizationId: workspace(),
        })
      ).token,
    ).toBe("scoped-installation-token");
  });
  it("cannot use another workspace authorization or a shared environment token", async () => {
    await authorized();
    const access = await resolveGitHubAccess(
      "acme",
      "private",
      workspaceIdFor("github-bob"),
    );
    expect(access.capability.canComment).toBe(false);
    expect(access.capability.repoAccessible).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/access_tokens"),
      ),
    ).toBe(false);
  });
  it("fails closed when repository access has been removed", async () => {
    await authorized();
    repoSelected = false;
    const access = await resolveGitHubAccess("acme", "private", workspace());
    expect(access.capability.canComment).toBe(false);
    expect(access.capability.repoAccessible).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/access_tokens"),
      ),
    ).toBe(false);
  });
  it("never escalates a read-only GitHub user into a write-capable bot", async () => {
    await authorized();
    userCanWrite = false;
    const access = await resolveGitHubAccess("acme", "private", workspace());
    expect(access.capability.canComment).toBe(false);
    expect(access.capability.repoAccessible).toBe(true);
    const mint = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/access_tokens"),
    )!;
    expect(JSON.parse(mint[1]!.body as string).permissions).toEqual({
      contents: "read",
    });
    expect(access.client.canComment).toBe(false);
  });
  it("public repositories remain readable without an installation prompt", async () => {
    const access = await resolveGitHubAccess("acme", "public", workspace());
    expect(access.capability.repoAccessible).toBe(true);
    expect(access.capability.canComment).toBe(false);
  });
  it("refreshes expiring user credentials on the server without exposing them", async () => {
    await saveAuthorization(workspace(), {
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: 1,
      refreshExpiresAt: Date.now() + 100000,
      userId: 101,
      login: "alice",
    });
    const [a, b] = await Promise.all([
      getAuthorization(workspace()),
      getAuthorization(workspace()),
    ]);
    expect(a?.accessToken).toBe("ghu_alice");
    expect(b?.accessToken).toBe("ghu_alice");
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/login/oauth/access_token"),
      ),
    ).toHaveLength(1);
  });
});

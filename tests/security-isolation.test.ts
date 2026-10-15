import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resetConfigCache } from "@cbi/shared";
import { setGraphStore } from "@cbi/graph";
import { createApp } from "../apps/api/src/app.js";
import {
  issueGoogleSession,
  workspaceIdFor,
  authenticatedSession,
} from "../apps/api/src/identity.js";
import {
  createRepo,
  deleteRepo,
  getRepo,
  listRepos,
  type RepoRecord,
} from "../apps/api/src/services.js";
import {
  saveToken,
  resolveToken,
  clearToken,
  tokenStatus,
} from "../apps/api/src/credentials.js";
import { jobQueue } from "../apps/api/src/queue.js";
import { indexFixture } from "./helpers";
const secret = "tenant-test-session-secret-at-least-32-characters";
const origin = "https://thread.example.com";
let stateDir: string,
  aliceCookie: string,
  bobCookie: string,
  aliceRepo: RepoRecord,
  bobRepo: RepoRecord,
  bobNode: string;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  stateDir = mkdtempSync(join(tmpdir(), "archthread-isolation-"));
  for (const [key, value] of Object.entries({
    APP_URL: origin,
    SESSION_SECRET: secret,
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
    DATABASE_URL: "",
    NODE_ENV: "test",
    CBI_STATE_DIR: stateDir,
    GITHUB_TOKEN: "server-token-must-never-reach-users",
    REQUIRE_LOGIN: "false",
  }))
    vi.stubEnv(key, value);
  resetConfigCache();
  aliceCookie = `cbi_admin_session=${await issueGoogleSession("alice-sub", "alice@example.com", secret)}`;
  bobCookie = `cbi_admin_session=${await issueGoogleSession("bob-sub", "bob@example.com", secret)}`;
  aliceRepo = await createRepo({
    owner: "acme",
    name: "same-repo",
    organizationId: workspaceIdFor("alice-sub"),
    checkoutPath: stateDir,
  });
  bobRepo = await createRepo({
    owner: "acme",
    name: "same-repo",
    organizationId: workspaceIdFor("bob-sub"),
    checkoutPath: stateDir,
  });
  const aliceGraph = await indexFixture(undefined, aliceRepo.id),
    bobGraph = await indexFixture(undefined, bobRepo.id);
  await aliceGraph.store.upsertNodes(bobGraph.built.nodes);
  await aliceGraph.store.upsertEdges(bobGraph.built.edges);
  setGraphStore(aliceGraph.store);
  bobNode = bobGraph.built.nodes[0]!.id;
  app = createApp();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await deleteRepo(aliceRepo.id, aliceRepo.organizationId);
  await deleteRepo(bobRepo.id, bobRepo.organizationId);
  vi.unstubAllEnvs();
  resetConfigCache();
  rmSync(stateDir, { recursive: true, force: true });
});
const headers = (cookie = aliceCookie) => ({
  cookie,
  origin,
  "content-type": "application/json",
});
describe("repository tenant isolation", () => {
  it("shows each user only their own repositories, even with a forged tenant header", async () => {
    const alice = await app.request("/api/repositories", {
      headers: { ...headers(), "x-organization-id": bobRepo.organizationId },
    });
    expect(
      (await alice.json()).repositories.map((r: RepoRecord) => r.id),
    ).toEqual([aliceRepo.id]);
    const bob = await app.request("/api/repositories", {
      headers: headers(bobCookie),
    });
    expect(
      (await bob.json()).repositories.map((r: RepoRecord) => r.id),
    ).toEqual([bobRepo.id]);
    expect(
      (await listRepos("local-org")).some((r) =>
        [aliceRepo.id, bobRepo.id].includes(r.id),
      ),
    ).toBe(false);
    expect(await getRepo(bobRepo.id, aliceRepo.organizationId)).toBeNull();
  });
  it.each([
    "",
    "/graph",
    "/architecture",
    "/index",
    "/prs",
    "/reviews",
    "/findings",
    "/github-capability",
    "/nodes/nope",
    "/nodes/nope/neighborhood",
    "/paths?from=x&to=y",
  ])("denies reading another user repository: %s", async (suffix) => {
    const response = await app.request(
      `/api/repositories/${bobRepo.id}${suffix}`,
      { headers: headers() },
    );
    expect(response.status).toBe(404);
  });
  it.each([
    ["DELETE", ""],
    ["PATCH", "/branch"],
    ["POST", "/index"],
    ["POST", "/chat"],
    ["POST", "/search"],
    ["POST", "/prs/42/review"],
  ])("denies %s on another user repository %s", async (method, suffix) => {
    const response = await app.request(
      `/api/repositories/${bobRepo.id}${suffix}`,
      {
        method,
        headers: headers(),
        body: JSON.stringify({ branch: "main", message: "hello" }),
      },
    );
    expect(response.status).toBe(404);
  });
  it("does not allow foreign graph nodes to be resolved through an owned repository", async () => {
    for (const path of [
      `/nodes/${bobNode}`,
      `/nodes/${bobNode}/neighborhood`,
      `/paths?from=${bobNode}&to=${bobNode}`,
    ])
      expect(
        (
          await app.request(`/api/repositories/${aliceRepo.id}${path}`, {
            headers: headers(),
          })
        ).status,
      ).toBe(404);
  });
  it("does not allow foreign job IDs to be resolved through an owned repository", async () => {
    vi.spyOn(jobQueue, "get").mockReturnValue({
      repositoryId: bobRepo.id,
    } as never);
    expect(
      (
        await app.request(
          `/api/repositories/${aliceRepo.id}/index?jobId=foreign`,
          { headers: headers() },
        )
      ).status,
    ).toBe(404);
  });
  it("rejects arbitrary host checkout paths before cloning or indexing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const path of [
      "/api/repositories",
      `/api/repositories/${aliceRepo.id}/index`,
      `/api/repositories/${aliceRepo.id}/prs/42/review`,
    ]) {
      const response = await app.request(path, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          owner: "acme",
          name: "repo",
          checkoutPath: "C:/Users/secret",
        }),
      });
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe("session and CSRF protections", () => {
  it("does not allow the old development bypass, missing sessions, or forged cookies", async () => {
    for (const cookie of ["", "cbi_admin_session=forged"])
      expect(
        (await app.request("/api/repositories", { headers: { cookie } }))
          .status,
      ).toBe(401);
  });
  it("rejects cross-origin and missing-origin mutations", async () => {
    for (const candidate of [undefined, "https://evil.example", "null"]) {
      const h: Record<string, string> = {
        cookie: aliceCookie,
        "content-type": "application/json",
      };
      if (candidate) h.origin = candidate;
      expect(
        (
          await app.request("/api/github/credentials", {
            method: "POST",
            headers: h,
            body: "{}",
          })
        ).status,
      ).toBe(403);
    }
  });
  it("uses no-store for private API responses", async () => {
    const response = await app.request("/api/repositories", {
      headers: headers(),
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("revokes the server session on logout, even if the old cookie is replayed", async () => {
    const token = await issueGoogleSession(
        "logout-sub",
        "logout@example.com",
        secret,
      ),
      cookie = `cbi_admin_session=${token}`;
    expect(await authenticatedSession(token, secret)).not.toBeNull();
    expect(
      (
        await app.request("/api/auth/logout", {
          method: "POST",
          headers: headers(cookie),
        })
      ).status,
    ).toBe(200);
    expect(await authenticatedSession(token, secret)).toBeNull();
    expect(
      (await app.request("/api/repositories", { headers: headers(cookie) }))
        .status,
    ).toBe(401);
  });
});
describe("GitHub credentials", () => {
  it("encrypts credentials at rest, isolates them per user, and never falls back to a server token", async () => {
    const tokenA = "github_pat_alice_private",
      tokenB = "github_pat_bob_private";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        Response.json({
          login: (
            init?.headers as Record<string, string>
          ).authorization?.includes("alice")
            ? "alice"
            : "bob",
        }),
      ),
    );
    expect(await resolveToken(aliceRepo.organizationId)).toBeNull();
    await saveToken(tokenA, aliceRepo.organizationId);
    await saveToken(tokenB, bobRepo.organizationId);
    expect(await resolveToken(aliceRepo.organizationId)).toBe(tokenA);
    expect(await resolveToken(bobRepo.organizationId)).toBe(tokenB);
    expect(await resolveToken()).toBeNull();
    const disk = readFileSync(
      join(stateDir, "user-github-credentials.json"),
      "utf8",
    );
    expect(disk).not.toContain(tokenA);
    expect(disk).not.toContain(tokenB);
    await clearToken(aliceRepo.organizationId);
    expect((await tokenStatus(aliceRepo.organizationId)).hasToken).toBe(false);
    expect(await resolveToken(bobRepo.organizationId)).toBe(tokenB);
  });
});

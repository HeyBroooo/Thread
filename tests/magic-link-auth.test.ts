import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "@cbi/shared";
import { createApp } from "../apps/api/src/app.js";
import {
  verifySignedToken,
  sessionTokenFromCookie,
} from "../apps/api/src/auth.js";
const secret = "test-session-secret-that-is-long-enough";
let stateDir = "";
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "archthread-oauth-"));
  vi.stubEnv("APP_URL", "https://thread.example.com");
  vi.stubEnv("SESSION_SECRET", secret);
  vi.stubEnv("SUPABASE_URL", "https://supabase.example.com");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CBI_STATE_DIR", stateDir);
  resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigCache();
  rmSync(stateDir, { recursive: true, force: true });
});
async function start(from = "/dashboard") {
  const app = createApp();
  const response = await app.request(
    `/api/auth/google/start?from=${encodeURIComponent(from)}`,
    { headers: { "x-forwarded-for": stateDir } },
  );
  expect(response.status).toBe(302);
  const authorization = new URL(response.headers.get("location")!);
  const callback = new URL(authorization.searchParams.get("redirect_to")!);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { app, response, authorization, callback, cookie };
}
const googleUser = {
  id: "google-user-123",
  email: "person@example.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
  app_metadata: { provider: "google" },
};
describe("Google-only OAuth", () => {
  it("uses PKCE and creates a complete user session in one Google callback", async () => {
    const flow = await start("/repositories/my-repo");
    expect(flow.authorization.searchParams.get("provider")).toBe("google");
    expect(flow.authorization.searchParams.get("code_challenge_method")).toBe(
      "s256",
    );
    expect(flow.callback.toString()).toBe(
      "https://thread.example.com/api/auth/supabase/callback",
    );
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          access_token: "verified-access-token",
          user: googleUser,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    flow.callback.searchParams.set("code", "one-time-code");
    const response = await flow.app.request(
      flow.callback.pathname + flow.callback.search,
      { headers: { cookie: flow.cookie } },
    );
    expect(response.headers.get("location")).toBe(
      "https://thread.example.com/repositories/my-repo",
    );
    const cookies = response.headers.get("set-cookie")!;
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Lax");
    expect(cookies).toContain("cbi_supabase_oauth_state=;");
    const token = sessionTokenFromCookie(cookies.split(",")[0]);
    expect(verifySignedToken(token, secret)).toMatchObject({
      version: 2,
      provider: "google",
      userId: googleUser.id,
      email: googleUser.email,
    });
    const session = await flow.app.request("/api/auth/session", {
      headers: { cookie: cookies.split(";")[0]! },
    });
    expect(await session.json()).toMatchObject({
      authenticated: true,
      email: googleUser.email,
    });
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}"),
    ).toBeDefined();
  });
  it("rejects mismatched OAuth state without exchanging a code", async () => {
    const flow = await start();
    flow.callback.searchParams.set("state", "attacker-state");
    flow.callback.searchParams.set("code", "code");
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const response = await flow.app.request(
      flow.callback.pathname + flow.callback.search,
      { headers: { cookie: flow.cookie } },
    );
    expect(response.headers.get("location")).toContain("error=supabase");
    expect(mock).not.toHaveBeenCalled();
  });
  it.each(["", "cbi_supabase_oauth_state=tampered"])(
    "rejects missing or invalid PKCE cookies: %s",
    async (cookie) => {
      const flow = await start();
      const mock = vi.fn();
      vi.stubGlobal("fetch", mock);
      const response = await flow.app.request(
        "/api/auth/supabase/callback?code=untrusted",
        { headers: { cookie } },
      );
      expect(response.headers.get("location")).toContain("error=supabase");
      expect(mock).not.toHaveBeenCalled();
    },
  );
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\nevil",
  ])("rejects unsafe return path %s", async (from) => {
    const flow = await start(from);
    expect(
      verifySignedToken(flow.cookie.split("=").slice(1).join("="), secret)
        ?.returnTo,
    ).toBe("/dashboard");
  });
  it.each([
    { ...googleUser, app_metadata: { provider: "email" } },
    { ...googleUser, email_confirmed_at: null },
  ])(
    "does not issue sessions for non-Google or unverified identities",
    async (user) => {
      const flow = await start();
      flow.callback.searchParams.set("code", "code");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ access_token: "token", user })),
      );
      const response = await flow.app.request(
        flow.callback.pathname + flow.callback.search,
        { headers: { cookie: flow.cookie } },
      );
      expect(response.headers.get("location")).toContain("error=supabase");
      expect(response.headers.get("set-cookie")).not.toContain(
        "cbi_admin_session=",
      );
    },
  );
  it("retires email-link and password sign-in", async () => {
    const app = createApp();
    for (const path of [
      "/api/auth/entry",
      "/api/auth/login",
      "/api/auth/magic-link",
    ])
      expect(
        (
          await app.request(path, {
            method: "POST",
            headers: { origin: "https://thread.example.com" },
          })
        ).status,
      ).toBe(410);
    expect(
      (await app.request("/api/auth/magic/verify?token_hash=old")).status,
    ).toBe(410);
  });
  it("sets secure cookies for HTTPS production deployments", async () => {
    vi.stubEnv("NODE_ENV", "production");
    resetConfigCache();
    const flow = await start();
    expect(flow.response.headers.get("set-cookie")).toContain("Secure");
  });
});

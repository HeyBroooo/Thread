import { describe, expect, it } from "vitest";
import {
  loginDestination,
  recoveredOAuthCallback,
} from "../apps/web/lib/auth-redirect";

describe("OAuth redirect recovery", () => {
  it("recovers a code delivered to the site root", () => {
    expect(
      recoveredOAuthCallback(
        new URL("https://thread.example/?code=one-time&state=bound"),
      ),
    ).toBe("/api/auth/supabase/callback?code=one-time&state=bound");
  });
  it("recovers the nested return URL produced by a protected root", () => {
    const url = new URL("https://thread.example/login");
    url.searchParams.set("from", "/?code=one-time");
    expect(recoveredOAuthCallback(url)).toBe(
      "/api/auth/supabase/callback?code=one-time",
    );
  });
  it.each([
    "https://evil.example/?code=code",
    "//evil.example/?code=code",
    "/dashboard?code=code",
  ])("ignores unrelated or external nested paths %s", (from) => {
    const url = new URL("https://thread.example/login");
    url.searchParams.set("from", from);
    expect(recoveredOAuthCallback(url)).toBeNull();
  });
  it.each([
    "/?code=secret",
    "/login?from=/dashboard",
    "/api/auth/google/start",
    "//evil.example",
    "/\\evil.example",
  ])("does not retain credentials or unsafe return destinations %s", (from) => {
    expect(loginDestination(from)).toBe("/dashboard");
  });
  it("keeps an intended repository destination and public landing", () => {
    expect(loginDestination("/repositories/mine?tab=graph")).toBe(
      "/repositories/mine?tab=graph",
    );
    expect(
      recoveredOAuthCallback(new URL("https://thread.example/")),
    ).toBeNull();
  });
});

import { createHash, randomBytes } from "node:crypto";
import * as db from "@cbi/db";
import { getConfig } from "@cbi/shared";
import {
  createSignedToken,
  verifySignedToken,
  SESSION_TTL_SECONDS,
} from "./auth.js";
import { readState, writeState } from "./state.js";

export interface UserSession {
  version: 2;
  provider: "google";
  userId: string;
  email: string;
  sessionId: string;
  expiresAt: number;
}
export function workspaceIdFor(userId: string): string {
  const hex = createHash("sha256")
    .update(`archthread-workspace:${process.env.SUPABASE_URL}:${userId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function validUserClaims(
  payload: Record<string, unknown> | null,
): payload is UserSession & Record<string, unknown> {
  return (
    !!payload &&
    payload.version === 2 &&
    payload.provider === "google" &&
    typeof payload.userId === "string" &&
    payload.userId.length > 0 &&
    payload.userId.length <= 128 &&
    typeof payload.email === "string" &&
    payload.email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) &&
    typeof payload.sessionId === "string" &&
    /^[a-f0-9]{64}$/.test(payload.sessionId) &&
    typeof payload.expiresAt === "number"
  );
}
function databaseEnabled(): boolean {
  return !!getConfig().databaseUrl && db.hasDatabase();
}
function requireDurableProductionStore(): void {
  if (getConfig().nodeEnv === "production" && !databaseEnabled())
    throw new Error(
      "Production authentication requires an available PostgreSQL database.",
    );
}
export async function issueGoogleSession(
  userId: string,
  email: string,
  secret: string,
): Promise<string> {
  requireDurableProductionStore();
  const organizationId = workspaceIdFor(userId);
  const sessionId = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  if (databaseEnabled()) {
    await db.query(
      "INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [organizationId, "Personal workspace"],
    );
    await db.query(
      "INSERT INTO users (organization_id, email, name) VALUES ($1, $2, $3) ON CONFLICT (organization_id, email) DO UPDATE SET updated_at = now()",
      [organizationId, email, email.split("@")[0]],
    );
    await db.query(
      "INSERT INTO auth_sessions (session_id, organization_id, user_id, expires_at) VALUES ($1, $2, $3, to_timestamp($4))",
      [sessionId, organizationId, userId, expiresAt],
    );
  } else {
    const sessions = readState<
      Record<string, { userId: string; expiresAt: number }>
    >("user-sessions.json", {});
    for (const [id, s] of Object.entries(sessions))
      if (s.expiresAt <= Date.now() / 1000) delete sessions[id];
    sessions[sessionId] = { userId, expiresAt };
    writeState("user-sessions.json", sessions);
    if (
      readState<Record<string, unknown>>("user-sessions.json", {})[
        sessionId
      ] === undefined
    )
      throw new Error("Could not persist sign-in session.");
  }
  return createSignedToken(
    { version: 2, provider: "google", userId, email, sessionId },
    secret,
    SESSION_TTL_SECONDS,
  );
}
export async function authenticatedSession(
  token: string | undefined,
  secret: string,
): Promise<UserSession | null> {
  const claims = verifySignedToken(token, secret);
  if (!validUserClaims(claims)) return null;
  requireDurableProductionStore();
  if (databaseEnabled()) {
    const row = await db.queryOne(
      "SELECT session_id FROM auth_sessions WHERE session_id=$1 AND user_id=$2 AND organization_id=$3 AND expires_at > now()",
      [claims.sessionId, claims.userId, workspaceIdFor(claims.userId)],
    );
    return row ? claims : null;
  }
  const saved = readState<
    Record<string, { userId: string; expiresAt: number }>
  >("user-sessions.json", {})[claims.sessionId];
  return saved?.userId === claims.userId && saved.expiresAt > Date.now() / 1000
    ? claims
    : null;
}
export async function revokeSession(session: UserSession): Promise<void> {
  if (databaseEnabled()) {
    await db.query(
      "DELETE FROM auth_sessions WHERE session_id=$1 AND user_id=$2",
      [session.sessionId, session.userId],
    );
    return;
  }
  const sessions = readState<Record<string, unknown>>("user-sessions.json", {});
  delete sessions[session.sessionId];
  writeState("user-sessions.json", sessions);
  if (
    readState<Record<string, unknown>>("user-sessions.json", {})[
      session.sessionId
    ] !== undefined
  )
    throw new Error("Could not revoke session.");
}

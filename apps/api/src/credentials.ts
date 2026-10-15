import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import * as db from "@cbi/db";
import { getConfig } from "@cbi/shared";
import { readState, writeState } from "./state.js";
interface Credential {
  encrypted_token: string;
  github_login: string;
  saved_at: string;
}
export interface TokenStatus {
  hasToken: boolean;
  source: "runtime" | "none" | "env";
  login: string | null;
  masked: string | null;
  savedAt: string | null;
}
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "Session signing must be configured before saving credentials.",
    );
  return createHash("sha256")
    .update(`github-credential-encryption:${secret}`)
    .digest();
}
export function encrypt(token: string, workspace: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(workspace));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decrypt(value: string, workspace: string): string {
  const [iv, tag, data] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  if (!iv || !tag || !data) throw new Error("Invalid saved credential.");
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(workspace));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
async function credential(workspace: string): Promise<Credential | null> {
  if (db.hasDatabase())
    return db.queryOne<Credential & Record<string, unknown>>(
      "SELECT encrypted_token, github_login, saved_at::text FROM user_github_credentials WHERE organization_id=$1",
      [workspace],
    );
  if (getConfig().nodeEnv === "production")
    throw new Error("Production credential storage requires PostgreSQL.");
  return (
    readState<Record<string, Credential>>("user-github-credentials.json", {})[
      workspace
    ] ?? null
  );
}
// There is intentionally no environment-token or legacy shared-token fallback.
export async function resolveToken(workspace?: string): Promise<string | null> {
  if (!workspace) return null;
  const record = await credential(workspace);
  return record ? decrypt(record.encrypted_token, workspace) : null;
}
export async function tokenStatus(workspace: string): Promise<TokenStatus> {
  const record = await credential(workspace);
  return {
    hasToken: !!record,
    source: record ? "runtime" : "none",
    login: record?.github_login ?? null,
    masked: null,
    savedAt: record?.saved_at ?? null,
  };
}
export async function saveToken(
  token: string,
  workspace: string,
): Promise<{ login: string; scopes: string | null }> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 1024 || /[\s\u0000-\u001f]/.test(trimmed))
    throw new Error("Enter a valid GitHub token.");
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${trimmed}`,
      accept: "application/vnd.github+json",
      "user-agent": "archthread",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "GitHub rejected this token. Check its permissions and expiration.",
    );
  const user = (await response.json()) as { login?: string };
  if (!user.login) throw new Error("GitHub did not return an account.");
  const encrypted = encrypt(trimmed, workspace);
  const savedAt = new Date().toISOString();
  if (db.hasDatabase())
    await db.query(
      "INSERT INTO user_github_credentials (organization_id, encrypted_token, github_login) VALUES ($1,$2,$3) ON CONFLICT (organization_id) DO UPDATE SET encrypted_token=EXCLUDED.encrypted_token, github_login=EXCLUDED.github_login, saved_at=now()",
      [workspace, encrypted, user.login],
    );
  else {
    if (getConfig().nodeEnv === "production")
      throw new Error("Production credential storage requires PostgreSQL.");
    const all = readState<Record<string, Credential>>(
      "user-github-credentials.json",
      {},
    );
    all[workspace] = {
      encrypted_token: encrypted,
      github_login: user.login,
      saved_at: savedAt,
    };
    writeState("user-github-credentials.json", all);
    if (
      readState<Record<string, Credential>>("user-github-credentials.json", {})[
        workspace
      ]?.encrypted_token !== encrypted
    )
      throw new Error("Could not persist GitHub credentials.");
  }
  return { login: user.login, scopes: response.headers.get("x-oauth-scopes") };
}
export async function clearToken(workspace: string): Promise<void> {
  if (db.hasDatabase()) {
    await db.query(
      "DELETE FROM user_github_credentials WHERE organization_id=$1",
      [workspace],
    );
    return;
  }
  const all = readState<Record<string, Credential>>(
    "user-github-credentials.json",
    {},
  );
  delete all[workspace];
  writeState("user-github-credentials.json", all);
}

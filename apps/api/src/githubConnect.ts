import { createHash, randomBytes } from "node:crypto";
import type { Hono, Context } from "hono";
import { Errors, getConfig } from "@cbi/shared";
import { parseRepoReference } from "@cbi/github";
import type { AppContext } from "./app.js";
import { createSignedToken, verifySignedToken } from "./auth.js";
import {
  appInfo,
  githubAppConfigured,
  minimumAppPermissions,
} from "./github.js";
import {
  authorizationFromTokens,
  exchangeGitHubCode,
  githubFetch,
  saveAuthorization,
  selectedRepository,
} from "./githubAuthorization.js";
import { getRepo } from "./services.js";

const COOKIE = "cbi_github_connect";
interface Flow {
  purpose: "github-connect";
  state: string;
  verifier: string;
  workspace: string;
  sessionId: string;
  owner: string;
  name: string;
  branch: string;
  returnTo: string;
  phase: "install" | "authorize";
  installationId?: number;
}
function cookie(value: string, age = 600): string {
  return `${COOKIE}=${value}; Path=/api/github/connect; HttpOnly; SameSite=Lax; Max-Age=${age}${getConfig().nodeEnv === "production" ? "; Secure" : ""}`;
}
function setFlow(c: Context<AppContext>, flow: Flow) {
  c.header(
    "set-cookie",
    cookie(createSignedToken({ ...flow }, process.env.SESSION_SECRET!, 600)),
  );
}
function readFlow(c: Context<AppContext>, phase: Flow["phase"]): Flow | null {
  const value = c.req
    .header("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const flow = verifySignedToken(value, process.env.SESSION_SECRET!);
  if (
    !flow ||
    flow.purpose !== "github-connect" ||
    flow.phase !== phase ||
    flow.state !== c.req.query("state") ||
    flow.workspace !== c.get("organizationId") ||
    flow.sessionId !== c.get("session")?.sessionId
  )
    return null;
  return flow as unknown as Flow;
}
function finish(c: Context<AppContext>, flow: Flow | null, status: string) {
  c.header("set-cookie", cookie("", 0));
  const url = new URL(flow?.returnTo ?? "/dashboard", getConfig().appUrl);
  url.searchParams.set("github", status);
  if (flow) {
    url.searchParams.set("repo", `${flow.owner}/${flow.name}`);
    if (flow.branch) url.searchParams.set("branch", flow.branch);
  }
  if (url.pathname === "/dashboard") url.hash = "connect";
  return c.redirect(url.toString(), 302);
}
export function registerGitHubConnectRoutes(app: Hono<AppContext>): void {
  const start = async (c: Context<AppContext>) => {
    if (!githubAppConfigured())
      return c.json(
        {
          error: {
            code: "GITHUB_NOT_CONFIGURED",
            message:
              "GitHub connection is temporarily unavailable. Please contact the workspace administrator.",
          },
        },
        503,
      );
    const body =
      c.req.method === "POST"
        ? ((await c.req.json().catch(() => null)) as Record<
            string,
            unknown
          > | null)
        : Object.fromEntries(new URL(c.req.url).searchParams);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw Errors.badRequest("Invalid GitHub connection request.");
    const reference = typeof body.repo === "string" ? body.repo : "";
    const parsed = parseRepoReference(reference);
    if (
      !parsed ||
      !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(parsed.owner) ||
      !/^[a-z0-9_.-]{1,100}$/i.test(parsed.name) ||
      [".", ".."].includes(parsed.name)
    )
      throw Errors.badRequest("Enter a valid GitHub repository URL.");
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    if (
      branch.length > 255 ||
      branch.startsWith("-") ||
      /[\u0000-\u0020\u007f]/.test(branch)
    )
      throw Errors.badRequest("Invalid branch.");
    let returnTo = "/dashboard";
    if (typeof body.repositoryId === "string") {
      const repo = await getRepo(body.repositoryId, c.get("organizationId"));
      if (
        !repo ||
        `${repo.owner}/${repo.name}`.toLowerCase() !==
          `${parsed.owner}/${parsed.name}`.toLowerCase()
      )
        throw Errors.repositoryNotFound(body.repositoryId);
      returnTo = `/repositories/${encodeURIComponent(repo.id)}/prs`;
    }
    const info = await appInfo();
    if (!minimumAppPermissions(info.permissions))
      return c.json(
        {
          error: {
            code: "GITHUB_PERMISSIONS_NOT_READY",
            message:
              "GitHub connection is being configured. Please contact the workspace administrator.",
          },
        },
        503,
      );
    const flow: Flow = {
      purpose: "github-connect",
      state: randomBytes(32).toString("hex"),
      verifier: randomBytes(32).toString("base64url"),
      workspace: c.get("organizationId"),
      sessionId: c.get("session").sessionId,
      owner: parsed.owner,
      name: parsed.name,
      branch,
      returnTo,
      phase: "install",
    };
    setFlow(c, flow);
    const url = new URL(
      `https://github.com/apps/${info.slug}/installations/new`,
    );
    url.searchParams.set("state", flow.state);
    // A normal browser form/link navigates; fetch callers navigate to this URL themselves.
    return c.req.method === "POST"
      ? c.json({ url: url.toString() })
      : c.redirect(url.toString(), 302);
  };
  app.post("/api/github/connect/start", start);
  app.get("/api/github/connect/start", start);
  app.get("/api/github/connect/setup", async (c) => {
    const flow = readFlow(c, "install");
    if (!flow) return finish(c, null, "expired");
    if (c.req.query("setup_action") === "request")
      return finish(c, flow, "pending");
    const installationId = Number(c.req.query("installation_id"));
    if (!Number.isSafeInteger(installationId) || installationId < 1)
      return finish(c, flow, "cancelled");
    // This ID remains untrusted until the OAuth user proves access in callback.
    flow.installationId = installationId;
    flow.phase = "authorize";
    flow.state = randomBytes(32).toString("hex");
    setFlow(c, flow);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", getConfig().github.clientId!);
    url.searchParams.set(
      "redirect_uri",
      new URL("/api/github/connect/callback", getConfig().appUrl).toString(),
    );
    url.searchParams.set("state", flow.state);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(flow.verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
    return c.redirect(url.toString(), 302);
  });
  app.get("/api/github/connect/callback", async (c) => {
    const flow = readFlow(c, "authorize");
    if (!flow) return finish(c, null, "expired");
    const code = c.req.query("code");
    if (!code || c.req.query("error")) return finish(c, flow, "cancelled");
    try {
      if (!minimumAppPermissions((await appInfo()).permissions))
        return finish(c, flow, "unavailable");
      const tokens = await exchangeGitHubCode({
        code,
        code_verifier: flow.verifier,
        redirect_uri: new URL(
          "/api/github/connect/callback",
          getConfig().appUrl,
        ).toString(),
      });
      const userResponse = await githubFetch(
        "/user",
        tokens.access_token as string,
      );
      if (!userResponse.ok) return finish(c, flow, "denied");
      const user = (await userResponse.json()) as { id: number; login: string };
      if (!Number.isSafeInteger(user.id) || !user.login)
        return finish(c, flow, "denied");
      const repo = await selectedRepository(
        tokens.access_token as string,
        flow.installationId!,
        flow.owner,
        flow.name,
      );
      if (!repo) return finish(c, flow, "repository-not-selected");
      await saveAuthorization(
        flow.workspace,
        authorizationFromTokens(tokens, user),
      );
      return finish(c, flow, "connected");
    } catch {
      return finish(c, flow, "unavailable");
    }
  });
}

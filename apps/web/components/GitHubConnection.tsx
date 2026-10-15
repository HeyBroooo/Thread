"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  GitBranch,
  ShieldCheck,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "./ui/button";

export function GitHubConnection({
  repo,
  branch = "",
  repositoryId,
  configured = true,
  description,
}: {
  repo: string;
  branch?: string;
  repositoryId?: string;
  configured?: boolean;
  description?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/github/connect/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, branch, repositoryId }),
      });
      const result = (await response.json()) as {
        url?: string;
        error?: { message?: string };
      };
      if (!response.ok || !result.url)
        throw new Error(
          result.error?.message ??
            "Could not connect to GitHub. Please try again.",
        );
      // Only the server's fixed GitHub App installation destination is accepted.
      const url = new URL(result.url);
      if (
        url.origin !== "https://github.com" ||
        !url.pathname.startsWith("/apps/")
      )
        throw new Error("Invalid GitHub connection destination.");
      window.location.assign(url.toString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect to GitHub.");
      setBusy(false);
    }
  }
  return (
    <div className="github-approval">
      <div className="github-approval-heading">
        <span className="github-approval-icon">
          <GitBranch size={22} />
        </span>
        <div>
          <span className="github-approval-eyebrow">
            CONNECTED ON YOUR TERMS
          </span>
          <h3>
            {repositoryId
              ? "Enable pull request reviews"
              : "Give this repository a green light"}
          </h3>
        </div>
      </div>
      <p>
        {description ??
          `Continue to GitHub to install archthread for ${repo}. Choose the repository you want to share and approve access there.`}
      </p>
      <ol>
        <li>
          <span>1</span>Select this repository
        </li>
        <li>
          <span>2</span>Approve on GitHub
        </li>
        <li>
          <span>
            <Check size={12} />
          </span>
          Return here automatically
        </li>
      </ol>
      <div className="github-approval-scope">
        <ShieldCheck size={17} />
        <span>
          Read source code. Read pull requests and publish review comments.
          <br />
          No code changes, merges, or repository administration.
        </span>
      </div>
      <Button
        type="button"
        onClick={() => void authorize()}
        disabled={busy || !configured}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <GitBranch size={16} />
        )}
        {busy ? "Opening GitHub..." : "Continue with GitHub"}
        {!busy && <ArrowUpRight size={15} />}
      </Button>
      {!configured && (
        <p role="status">
          GitHub connection is temporarily unavailable. Please contact the
          workspace administrator.
        </p>
      )}
      {error && (
        <p role="alert" className="github-approval-error">
          {error}
        </p>
      )}
      <small>
        You choose the access. Organization repositories may need an owner to
        approve your request.
      </small>
    </div>
  );
}

"use client";
import { useEffect, useState, type FormEvent } from "react";
import { GitBranch as Github, Check, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function GitHubConnection() {
  const [open, setOpen] = useState(false),
    [token, setToken] = useState(""),
    [login, setLogin] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/github/credentials", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active) setLogin(data?.login ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/github/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not connect GitHub.");
      setLogin(body.login);
      setToken("");
      setMessage("GitHub access connected to your account.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not connect GitHub.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="github-connection">
      <button
        type="button"
        className="github-connection-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Github size={16} />
        <span>
          {login
            ? `Connected as ${login}`
            : "Private repository? Connect your GitHub access"}
          {login && <Check size={13} />}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <form onSubmit={save} className="github-connection-form">
          <p>
            Use a fine-grained GitHub token with access to the repositories you
            want to add. It is encrypted and belongs only to your account.
          </p>
          <label htmlFor="github-personal-token">Personal access token</label>
          <div>
            <Input
              id="github-personal-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              maxLength={1024}
            />
            <Button type="submit" disabled={busy || !token.trim()}>
              {busy ? "Connecting…" : "Connect GitHub"}
            </Button>
          </div>
          <small>
            Contents: read. Add pull requests and issues: write if you want to
            publish review comments.
          </small>
        </form>
      )}
      {message && (
        <p className="github-connection-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

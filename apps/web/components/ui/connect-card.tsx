"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2, GitBranch, ShieldCheck } from "lucide-react";
import { GitHubConnection } from "@/components/GitHubConnection";
import { api } from "@/lib/api";
import { Alert, AlertDescription } from "./alert";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Input } from "./input";
import { Label } from "./label";

export function ConnectCard() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const resumed = useRef(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<Awaited<
    ReturnType<typeof api.checkAccess>
  > | null>(null);
  const connect = useCallback(
    async (repo: string, targetBranch: string, afterApproval = false) => {
      if (!repo.trim()) return;
      setBusy(true);
      setError(null);
      setAccess(null);
      setStage("Checking repository access...");
      try {
        const status = await api.checkAccess(repo.trim());
        setAccess(status);
        if (status.accessible !== true) {
          setStage(null);
          return;
        }
        setStage("Connecting your repository...");
        const result = await api.createRepository({
          repoUrl: repo.trim(),
          ...(targetBranch.trim() ? { branch: targetBranch.trim() } : {}),
        });
        setRepoUrl("");
        setBranch("");
        setAccess(null);
        setStage(
          "Connected. Your codebase graph is building in the background.",
        );
        window.dispatchEvent(new Event("repository-created"));
        if (afterApproval)
          router.push(`/repositories/${result.repository.id}/prs`);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not connect this repository.",
        );
        setStage(null);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("github");
    if (!status) return;
    const repo = params.get("repo") ?? "",
      targetBranch = params.get("branch") ?? "";
    setRepoUrl(repo);
    setBranch(targetBranch);
    params.delete("github");
    params.delete("repo");
    params.delete("branch");
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (params.size ? `?${params}` : "") + "#connect",
    );
    if (status === "connected" && repo) void connect(repo, targetBranch, true);
    else
      setError(
        status === "pending"
          ? "Your request was sent to the organization owner. Once approved, connect this repository again."
          : status === "repository-not-selected"
            ? "This repository was not selected or your GitHub account cannot access it. Select it on GitHub and try again."
            : status === "cancelled"
              ? "GitHub approval was cancelled. Your repository details are saved here for another try."
              : "GitHub connection could not be completed. Please try again.",
      );
  }, [connect]);
  return (
    <motion.div
      className="connect-shell"
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <Card className="lp-connect-card w-full border-border/80 shadow-lg">
        <CardHeader className="gap-2 pb-5">
          <CardTitle className="text-[22px] font-bold tracking-[-0.025em]">
            Connect a repository
          </CardTitle>
          <CardDescription>
            Bring your code into focus. Public repositories connect instantly;
            private ones ask for permission on GitHub.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect(repoUrl, branch);
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-[2_1_240px] flex-col gap-2">
                <Label htmlFor="connect-repo-url">GitHub repository</Label>
                <Input
                  id="connect-repo-url"
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    setAccess(null);
                  }}
                  placeholder="https://github.com/owner/repository"
                  autoComplete="off"
                  required
                  disabled={busy}
                />
              </div>
              <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-2">
                <Label htmlFor="connect-branch">
                  Branch{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="connect-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="Repository default"
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
              <Button type="submit" disabled={busy || !repoUrl.trim()}>
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <GitBranch size={16} />
                )}
                {busy ? "Connecting..." : "Connect repository"}
                {!busy && <ArrowRight size={15} />}
              </Button>
            </div>
            <p className="connect-privacy">
              <ShieldCheck size={14} />
              Only repositories you add appear in your personal workspace.
            </p>
          </form>
          {stage && (
            <p role="status" className="connect-progress">
              {stage}
            </p>
          )}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {access && access.accessible !== true && (
            <GitHubConnection
              repo={`${access.owner}/${access.name}`}
              branch={branch}
              configured={access.appConfigured}
            />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

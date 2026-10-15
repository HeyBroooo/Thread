"use client";
import { SessionControls } from '@/components/SessionControls';

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  LayoutDashboard,
  Network,
  MessagesSquare,
  GitPullRequest,
  BookOpen,
  GitBranch,
  FolderGit2,
  FileCode2,
  RefreshCw,
  SlidersHorizontal,
  ShieldCheck,
  CircleHelp,
  X,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { api, type RepositoryPayload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectCard } from "@/components/ui/connect-card";
import { RepoCard } from "@/components/ui/repo-card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { DEMO_REPOSITORY } from "@/lib/demo";
const tools = [
  {
    icon: Network,
    title: "See the bigger picture",
    body: "Explore every connection in your codebase.",
    path: "canvas",
    label: "Open canvas",
    className: "mint",
  },
  {
    icon: MessagesSquare,
    title: "A question worth asking",
    body: "Get answers with the evidence attached.",
    path: "chat",
    label: "Start a conversation",
    className: "blue",
  },
  {
    icon: GitPullRequest,
    title: "A little more confidence",
    body: "See the impact before you merge.",
    path: "prs",
    label: "Review changes",
    className: "peach",
  },
];
export default function DashboardPage() {
  const [repositories, setRepositories] = useState<RepositoryPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [connect, setConnect] = useState(false);
  const [pending, setPending] = useState<RepositoryPayload | null>(null);
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await api.listRepositories();
      setRepositories(data.repositories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load repositories.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10000);
    const refresh = () => void load();
    window.addEventListener("repository-created", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("repository-created", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (window.location.hash === "#connect") setConnect(true);
  }, []);
  const displayed = repositories.filter(
    (r) =>
      `${r.owner}/${r.name}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || r.indexStatus === "READY"),
  );
  const totals = repositories.reduce(
    (a, r) => ({
      files: a.files + (r.latestJob?.filesProcessed ?? 0),
      nodes: a.nodes + (r.latestJob?.nodesCreated ?? 0),
      edges: a.edges + (r.latestJob?.edgesCreated ?? 0),
    }),
    { files: 0, nodes: 0, edges: 0 },
  );
  const activeRepo =
    repositories.find((r) => r.indexStatus === "READY")?.id ?? "demo";
  async function remove() {
    if (!pending) return;
    setDeleting(true);
    try {
      await api.deleteRepository(pending.id);
      setPending(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove repository.");
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className="workspace-layout">
      <aside className="workspace-sidebar">
        <Brand />
        <button className="workspace-switch" onClick={() => setConnect(true)}>
          <span className="workspace-avatar">P</span>
          <span>
            Personal workspace<small>Private workspace</small>
          </span>
          <Plus size={14} />
        </button>
        <small className="sidebar-label">WORKSPACE</small>
        <nav>
          <Link className="active" href="/dashboard">
            <LayoutDashboard /> Overview{" "}
            <span className="nav-count">{repositories.length}</span>
          </Link>
          <Link href={`/repositories/${activeRepo}/canvas`}>
            <Network /> Codebase canvas
          </Link>
          <Link href={`/repositories/${activeRepo}/chat`}>
            <MessagesSquare /> Grounded chat
          </Link>
          <Link href={`/repositories/${activeRepo}/prs`}>
            <GitPullRequest /> Pull requests
          </Link>
        </nav>
        <small className="sidebar-label">RESOURCES</small>
        <nav>
          <Link href="/#workflow">
            <BookOpen /> Getting started <ArrowUpRight size={13} />
          </Link>
          <Link href="/#faq">
            <CircleHelp /> Help & FAQs
          </Link>
        </nav>
        <div className="sidebar-guide">
          <span className="guide-icon">
            <ShieldCheck size={21} />
          </span>
          <h4>Context changes everything.</h4>
          <p>Take a look around a connected sample codebase.</p>
          <Link href="/repositories/demo">
            Explore the demo <ArrowRight size={14} />
          </Link>
        </div>
        <div className="sidebar-profile">
          <span className="workspace-avatar">Y</span>
          <span>
            Your workspace<small>Signed in with Google</small>
          </span>
          <span className="status-dot" />
        </div>
      </aside>
      <div className="workspace-content">
        <header className="workspace-topbar">
          <span>
            Workspace <span className="breadcrumb-slash">/</span>{" "}
            <strong>Overview</strong>
          </span>
          <div>
            <span className="topbar-status">
              <span className="status-dot" />{" "}
              {error ? "Preview available" : "Workspace ready"}
            </span>
            <Link href="/#faq" aria-label="Help">
              <CircleHelp size={18} />
            </Link>
            <SessionControls variant="inline" />
          </div>
        </header>
        <main className="workspace-main">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">
                  YOUR CODE. A CLEARER PERSPECTIVE.
                </span>
                <h1>A good day to build.</h1>
                <p>Here’s the big picture of your connected codebases.</p>
              </div>
              <Button onClick={() => setConnect(!connect)}>
                <Plus /> Connect repository
              </Button>
            </div>
            <div className="metrics-grid">
              {[
                {
                  label: "Repositories",
                  value: repositories.length,
                  icon: FolderGit2,
                  note: "Connected to your workspace",
                },
                {
                  label: "Files indexed",
                  value: totals.files,
                  icon: FileCode2,
                  note: "Your source of truth",
                },
                {
                  label: "Graph nodes",
                  value: totals.nodes,
                  icon: Network,
                  note: "Every symbol, connected",
                },
                {
                  label: "Relationships",
                  value: totals.edges,
                  icon: GitBranch,
                  note: "Context between the lines",
                },
              ].map((m) => (
                <div className="metric-card" key={m.label}>
                  <div>
                    <span>{m.label}</span>
                    <m.icon size={17} />
                  </div>
                  <strong>{loading ? "—" : m.value.toLocaleString()}</strong>
                  <small>{m.note}</small>
                </div>
              ))}
            </div>
            {connect && (
              <section id="connect" className="connect-panel">
                <div className="section-toolbar">
                  <div>
                    <h2>Connect a repository</h2>
                    <p>A new perspective starts with your source code.</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConnect(false)}
                    aria-label="Close connect panel"
                  >
                    <X />
                  </Button>
                </div>
                <ConnectCard />
              </section>
            )}
            <section className="repositories-section">
              <div className="section-toolbar">
                <div>
                  <h2>
                    Your repositories{" "}
                    <span className="count-chip">{repositories.length}</span>
                  </h2>
                  <p>A home for every codebase you’re getting to know.</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshCw /> Refresh
                </Button>
              </div>
              <div className="repository-filters">
                <div className="filter-tabs">
                  <button
                    aria-pressed={filter === "all"}
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    All repositories
                  </button>
                  <button
                    aria-pressed={filter === "ready"}
                    className={filter === "ready" ? "active" : ""}
                    onClick={() => setFilter("ready")}
                  >
                    Ready to explore
                  </button>
                </div>
                <label className="repository-search">
                  <Search size={15} />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a repository…"
                    aria-label="Find a repository"
                  />
                </label>
              </div>
              {error && (
                <div role="status" className="connection-notice">
                  <ShieldCheck size={16} />
                  <span>
                    The live API is unavailable. You can still explore every
                    page with the sample workspace.
                  </span>
                  <Button variant="link" size="sm" onClick={() => void load()}>
                    Retry
                  </Button>
                </div>
              )}
              {loading ? (
                <div className="dashboard-loading">
                  Loading your repositories…
                </div>
              ) : displayed.length ? (
                <div className="dashboard-repositories">
                  {displayed.map((repo) => (
                    <RepoCard
                      key={repo.id}
                      repo={repo}
                      onDelete={() => setPending(repo)}
                      onReindex={(id) =>
                        void api
                          .startIndex(id)
                          .then(load)
                          .catch((e) => setError(e.message))
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="repository-empty">
                  <span className="empty-symbol">
                    <FolderGit2 size={27} />
                  </span>
                  <h3>
                    {query
                      ? "No matching repositories"
                      : "Your next big idea starts here."}
                  </h3>
                  <p>
                    {query
                      ? "Try a different name or change the filter."
                      : "Connect a repository to turn your code into a clearer picture."}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => (query ? setQuery("") : setConnect(true))}
                  >
                    {query ? "Clear search" : "Connect your first repository"}
                    <ArrowRight />
                  </Button>
                </div>
              )}
            </section>
            <section className="demo-repo-banner">
              <div className="demo-repo-icon">
                <Network size={24} />
              </div>
              <div>
                <span className="eyebrow">A LITTLE HANDS-ON INSPIRATION</span>
                <h3>Take a connected codebase for a spin.</h3>
                <p>
                  Explore {DEMO_REPOSITORY.owner}/{DEMO_REPOSITORY.name} with
                  sample data. No setup needed.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link href="/repositories/demo">
                  Explore sample <ArrowUpRight />
                </Link>
              </Button>
            </section>
            <section>
              <div className="section-toolbar">
                <div>
                  <h2>Find your next perspective</h2>
                  <p>Three ways to get closer to your code.</p>
                </div>
                <span className="subtle-label">ONE GRAPH. EVERY ANGLE.</span>
              </div>
              <div className="workspace-tool-grid">
                {tools.map((t) => (
                  <Link
                    className={`workspace-tool ${t.className}`}
                    href={`/repositories/${activeRepo}/${t.path}`}
                    key={t.path}
                  >
                    <span className="tool-icon">
                      <t.icon size={21} />
                    </span>
                    <h3>{t.title}</h3>
                    <p>{t.body}</p>
                    <span>
                      {t.label}
                      <ArrowUpRight size={16} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
            <footer className="workspace-footer">
              <span>
                <ShieldCheck size={13} /> Evidence first. Always.
              </span>
              <span>Made for the way you think about code.</span>
            </footer>
          </motion.div>
        </main>
      </div>
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => !open && !deleting && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pending?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The repository, indexed graph, jobs, and reviews will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Keep repository
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {deleting ? "Removing…" : "Remove repository"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

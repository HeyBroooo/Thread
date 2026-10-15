'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Cable, GitBranch, GitPullRequest, Map as MapIcon, MessagesSquare, Network, Package, Route, Settings } from 'lucide-react';
import { api, type DependencyEntry, type ProjectManifest } from '@/lib/api';
import { useRepositoryContext } from '@/components/RepositoryLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

interface ArchitecturePayload {
  counts: { nodes: number; edges: number };
  routes: Array<{ path: string; kind?: string }>;
  endpoints: Array<{ label: string; method?: string; path?: string; kind?: string }>;
  services: Array<{ name: string; filePath: string | null }>;
  packages: string[];
  projectManifest?: ProjectManifest;
  graphVersion: { commit: string | null; parserVersion: string | null; graphSchemaVersion: number | null };
}

/** Display order for dependency roles, most-to-least defining of the project. */
const CATEGORY_ORDER = [
  'App framework',
  'UI & styling',
  'State & data',
  'Auth',
  'Charts & 3D',
  'Email',
  'AI',
  'Testing',
  'Build & tooling',
  'Type definitions',
  'Other',
];

function groupDependencies(deps: DependencyEntry[]): Array<[string, DependencyEntry[]]> {
  const map = new Map<string, DependencyEntry[]>();
  for (const dep of deps) {
    const list = map.get(dep.category) ?? [];
    list.push(dep);
    map.set(dep.category, list);
  }
  return [...map.entries()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
  );
}

function DependencyGroup({
  title,
  deps,
  perGroup = 30,
}: {
  title: string;
  deps: DependencyEntry[];
  perGroup?: number;
}) {
  if (deps.length === 0) return null;
  return (
    <div className="dep-section">
      <div className="dep-section-head">
        <span>{title}</span>
        <span>{deps.length}</span>
      </div>
      {groupDependencies(deps).map(([category, list]) => {
        const shown = list.slice(0, perGroup);
        return (
          <div className="dep-group" key={category}>
            <span className="dep-cat">{category}</span>
            <div className="dep-list">
              {shown.map((d) => (
                <span className="dep-pill" key={d.name} title={`${d.name} ${d.version}`}>
                  <span className="dep-name">{d.name}</span>
                  <span className="dep-ver">{d.version}</span>
                </span>
              ))}
              {list.length > shown.length && (
                <span className="dep-more">+{list.length - shown.length} more</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Shows what the repository *actually installs* — read from package.json,
 * shaped by the kind of project it turns out to be.
 */
function ProjectManifestCard({ manifest }: { manifest: ProjectManifest }) {
  if (manifest.empty) {
    return (
      <div>
        <div className="card-header">
          <h2>Packages</h2>
          <span className="muted small">package.json</span>
        </div>
        <p className="muted small">
          No package.json in this repository — it does not manage Node dependencies.
        </p>
      </div>
    );
  }

  const workspaceCount = manifest.workspaces.length;
  const total = manifest.runtime.length + manifest.dev.length;

  return (
    <div>
      <div className="card-header">
        <h2>Packages</h2>
        <span className="muted small">
          {manifest.name ? <code>{manifest.name}</code> : 'package.json'} · {manifest.manifests} manifest
          {manifest.manifests === 1 ? '' : 's'}
        </span>
      </div>

      <div className="manifest-meta">
        <Badge variant="outline" className="pill manifest-type">{manifest.projectType}</Badge>
        {manifest.packageManager && <Badge variant="outline" className="pill">{manifest.packageManager}</Badge>}
        {manifest.lockfile && <Badge variant="outline" className="pill">{manifest.lockfile}</Badge>}
        <Badge variant="outline" className="pill">{manifest.runtime.length} runtime</Badge>
        <Badge variant="outline" className="pill">{manifest.dev.length} dev</Badge>
        {workspaceCount > 0 && (
          <Badge variant="outline" className="pill">
            {workspaceCount} workspace{workspaceCount === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      {total === 0 && workspaceCount === 0 ? (
        <p className="muted small">No dependencies declared in package.json.</p>
      ) : (
        <>
          <DependencyGroup title="Dependencies" deps={manifest.runtime} />
          <DependencyGroup title="Dev dependencies" deps={manifest.dev} />
        </>
      )}

      {workspaceCount > 0 && (
        <div className="dep-section">
          <div className="dep-section-head">
            <span>Workspace packages</span>
            <span>{workspaceCount}</span>
          </div>
          <div className="ws-list">
            {manifest.workspaces.slice(0, 36).map((w) => (
              <div className="ws-item" key={w.path}>
                <span className="ws-name">{w.name}</span>
                <span className="ws-path">
                  {w.path}
                  {w.dependencies ? ` · ${w.dependencies} deps` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 650;
    let raf = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
};
const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

export default function RepositoryOverviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { repository, job, refresh, setRepository, setJob } = useRepositoryContext();
  const [architecture, setArchitecture] = useState<ArchitecturePayload | null>(null);
  const [architectureLoading, setArchitectureLoading] = useState(true);
  const [architectureError, setArchitectureError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadArchitecture = useCallback(async () => {
    setArchitectureLoading(true);
    setArchitectureError(null);
    try {
      setArchitecture(await api.architecture(id));
    } catch (cause) {
      setArchitecture(null);
      setArchitectureError(cause instanceof Error ? cause.message : 'Could not load repository architecture.');
    } finally {
      setArchitectureLoading(false);
    }
  }, [id, repository.branch]);

  useEffect(() => {
    void loadArchitecture();
  }, [loadArchitecture]);

  async function startIndex(incremental = false) {
    setBusy(true);
    try {
      const result = await api.startIndex(id, { incremental });
      setRepository({ ...repository, indexStatus: 'QUEUED' });
      setJob(result.job);
      await refresh();
      await loadArchitecture();
    } finally {
      setBusy(false);
    }
  }

  const running = repository.indexStatus === 'INDEXING' || repository.indexStatus === 'QUEUED';

  const manifest = architecture?.projectManifest ?? null;
  const installed = manifest && !manifest.empty ? manifest.runtime.length + manifest.dev.length : 0;

  const stats = [
    { key: 'Graph nodes', icon: Network, hint: 'parsed files & symbols', value: architecture?.counts.nodes ?? job?.nodesCreated ?? 0 },
    { key: 'Relationships', icon: GitBranch, hint: 'edges between them', value: architecture?.counts.edges ?? job?.edgesCreated ?? 0 },
    { key: 'Routes', icon: Route, hint: 'pages & endpoints', value: architecture?.routes.length ?? 0 },
    { key: 'API endpoints', icon: Cable, hint: 'callable surface', value: architecture?.endpoints.length ?? 0 },
    { key: 'Services', icon: Settings, hint: 'domain modules', value: architecture?.services.length ?? 0 },
    {
      key: 'Packages',
      icon: Package,
      hint: installed > 0 ? `installed in package.json` : 'workspace units',
      value: installed > 0 ? installed : architecture?.packages.length ?? 0,
    },
  ];

  const commit = architecture?.graphVersion.commit ?? repository.indexedCommitSha ?? null;

  return (
      <div className="section">
        <motion.div
          className="page-head"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          <div>
            <h1 className="page-title">Overview</h1>
            <p className="page-sub">
              The knowledge graph for <strong>{repository.owner}/{repository.name}</strong> — commit{' '}
              <code>{commit ? commit.slice(0, 8) : 'n/a'}</code> · parser{' '}
              {architecture?.graphVersion.parserVersion ?? repository.parserVersion ?? 'n/a'} · schema{' '}
              {architecture?.graphVersion.graphSchemaVersion ?? repository.graphSchemaVersion ?? 'n/a'}
            </p>
          </div>
          <div className="page-actions">
            <Button
              type="button"
              variant="outline"
              className="btn-outline"
              onClick={() => void startIndex(true)}
              disabled={repository.id === 'demo' || busy || running || !repository.indexedCommitSha}
            >
              Incremental update
            </Button>
            <Button type="button" className="btn-primary" onClick={() => void startIndex(false)} disabled={repository.id === 'demo' || busy || running}>
              {repository.indexedCommitSha ? 'Full reindex' : 'Start indexing'}
            </Button>
          </div>
        </motion.div>

        {architectureLoading ? (
          <div className="stat-grid" aria-label="Loading repository statistics">
            {stats.map((s) => <Skeleton key={s.key} className="h-24" />)}
          </div>
        ) : architectureError ? (
          <Alert variant="destructive">
            <AlertDescription>{architectureError}</AlertDescription>
          </Alert>
        ) : (
          <div className="stat-grid">
            {stats.map((s, i) => (
              <motion.div
                key={s.key}
                className={i === 0 ? 'stat-tile accent' : 'stat-tile'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04, ease: 'easeOut' }}
              >
                <div className="tile-head">
                  <span className="tile-icon" aria-hidden="true">
                    <s.icon size={16} strokeWidth={1.8} />
                  </span>
                  <span className="tile-label">{s.key}</span>
                </div>
                <div className="tile-value">
                  <AnimatedNumber value={s.value} />
                </div>
                <div className="tile-foot">{s.hint}</div>
              </motion.div>
            ))}
          </div>
        )}

        <AnimatePresence>
          {running && job && (
            <motion.div
              style={{ marginTop: 18 }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Indexing</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {job.stage} · {job.progress}%
                  </span>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Progress value={job.progress} />
                  <p className="text-xs text-muted-foreground">
                    {job.filesTotal > 0 ? `${job.filesProcessed}/${job.filesTotal} files processed` : 'Walking the repository…'}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        {repository.error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{repository.error}</AlertDescription>
          </Alert>
        )}

        <div className="section-label">
          <h2>Architecture</h2>
          <span className="muted small">Derived from the indexed graph</span>
        </div>

        <div className="grid grid-2">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: 'easeOut' }}
          >
            <Card className="h-full">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Routes</CardTitle>
              <span className="text-xs text-muted-foreground">{architecture?.routes.length ?? 0} detected</span>
            </CardHeader>
            <CardContent>
            {architectureLoading ? (
              <Skeleton className="h-24" />
            ) : architecture && architecture.routes.length > 0 ? (
              <motion.ul
                className="pr-list list-scroll"
                variants={listVariants}
                initial="hidden"
                animate="show"
              >
                {architecture.routes.slice(0, 24).map((r) => (
                  <motion.li key={r.path} variants={rowVariants}>
                    <code>{r.path}</code> <span className="muted small">{r.kind}</span>
                  </motion.li>
                ))}
              </motion.ul>
            ) : architectureError ? (
              <Alert variant="destructive"><AlertDescription>{architectureError}</AlertDescription></Alert>
            ) : (
              <p className="text-xs text-muted-foreground">No routes detected.</p>
            )}
            </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.14, ease: 'easeOut' }}
          >
            <Card className="h-full">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>API endpoints</CardTitle>
              <span className="text-xs text-muted-foreground">{architecture?.endpoints.length ?? 0} detected</span>
            </CardHeader>
            <CardContent>
            {architectureLoading ? (
              <Skeleton className="h-24" />
            ) : architecture && architecture.endpoints.length > 0 ? (
              <motion.ul
                className="pr-list list-scroll"
                variants={listVariants}
                initial="hidden"
                animate="show"
              >
                {architecture.endpoints.slice(0, 24).map((e) => (
                  <motion.li key={e.label} variants={rowVariants}>
                    <code>{e.path ?? e.label}</code>{' '}
                    <span className="muted small">
                      {e.method ?? ''}
                      {e.kind ? ` · ${e.kind}` : ''}
                    </span>
                  </motion.li>
                ))}
              </motion.ul>
            ) : architectureError ? (
              <Alert variant="destructive"><AlertDescription>{architectureError}</AlertDescription></Alert>
            ) : (
              <p className="text-xs text-muted-foreground">No API endpoints detected.</p>
            )}
            </CardContent>
            </Card>
          </motion.div>
        </div>

        {architecture && manifest && (
          <motion.div
            style={{ marginTop: 18 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: 'easeOut' }}
          >
            <Card>
              <CardContent className="pt-6">
                <ProjectManifestCard manifest={manifest} />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {architecture && architecture.services.length > 0 && (
          <motion.div
            style={{ marginTop: 18 }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.24, ease: 'easeOut' }}
          >
            <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Services</CardTitle>
              <span className="text-xs text-muted-foreground">{architecture.services.length} domain modules</span>
            </CardHeader>
            <CardContent>
            <motion.ul className="pr-list list-scroll" variants={listVariants} initial="hidden" animate="show">
              {architecture.services.slice(0, 16).map((s) => (
                <motion.li key={s.name} variants={rowVariants}>
                  <span style={{ fontWeight: 500 }}>{s.name}</span>
                  {s.filePath && (
                    <div className="muted small">
                      <code>{s.filePath}</code>
                    </div>
                  )}
                </motion.li>
              ))}
            </motion.ul>
            </CardContent>
            </Card>
          </motion.div>
        )}

        <div className="section-label">
          <h2>Explore</h2>
          <span className="muted small">Three ways into the same graph</span>
        </div>

        <motion.div
          className="feature-grid"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12, ease: 'easeOut' }}
        >
          {[
            {
              href: `/repositories/${id}/canvas`,
              icon: MapIcon,
              title: 'Codebase Canvas',
              body: 'The graph, rendered — nine views, layouts that adapt to repository size.',
            },
            {
              href: `/repositories/${id}/chat`,
              icon: MessagesSquare,
              title: 'Ask the codebase',
              body: 'Grounded answers with exact file and line citations.',
            },
            {
              href: `/repositories/${id}/prs`,
              icon: GitPullRequest,
              title: 'Pull requests',
              body: 'Impact-aware review, posted back to GitHub as comments.',
            },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.href} href={c.href}>
                <div className="feature-card">
                  <div className="icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></div>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              </Link>
            );
          })}
        </motion.div>
      </div>
  );
}

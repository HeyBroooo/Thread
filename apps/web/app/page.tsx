'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { GitPullRequest, Map, MessagesSquare, Network, ShieldCheck, ArrowRight, Check, Star } from 'lucide-react';
import { api, type RepositoryPayload } from '@/lib/api';
import {
  BackgroundOrbit,
  Footer,
  HeroCTA,
  HeroLogo,
  HeroStats,
  HeroSub,
  HeroTitle,
  FeatureCard,
  StepItem,
} from '@/components/ui';
import { FloatingNavbar } from '@/components/ui/floating-navbar';
import { ConnectCard } from '@/components/ui/connect-card';
import { RepoCard } from '@/components/ui/repo-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function LandingPage() {
  const [repositories, setRepositories] = useState<RepositoryPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<RepositoryPayload | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listRepositories();
      setRepositories(data.repositories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const totalNodes = repositories.reduce((acc, r) => acc + (r.latestJob?.nodesCreated ?? 0), 0);
  const totalEdges = repositories.reduce((acc, r) => acc + (r.latestJob?.edgesCreated ?? 0), 0);
  const totalFiles = repositories.reduce((acc, r) => acc + (r.latestJob?.filesProcessed ?? 0), 0);

  function requestDelete(id: string) {
    const repository = repositories.find((item) => item.id === id);
    if (repository) setPendingDelete(repository);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteRepository(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the repository.');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="landing-page">
      <FloatingNavbar />

      {/* ===== Hero ===== */}
      <header className="hero">
        <BackgroundOrbit>
          <div className="hero-grid-lines" />
          <div className="hero-inner">
            <HeroLogo />
            <motion.div
              initial={{ opacity: 0, y: 18, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto 28px' }}
            >
              <Badge variant="secondary" className="inline-flex rounded-full px-3 py-1">
                Evidence-backed knowledge graph
              </Badge>
            </motion.div>
            <HeroTitle />
            <HeroSub />
            <HeroCTA />
            <HeroStats repositories={repositories} totalNodes={totalNodes} totalEdges={totalEdges} totalFiles={totalFiles} />
          </div>
        </BackgroundOrbit>
      </header>

      <main className="app">
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                <span className="mt-1 block text-xs opacity-80">
                  Ensure the API is running and the API proxy target is configured correctly.
                </span>
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        {/* ===== Connect section — uses redesigned ConnectCard ===== */}
        <motion.section
          id="connect"
          className="connect-section"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <ConnectCard />
        </motion.section>

        {/* ===== Repositories ===== */}
        <section id="repos">
          <div className="section-head">
            <h2>Repositories</h2>
            <p>The knowledge graph lives here — index, explore, ask, review.</p>
          </div>

          {loading && repositories.length === 0 ? (
            <Card>
              <CardContent className="space-y-2.5 pt-6">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ) : repositories.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <Map size={28} strokeWidth={1.6} aria-hidden="true" className="text-primary" />
                  <h3 className="text-sm font-semibold">No repositories connected yet</h3>
                  <p className="max-w-md text-xs text-muted-foreground">
                    Connect your first repository above and the graph — canvas, chat and PR review —
                    appears here.
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              className="repo-grid"
              variants={container}
              initial="hidden"
              animate="show"
            >
              <AnimatePresence initial={false}>
                {repositories.map((repo) => (
                  <motion.div
                    key={repo.id}
                    variants={item}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <RepoCard repo={repo} onReindex={(id) => {
                      api.startIndex(id).then(() => load()).catch((e) => setError(e instanceof Error ? e.message : String(e)));
                    }} onDelete={requestDelete} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>

        {/* ===== Features — Bento-grid style ===== */}
        <section>
          <div className="section-head">
            <h2>One graph, every surface</h2>
            <p>The AI reasons over the graph. The AI does not construct it.</p>
          </div>
          <motion.div
            className="feature-grid"
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
          >
            {[
              {
                icon: Network,
                title: 'Codebase Canvas',
                body: 'Force, radial, cluster and collapsible tree layouts — chosen automatically by repository size. Every node carries evidence.',
                check: 'Evidence on every node',
              },
              {
                icon: MessagesSquare,
                title: 'Grounded Chat',
                body: 'Retrieval-first answers: search → bounded graph traversal → compact evidence → model → validation. Answers cite exact lines.',
                check: 'Citations with line numbers',
              },
              {
                icon: GitPullRequest,
                title: 'Impact Analysis',
                body: 'PR diffs map to changed symbols; direct and indirect dependents are computed so reviewers see blast radius, not just diffs.',
                check: 'Blast radius for every diff',
              },
              {
                icon: ShieldCheck,
                title: 'Validated Findings',
                body: 'Every finding is checked against the graph before posting — file exists, line in range, severity valid, duplicates removed.',
                check: 'Validated before it lands',
              },
            ].map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </motion.div>
        </section>

        {/* ===== Stats row ===== */}
        <section>
          <div className="section-head">
            <h2>Built for evidence</h2>
            <p>Every answer traces back to a symbol, an edge and a file.</p>
          </div>
          <motion.div
            className="stat-grid"
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
          >
            {[
              { value: '150+', label: 'files per minute', desc: 'Static analysis throughput on a modern laptop' },
              { value: '100%', label: 'evidence-backed', desc: 'Every node and edge carries source locations' },
              { value: '0', label: 'browser crawls', desc: 'We clone — we never scrape GitHub UI' },
              { value: '4', label: 'surfaces, one graph', desc: 'Canvas, chat, PR review and impact analysis' },
            ].map((s) => (
              <motion.div
                key={s.label}
                variants={item}
                className="stat-tile"
                style={{ textAlign: 'left' }}
              >
                <div className="tile-value" style={{ fontSize: 32, fontWeight: 650, letterSpacing: '-0.035em', marginTop: 0, background: 'linear-gradient(120deg, #ffffff 0%, #b9e9ff 55%, #ddc4ff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontVariantNumeric: 'tabular-nums' }}>
                  {s.value}
                </div>
                <div className="tile-label" style={{ fontSize: 11, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginTop: 6 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  {s.desc}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* ===== How it works ===== */}
        <section id="how">
          <div className="section-head">
            <h2>How it works</h2>
            <p>Static analysis builds the graph once — every surface reads from it.</p>
          </div>
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <ol className="step-list">
              <StepItem
                number="1"
                title="Parse"
                description="ts-morph extracts files, symbols, imports, calls, JSX, HTTP targets and server routes from a local checkout."
              />
              <StepItem
                number="2"
                title="Build"
                description="Nodes and edges are assembled into a persistent graph — every relationship carries source evidence and a confidence value."
              />
              <StepItem
                number="3"
                title="Explore"
                description="The canvas renders the graph with layouts that adapt to repository size; chat and PR review read from the same evidence."
              />
              <StepItem
                number="4"
                title="Reason"
                description="Chat retrieves graph evidence before calling the model; PR review maps changed lines to symbols and validates every finding."
              />
            </ol>
          </motion.div>
        </section>

        {/* ===== CTA section ===== */}
        <section style={{ textAlign: 'center' }}>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ padding: '64px 24px' }}
          >
            <h2
              style={{
                fontSize: 'clamp(28px, 4vw, 48px)',
                fontWeight: 700,
                letterSpacing: '-0.035em',
                margin: '0 0 16px',
                lineHeight: 1.1,
                background: 'linear-gradient(135deg, #17231e 0%, #2f7659 50%, #4b8391 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Understand your codebase before you change it.
            </h2>
            <p
              style={{
                fontSize: 16,
                color: 'var(--text-muted)',
                maxWidth: 560,
                margin: '0 auto 32px',
                lineHeight: 1.6,
              }}
            >
              One evidence-backed graph powers the canvas, grounded chat and context-aware PR review.
              Connect a repository and the graph appears in seconds.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                href="#connect"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  background: 'var(--accent)',
                  color: '#fff',
                  borderRadius: 8,
                  fontWeight: 650,
                  fontSize: 14,
                  textDecoration: 'none',
                  boxShadow: '0 8px 24px -8px rgba(47,118,89,0.5)',
                  transition: 'background 140ms ease, transform 140ms ease, box-shadow 140ms ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.background = '#255f46';
                  (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 12px 32px -8px rgba(47,118,89,0.6)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'var(--accent)';
                  (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                  (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 8px 24px -8px rgba(47,118,89,0.5)';
                }}
              >
                Connect a repository
                <ArrowRight size={16} strokeWidth={2} />
              </Link>
              <Link
                href="#how"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  background: 'transparent',
                  color: 'var(--text)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 8,
                  fontWeight: 550,
                  fontSize: 14,
                  textDecoration: 'none',
                  transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'var(--surface-1)';
                  (e.currentTarget as HTMLAnchorElement).style.color = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                  (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)';
                }}
              >
                How it works
              </Link>
            </div>
          </motion.div>
        </section>
      </main>

      <Footer />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this repository?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.owner}/${pendingDelete.name} and its indexed graph, jobs, and reviews will be deleted. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? 'Removing…' : 'Remove repository'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

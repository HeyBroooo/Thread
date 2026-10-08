'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import {
  GitPullRequest,
  Map,
  MessagesSquare,
  Network,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Zap,
  Layers,
  Search,
} from 'lucide-react';
import { api, type RepositoryPayload } from '@/lib/api';
import {
  BackgroundOrbit,
  Footer,
  HeroCTA,
  HeroLogo,
  HeroStats,
  HeroSub,
  HeroTitle,
  StepItem,
} from '@/components/ui';
import { FloatingNavbar } from '@/components/ui/floating-navbar';
import { ConnectCard } from '@/components/ui/connect-card';
import { RepoCard } from '@/components/ui/repo-card';
import { SectionHeading } from '@/components/ui/section-heading';
import { TechMarquee } from '@/components/ui/tech-marquee';
import { FeatureRow } from '@/components/ui/feature-row';
import { CanvasShowcase, ChatMock, ImpactMock } from '@/components/ui/product-mocks';
import { FaqAccordion } from '@/components/ui/faq-accordion';
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
import { Button } from '@/components/ui/button';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

const FEATURES = [
  {
    icon: Network,
    title: 'Codebase Canvas',
    body: 'Force, radial, cluster and collapsible tree layouts — chosen automatically by repository size. Every node carries evidence.',
  },
  {
    icon: MessagesSquare,
    title: 'Grounded Chat',
    body: 'Retrieval-first answers: search → bounded graph traversal → compact evidence → model → validation. Answers cite exact lines.',
  },
  {
    icon: GitPullRequest,
    title: 'Impact Analysis',
    body: 'PR diffs map to changed symbols; direct and indirect dependents are computed so reviewers see blast radius, not just diffs.',
  },
  {
    icon: ShieldCheck,
    title: 'Validated Findings',
    body: 'Every finding is checked against the graph before posting — file exists, line in range, severity valid, duplicates removed.',
  },
  {
    icon: Search,
    title: 'Symbol Search',
    body: 'Jump to any function, component or route in milliseconds — the index is built from your checkout, not a remote crawl.',
  },
  {
    icon: Layers,
    title: 'Dependency Map',
    body: 'Imports, calls, API targets and server routes become one navigable map across files, packages and workspaces.',
  },
];

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
    const repository = repositories.find((repoItem) => repoItem.id === id);
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
              style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto 24px' }}
            >
              <span className="lp-hero-pill">
                <span className="lp-hero-pill-dot" aria-hidden="true" />
                Evidence-backed knowledge graph
                <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
              </span>
            </motion.div>
            <HeroTitle />
            <HeroSub />
            <HeroCTA />
            <HeroStats repositories={repositories} totalNodes={totalNodes} totalEdges={totalEdges} totalFiles={totalFiles} />
          </div>
        </BackgroundOrbit>
      </header>

      {/* ===== Tech marquee ===== */}
      <TechMarquee />

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

        {/* ===== Connect section ===== */}
        <section id="connect" className="lp-section">
          <SectionHeading
            eyebrow="Get started"
            title="Connect a repository"
            sub="Paste a GitHub URL — we clone it, parse it, and build the graph in seconds."
          />
          <ConnectCard />
        </section>

        {/* ===== Repositories ===== */}
        <section id="repos" className="lp-section">
          <SectionHeading
            eyebrow="Repositories"
            title="The knowledge graph lives here"
            sub="Index, explore, ask, review — every surface reads from the same evidence."
          />

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
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <span className="lp-empty-icon" aria-hidden="true">
                    <Map size={26} strokeWidth={1.6} />
                  </span>
                  <h3 className="m-0 text-[15px] font-semibold">No repositories connected yet</h3>
                  <p className="m-0 max-w-md text-[13px] text-muted-foreground">
                    Connect your first repository above and the graph — canvas, chat and PR review —
                    appears here.
                  </p>
                  <Button asChild size="sm" className="mt-2">
                    <Link href="#connect">
                      Connect a repository
                      <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div className="repo-grid" variants={container} initial="hidden" animate="show">
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
                    <RepoCard
                      repo={repo}
                      onReindex={(id) => {
                        api.startIndex(id)
                          .then(() => load())
                          .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                      }}
                      onDelete={requestDelete}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>

        {/* ===== Features — alternating rows ===== */}
        <section id="features" className="lp-section lp-features">
          <SectionHeading
            eyebrow="Features"
            title="One graph, every surface"
            sub="The AI reasons over the graph. The AI does not construct it."
          />

          <div className="lp-feature-rows">
            <FeatureRow
              icon={Network}
              eyebrow="Codebase canvas"
              title="See the whole system at once"
              body="Force, radial, cluster and collapsible tree layouts — picked automatically from repository size. Zoom from an architecture overview to a single symbol without leaving the canvas."
              bullets={[
                'Layout adapts from 50 files to 50,000',
                'Every node shows its evidence',
                'Hover to highlight blast radius',
              ]}
              visual={<CanvasShowcase />}
            />
            <FeatureRow
              reverse
              icon={MessagesSquare}
              eyebrow="Grounded chat"
              title="Answers that cite exact lines"
              body="Retrieval runs first — search, bounded graph traversal, compact evidence — then the model answers and validation checks the claim. No citations, no answer."
              bullets={[
                'Citations with file and line numbers',
                'Validated before it reaches you',
                'Follow-up questions keep context',
              ]}
              visual={<ChatMock />}
            />
            <FeatureRow
              icon={GitPullRequest}
              eyebrow="Impact analysis"
              title="Blast radius for every diff"
              body="PR diffs map to changed symbols; direct and indirect dependents are computed so reviewers see what a change actually touches — not just the changed lines."
              bullets={[
                'Direct and indirect dependents',
                'Findings validated against the graph',
                'Duplicate findings removed before posting',
              ]}
              visual={<ImpactMock />}
            />
          </div>
        </section>

        {/* ===== Feature grid ===== */}
        <section className="lp-section">
          <SectionHeading
            eyebrow="Built for evidence"
            title="Everything traces back"
            sub="Every answer traces back to a symbol, an edge and a file."
          />
          <motion.div
            className="feature-grid"
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
          >
            {FEATURES.map((f) => (
              <motion.div key={f.title} variants={item} className="lp-feature-card">
                <span className="lp-feature-card-icon" aria-hidden="true">
                  <f.icon size={17} strokeWidth={1.8} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* ===== Stats ===== */}
        <section className="lp-section">
          <SectionHeading
            eyebrow="Numbers"
            title="Built for evidence"
            sub="Static analysis throughput on a modern laptop — with zero browser crawls."
          />
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
              { value: '0', label: 'browser crawls', desc: 'We clone — we never scrape the GitHub UI' },
              { value: '4', label: 'surfaces, one graph', desc: 'Canvas, chat, PR review and impact analysis' },
            ].map((s) => (
              <motion.div key={s.label} variants={item} className="stat-tile lp-stat-tile">
                <div className="lp-stat-value">{s.value}</div>
                <div className="lp-stat-label">{s.label}</div>
                <div className="lp-stat-desc">{s.desc}</div>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* ===== How it works ===== */}
        <section id="how" className="lp-section">
          <SectionHeading
            eyebrow="How it works"
            title="Parse. Build. Explore. Reason."
            sub="Static analysis builds the graph once — every surface reads from it."
          />
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <ol className="step-list lp-step-list">
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

        {/* ===== FAQ ===== */}
        <section id="faq" className="lp-section">
          <SectionHeading
            eyebrow="FAQ"
            title="Frequently asked questions"
            sub="Everything you might want to know before connecting a repository."
          />
          <FaqAccordion />
        </section>

        {/* ===== CTA ===== */}
        <section className="lp-section">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="lp-cta"
          >
            <span className="lp-cta-glow" aria-hidden="true" />
            <h2>Understand your codebase before you change it.</h2>
            <p>
              One evidence-backed graph powers the canvas, grounded chat and context-aware PR review.
              Connect a repository and the graph appears in seconds.
            </p>
            <div className="lp-cta-actions">
              <Button asChild size="lg" className="bg-white px-6 font-semibold text-primary shadow-md hover:bg-white/90">
                <Link href="#connect">
                  Connect a repository
                  <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/30 bg-white/10 px-6 text-white backdrop-blur hover:bg-white/20 hover:text-white"
              >
                <Link href="#how">
                  <Zap size={15} strokeWidth={2} aria-hidden="true" />
                  How it works
                </Link>
              </Button>
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

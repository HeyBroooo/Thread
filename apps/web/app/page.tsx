'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { GitPullRequest, Map, MessagesSquare, Network, ShieldCheck } from 'lucide-react';
import { api, type RepositoryPayload } from '@/lib/api';
import {
  BackgroundOrbit,
  Footer,
  HeroCTA,
  HeroLogo,
  HeroStats,
  HeroSub,
  HeroTitle,
  LandingNav,
} from '@/components/ui';
import { ConnectCard } from '@/components/ui/connect-card';
import { FeatureCard } from '@/components/ui/feature-card';
import { RepoCard } from '@/components/ui/repo-card';
import { StepItem } from '@/components/ui/step-item';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function LandingPage() {
  const [repositories, setRepositories] = useState<RepositoryPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="landing-page">
      <LandingNav />

      <header className="hero">
        <BackgroundOrbit>
          <div className="hero-grid-lines" />
          <div className="hero-inner">
            <HeroLogo />
            <HeroTitle />
            <HeroSub />
            <HeroCTA />
            <HeroStats repositories={repositories} totalNodes={totalNodes} totalEdges={totalEdges} totalFiles={totalFiles} />
          </div>
        </BackgroundOrbit>
      </header>

      <main className="app" style={{ paddingTop: 48 }}>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="card"
            style={{ borderColor: 'rgba(239,68,68,0.4)' }}
          >
            <p className="error">{error}</p>
            <p className="muted small">
              Ensure the API is running and the Vercel API proxy target is configured correctly.
            </p>
          </motion.div>
        )}

        <motion.section
          className="connect-section"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginTop: 20 }}
        >
          <ConnectCard />
        </motion.section>

        <section style={{ marginTop: 40 }} id="repos">
          <div className="section-head">
            <h2>Repositories</h2>
            <p>The knowledge graph lives here — index, explore, ask, review.</p>
          </div>

          {loading && repositories.length === 0 ? (
            <div className="card">
              <div className="skeleton" style={{ height: 14, width: '40%', marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 12, width: '70%', marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 12, width: '55%' }} />
            </div>
          ) : repositories.length === 0 ? (
            <motion.div
              className="card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ textAlign: 'center', padding: '40px 18px' }}
            >
              <Map size={28} strokeWidth={1.6} aria-hidden="true" style={{ marginBottom: 8, color: 'var(--accent)' }} />
              <h3>No repositories connected yet</h3>
              <p className="muted small" style={{ maxWidth: 420, margin: '0 auto' }}>
                Connect your first repository above and the graph — canvas, chat and PR review —
                appears here.
              </p>
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
                    }} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>

        <section style={{ marginTop: 56 }}>
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
            ].map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </motion.div>
        </section>

        <section style={{ marginTop: 56 }} id="how">
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
      </main>

      <Footer />
    </div>
  );
}

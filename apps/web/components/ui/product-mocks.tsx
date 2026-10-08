'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronRight, FileCode2, GitPullRequest, MessagesSquare, Network, Sparkles } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Small building blocks shared by the product mocks                    */
/* ------------------------------------------------------------------ */

function MockWindow({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`lp-mock ${className ?? ''}`}>
      <div className="lp-mock-bar">
        <span className="lp-mock-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-mock-title">{title}</span>
      </div>
      <div className="lp-mock-body">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas mock — animated force-graph                                   */
/* ------------------------------------------------------------------ */

const GRAPH_NODES = [
  { x: 50, y: 46, r: 9, c: 'var(--accent)' },
  { x: 26, y: 26, r: 6, c: '#4b8391' },
  { x: 74, y: 24, r: 6, c: '#4b8391' },
  { x: 22, y: 66, r: 6, c: '#8b7ae8' },
  { x: 78, y: 64, r: 6, c: '#8b7ae8' },
  { x: 50, y: 78, r: 5, c: '#4b8391' },
  { x: 38, y: 14, r: 4, c: '#9ab5a1' },
  { x: 64, y: 84, r: 4, c: '#9ab5a1' },
  { x: 12, y: 46, r: 4, c: '#9ab5a1' },
  { x: 90, y: 44, r: 4, c: '#9ab5a1' },
];

const GRAPH_EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 6], [1, 8], [2, 6], [3, 8], [4, 9],
  [5, 7], [2, 9], [3, 5], [4, 5],
];

export function CanvasMock() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setActive((v) => (v + 1) % GRAPH_NODES.length), 1400);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <MockWindow title="canvas · force layout" className="lp-mock-canvas">
      <svg viewBox="0 0 100 100" className="lp-graph" role="img" aria-label="Knowledge graph preview">
        {GRAPH_EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={GRAPH_NODES[a].x}
            y1={GRAPH_NODES[a].y}
            x2={GRAPH_NODES[b].x}
            y2={GRAPH_NODES[b].y}
            className={`lp-graph-edge ${a === active || b === active ? 'is-hot' : ''}`}
          />
        ))}
        {GRAPH_NODES.map((n, i) => (
          <g key={i} className={`lp-graph-node ${i === active ? 'is-active' : ''}`}>
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.c} />
            {i === active ? <circle cx={n.x} cy={n.y} r={n.r + 4} className="lp-graph-halo" /> : null}
          </g>
        ))}
      </svg>
      <div className="lp-mock-legend">
        <span><i style={{ background: 'var(--accent)' }} /> symbols</span>
        <span><i style={{ background: '#4b8391' }} /> modules</span>
        <span><i style={{ background: '#8b7ae8' }} /> routes</span>
        <span className="lp-mock-legend-count">370 nodes · 607 edges</span>
      </div>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Chat mock — typing answer with citations                            */
/* ------------------------------------------------------------------ */

const CHAT_ANSWER =
  'Rate limiting lives in the request pipeline, before any handler runs.';

export function ChatMock() {
  const [step, setStep] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setStep(3);
      return;
    }
    const id = setInterval(() => setStep((v) => (v + 1) % 4), 1100);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <MockWindow title="chat · grounded answer" className="lp-mock-chat">
      <div className="lp-chat-q">
        <MessagesSquare size={13} strokeWidth={1.8} aria-hidden="true" />
        Where is rate limiting enforced?
      </div>
      <div className="lp-chat-a">
        <p className="lp-chat-line">
          {CHAT_ANSWER}
          {step < 2 ? <span className="lp-caret" aria-hidden="true" /> : null}
        </p>
        {step >= 2 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="lp-chat-cites"
          >
            <span className="lp-cite"><FileCode2 size={11} aria-hidden="true" /> middleware/rateLimit.ts:42</span>
            <span className="lp-cite"><FileCode2 size={11} aria-hidden="true" /> server/limits.ts:17</span>
          </motion.div>
        ) : null}
        {step >= 3 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="lp-chat-validated"
          >
            <Check size={12} strokeWidth={2.4} aria-hidden="true" />
            validated against the graph
          </motion.div>
        ) : null}
      </div>
      <div className="lp-chat-input" aria-hidden="true">
        <Sparkles size={13} strokeWidth={1.8} />
        <span>Ask anything about this repo…</span>
      </div>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* PR impact mock — blast radius list                                  */
/* ------------------------------------------------------------------ */

const IMPACT_ROWS = [
  { file: 'src/billing/invoice.ts', depth: 0, note: 'changed' },
  { file: 'src/billing/totals.ts', depth: 1, note: 'calls invoice()' },
  { file: 'src/api/billingRoutes.ts', depth: 1, note: 'imports totals' },
  { file: 'src/reports/monthly.ts', depth: 2, note: 'reads totals' },
  { file: 'src/jobs/dunning.ts', depth: 2, note: 'reads totals' },
];

export function ImpactMock() {
  const [revealed, setRevealed] = useState(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setRevealed(IMPACT_ROWS.length);
      return;
    }
    const id = setInterval(() => setRevealed((v) => (v >= IMPACT_ROWS.length ? 1 : v + 1)), 900);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <MockWindow title="pull request #482 · impact" className="lp-mock-impact">
      <div className="lp-impact-head">
        <GitPullRequest size={13} strokeWidth={1.8} aria-hidden="true" />
        blast radius · 4 indirect dependents
      </div>
      <ul className="lp-impact-list">
        {IMPACT_ROWS.map((row, i) => (
          <li
            key={row.file}
            className={`lp-impact-row ${i < revealed ? 'is-in' : ''} ${row.depth > 0 ? 'is-indirect' : ''}`}
            style={{ marginLeft: row.depth * 14 }}
          >
            <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
            <span className="lp-impact-file">{row.file}</span>
            <span className="lp-impact-note">{row.note}</span>
          </li>
        ))}
      </ul>
    </MockWindow>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas feature-row visual (larger, with toolbar chrome)             */
/* ------------------------------------------------------------------ */

export function CanvasShowcase() {
  return (
    <MockWindow title="cognimail · canvas" className="lp-mock-showcase">
      <div className="lp-showcase-toolbar">
        <span className="lp-showcase-search">⌕ search symbols…</span>
        <span className="lp-chip-mini is-active">force</span>
        <span className="lp-chip-mini">radial</span>
        <span className="lp-chip-mini">tree</span>
      </div>
      <CanvasMockGraph />
    </MockWindow>
  );
}

function CanvasMockGraph() {
  return (
    <div className="lp-showcase-graph">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Repository graph">
        {GRAPH_EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={GRAPH_NODES[a].x}
            y1={GRAPH_NODES[a].y}
            x2={GRAPH_NODES[b].x}
            y2={GRAPH_NODES[b].y}
            className="lp-graph-edge"
          />
        ))}
        {GRAPH_NODES.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={n.c} className="lp-graph-node-dot" />
        ))}
      </svg>
      <div className="lp-mock-legend">
        <span><i style={{ background: 'var(--accent)' }} /> symbols</span>
        <span><i style={{ background: '#4b8391' }} /> modules</span>
        <span><i style={{ background: '#8b7ae8' }} /> routes</span>
        <span className="lp-mock-legend-count"><Network size={11} aria-hidden="true" /> layouts adapt to repo size</span>
      </div>
    </div>
  );
}

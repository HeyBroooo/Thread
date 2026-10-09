'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { FolderTree, MousePointer2, Move } from 'lucide-react';
import { api, type NodeDetailPayload } from '@/lib/api';
import { NODE_COLORS } from './GraphCanvas';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';

/** Relationships that describe runtime flow rather than structural containment. */
const FLOW_EDGES = new Set([
  'CALLS',
  'USES',
  'RENDERS',
  'CALLS_API',
  'NAVIGATES_TO',
  'IMPLEMENTS',
  'USES_STORE',
  'USES_CONTEXT',
]);

/** Per-edge-type tint so flow direction is readable at a glance. */
const EDGE_TONES: Record<string, string> = {
  CALLS: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  CALLS_API: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  RENDERS: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  NAVIGATES_TO: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200',
  IMPORTS: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
};

const EDGE_TONE_FALLBACK = 'border-white/15 bg-white/10 text-slate-200';

const BLOCK = 'rounded-lg border border-white/10 bg-white/[0.05] p-3';
const BLOCK_LABEL =
  'text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400';

export function NodeDetails({
  repositoryId,
  nodeId,
  onFocusNode,
}: {
  repositoryId: string;
  nodeId: string | null;
  onFocusNode?: (nodeId: string) => void;
}) {
  const [detail, setDetail] = useState<NodeDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nodeId) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .node(repositoryId, nodeId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repositoryId, nodeId]);

  // Every new selection settles in with a short GSAP fade/rise instead of a
  // hard swap, which makes navigating the graph feel continuous.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !detail) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { y: 8, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.28, ease: 'power2.out' },
      );
    }, el);

    return () => ctx.revert();
  }, [detail]);

  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-l border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl"
      aria-label="Node details"
    >
      <div ref={contentRef} className="flex flex-col gap-3">
        {!nodeId && <EmptyState />}

        {loading && !detail && <LoadingState />}

        {error && (
          <Alert variant="destructive">
            <span className="block break-words text-[12.5px]">{error}</span>
          </Alert>
        )}

        {detail && !loading && !error && (
          <NodeDetailBody detail={detail} onFocusNode={onFocusNode} />
        )}
      </div>
    </aside>
  );
}

function EmptyState() {
  return (
    <>
      <h3 className="m-0 text-[15px] font-semibold text-white">Node details</h3>
      <p className="m-0 text-[12.5px] leading-relaxed text-slate-400">
        Select a node on the canvas to inspect its relationships and source evidence.
      </p>
      <div className={`${BLOCK} flex flex-col gap-2`}>
        <Hint icon={<MousePointer2 size={13} aria-hidden="true" />}>
          <strong className="font-semibold text-slate-200">Click</strong> a node to inspect
        </Hint>
        <Hint icon={<Move size={13} aria-hidden="true" />}>
          <strong className="font-semibold text-slate-200">Drag</strong> to pan · scroll to zoom
        </Hint>
        <Hint icon={<FolderTree size={13} aria-hidden="true" />}>
          In Tree layout, <strong className="font-semibold text-slate-200">click folders</strong> to
          expand
        </Hint>
      </div>
    </>
  );
}

function Hint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12px] leading-snug text-slate-400">
      <span className="shrink-0 text-emerald-300">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

function NodeDetailBody({
  detail,
  onFocusNode,
}: {
  detail: NodeDetailPayload;
  onFocusNode?: (nodeId: string) => void;
}) {
  const { node } = detail;
  const calls = [...detail.outgoing, ...detail.incoming].filter((e) => FLOW_EDGES.has(e.edgeType));
  const properties = Object.entries(node.metadata).filter(
    ([, v]) => v !== null && typeof v !== 'object',
  );

  return (
    <>
      {/* Header ------------------------------------------------------------ */}
      <header className="flex min-w-0 items-start gap-2.5">
        <span
          className="mt-[5px] size-2.5 shrink-0 rounded-full"
          style={{ background: NODE_COLORS[node.nodeType] ?? '#94a3b8' }}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3
            className="m-0 truncate text-[14px] font-semibold leading-snug text-white"
            title={node.qualifiedName || node.name}
          >
            {node.name}
          </h3>
          <Badge variant="secondary" className="w-fit">
            {node.nodeType}
          </Badge>
        </div>
      </header>

      {/* Path -------------------------------------------------------------- */}
      {node.filePath && (
        <div className={BLOCK}>
          <div className={BLOCK_LABEL}>Path</div>
          {/* `break-all` + `min-w-0` is what keeps long monorepo paths inside the
              320px rail instead of overflowing the card. */}
          <code className="mt-1.5 block min-w-0 break-all font-mono text-[11.5px] leading-relaxed text-emerald-300">
            {node.filePath}
            {node.startLine ? `:${node.startLine}–${node.endLine ?? node.startLine}` : ''}
          </code>
        </div>
      )}

      {/* Properties -------------------------------------------------------- */}
      {properties.length > 0 && (
        <div className={BLOCK}>
          <div className={BLOCK_LABEL}>Properties</div>
          <dl className="m-0 mt-1.5 grid gap-1.5">
            {properties.slice(0, 8).map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-baseline gap-2">
                <dt className="shrink-0 text-[11.5px] text-slate-400">{key}</dt>
                <dd className="m-0 min-w-0 break-all text-right font-mono text-[11.5px] text-slate-200">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Relationships ----------------------------------------------------- */}
      <div className={BLOCK}>
        <div className={BLOCK_LABEL}>Relationships ({calls.length})</div>
        {calls.length === 0 ? (
          <p className="m-0 mt-1.5 text-[12px] text-slate-400">No flow relationships recorded.</p>
        ) : (
          <ul className="m-0 mt-1 list-none p-0">
            {calls.slice(0, 25).map((edge) => {
              const outgoing = edge.source === node.id;
              const otherId = outgoing ? edge.target : edge.source;
              const otherName = otherId === node.id ? node.name : otherId;
              return (
                <li
                  key={edge.id}
                  className="flex flex-col gap-1 border-b border-white/[0.07] py-2 last:border-b-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] ${
                        EDGE_TONES[edge.edgeType] ?? EDGE_TONE_FALLBACK
                      }`}
                    >
                      {outgoing ? '→' : '←'} {edge.edgeType}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-w-0 truncate p-0 text-[12px]"
                      onClick={() => onFocusNode?.(otherId)}
                      title={edge.evidence || otherName}
                    >
                      {otherName}
                    </Button>
                    <span className="ml-auto shrink-0 text-[10.5px] text-slate-500">
                      {Math.round(edge.confidence * 100)}%
                    </span>
                  </div>
                  {edge.sourceFile && (
                    <div className="min-w-0 break-all font-mono text-[10.5px] leading-relaxed text-slate-500">
                      {edge.sourceFile}
                      {edge.sourceLine ? `:${edge.sourceLine}` : ''}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Evidence ---------------------------------------------------------- */}
      {detail.evidence && (
        <div className={BLOCK}>
          <div className={BLOCK_LABEL}>Source</div>
          <code className="mt-1.5 block min-w-0 break-all font-mono text-[11px] text-emerald-300">
            {detail.evidence.filePath}:{detail.evidence.startLine}–{detail.evidence.endLine}
          </code>
          <pre className="mt-2 max-h-[260px] overflow-auto rounded-md border border-white/10 bg-black/30 p-2.5 font-mono text-[11px] leading-[1.55] text-slate-200">
            {detail.evidence.snippet
              .split('\n')
              .map((line, i) => `${String(detail.evidence!.startLine + i).padStart(4, ' ')}  ${line}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </>
  );
}

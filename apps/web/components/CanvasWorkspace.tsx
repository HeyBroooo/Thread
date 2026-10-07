'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type ApiEdge, type ApiNode, type SearchPayload } from '@/lib/api';
import {
  CanvasLegend,
  GraphCanvas,
  LAYOUTS,
  coerceCanvasLayout,
  coerceCanvasMode,
  layoutRationale,
  modeVisibleNodes,
  resolveLayout,
  type CanvasMode,
  type CanvasLayout,
} from './GraphCanvas';
import { NodeDetails } from './NodeDetails';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const MODES: Array<{ value: CanvasMode; label: string }> = [
  { value: 'full', label: 'Full System' },
  { value: 'dependencies', label: 'Dependencies' },
  { value: 'components', label: 'Component tree' },
  { value: 'api', label: 'API flow' },
  { value: 'calls', label: 'Call graph' },
];

/**
 * Ready-made graph views: each one is a mode + layout pair the user can jump
 * between in one click. The choice is remembered per repository, so the canvas
 * reopens with the graph they actually like.
 */
const GRAPH_VIEWS: Array<{
  id: string;
  label: string;
  mode: CanvasMode;
  layout: CanvasLayout;
  hint: string;
}> = [
  { id: 'overview', label: 'Full System', mode: 'full', layout: 'collapsible', hint: 'Full repository in a collapsible hierarchy' },
  { id: 'dependencies', label: 'Dependencies', mode: 'dependencies', layout: 'cluster', hint: 'Files, packages and the import graph' },
  { id: 'components', label: 'Components', mode: 'components', layout: 'cluster', hint: 'Components with their render edges' },
  { id: 'api', label: 'API flow', mode: 'api', layout: 'force', hint: 'Routes, endpoints and the calls between them' },
  { id: 'calls', label: 'Call graph', mode: 'calls', layout: 'force', hint: 'Symbols connected by call relationships' },
];

const MODE_HINTS: Record<CanvasMode, string> = {
  full: 'Every node and relationship the parser extracted',
  dependencies: 'Files, packages and the import graph',
  components: 'Components with their containment backbone and render edges',
  api: 'Components, routes and endpoints with call/navigate edges',
  calls: 'Symbols connected by call relationships',
  'pr-impact': 'Nodes touched by the pull request',
};

export function CanvasWorkspace({
  repositoryId,
  repositoryBranch,
  status,
  indexStatus,
  initialHighlight = [],
  initialFocusNodeId = null,
}: {
  repositoryId: string;
  repositoryBranch?: string;
  status?: string;
  indexStatus: string;
  initialHighlight?: string[];
  initialFocusNodeId?: string | null;
}) {
  const [nodes, setNodes] = useState<ApiNode[]>([]);
  const [edges, setEdges] = useState<ApiEdge[]>([]);
  const [counts, setCounts] = useState<{ nodes: number; edges: number } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [mode, setMode] = useState<CanvasMode>('full');
  const [layout, setLayout] = useState<CanvasLayout>('collapsible');
  const [restored, setRestored] = useState(false);
  const [selected, setSelected] = useState<ApiNode | null>(null);
  const [highlight, setHighlight] = useState<string[]>(initialHighlight);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(initialFocusNodeId);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchPayload['results']>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFullGraph = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.graph(repositoryId, { scope: 'full', limit: 1200 });
      setNodes(data.nodes);
      setEdges(data.edges);
      setCounts(data.counts);
      setTruncated(data.truncated);
      setHighlight([]);
      setSelected(null);
      setFocusNodeId(null);
      setResults([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repositoryId, repositoryBranch]);

  useEffect(() => {
    void loadFullGraph();
  }, [loadFullGraph]);

  // Restore the graph view the user picked last time — validated, so a stale
  // or hand-edited value can never crash the canvas.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`cbi.canvas.view.${repositoryId}`);
      if (raw) {
        const saved = JSON.parse(raw) as { mode?: string; layout?: string };
        const savedMode = coerceCanvasMode(saved.mode);
        setMode(savedMode);
        setLayout(savedMode === 'full' ? 'collapsible' : coerceCanvasLayout(saved.layout));
      }
    } catch {
      // private mode / corrupt JSON — fall back to the defaults
    }
    setRestored(true);
  }, [repositoryId]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(
        `cbi.canvas.view.${repositoryId}`,
        JSON.stringify({ mode, layout }),
      );
    } catch {
      // storage full or unavailable — the view still works for this session
    }
  }, [repositoryId, mode, layout, restored]);

  /**
   * Select + highlight + zoom to a node without replacing the graph.
   * The previous behavior swapped the whole view for a 2-hop neighborhood
   * and highlighted every node in it — nothing stood out, and results that
   * weren't already loaded were dead clicks.
   */
  async function focusNodeById(nodeId: string) {
    let node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      // Search can hit symbols outside the loaded/filtered view — fetch and
      // merge them so the tap always lands somewhere.
      try {
        const detail = await api.node(repositoryId, nodeId);
        node = detail.node;
        const incoming = node;
        setNodes((prev) => (prev.some((n) => n.id === incoming.id) ? prev : [...prev, incoming]));
        setEdges((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const add = [...detail.outgoing, ...detail.incoming].filter((e) => !seen.has(e.id));
          return add.length ? [...prev, ...add] : prev;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    const target = node;
    // The current mode may filter this node type out — widen to full system
    // so the highlight and zoom have something to land on.
    const probe = nodes.some((n) => n.id === target.id) ? nodes : [...nodes, target];
    if (!modeVisibleNodes(probe, edges, mode).some((n) => n.id === target.id)) setMode('full');
    setSelected(target);
    setHighlight([target.id]);
    setFocusNodeId(target.id);
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      const data = await api.search(repositoryId, query.trim());
      setResults(data.results);
      const first = data.results[0];
      if (first) await focusNodeById(first.nodeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Match the node count GraphCanvas actually renders for this mode, so the
  // auto-layout badge never disagrees with the canvas.
  const visibleNodeCount = modeVisibleNodes(nodes, edges, mode).length;
  const activeLayout = mode === 'full' ? 'collapsible' : layout;
  const resolved = resolveLayout(activeLayout, visibleNodeCount, mode);
  const activeViewId =
    GRAPH_VIEWS.find((v) => v.mode === mode && v.layout === activeLayout)?.id ?? null;

  return (
    <div className="canvas-layout no-sidebar" style={{ height: '100%' }}>
      <div className="canvas-center">
        <div className="canvas-toolbar">
          <div className="canvas-toolbar-card">
          <div className="canvas-toolbar-left">
            <form onSubmit={runSearch} className="canvas-search-form">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search symbols, files, endpoints…"
                className="canvas-search-input"
              />
              <Button type="submit" size="sm" className="canvas-search-btn">Search</Button>
            </form>
            <div className="canvas-toolbar-controls">
              <Select
                value={mode}
                onChange={(e) => {
                  const nextMode = e.target.value as CanvasMode;
                  setMode(nextMode);
                  if (nextMode === 'full') setLayout('collapsible');
                }}
                title="View mode"
                className="canvas-select"
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <Select
                value={activeLayout}
                onChange={(e) => setLayout(e.target.value as CanvasLayout)}
                title="Graph layout"
                disabled={mode === 'full'}
                className="canvas-select"
              >
                {LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadFullGraph()}>
                Reset
              </Button>
            </div>
          </div>
          <div className="view-switcher">
            <span className="view-switcher-label">Graph view</span>
            <div className="view-chips">
              {GRAPH_VIEWS.map((v) => (
                <Button
                  key={v.id}
                  type="button"
                  variant="ghost"
                  className={`chip${activeViewId === v.id ? ' active' : ''}`}
                  title={v.hint}
                  aria-pressed={activeViewId === v.id}
                  onClick={() => {
                    setMode(v.mode);
                    setLayout(v.layout);
                  }}
                >
                  {v.label}
                </Button>
              ))}
            </div>
          </div>
          </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div
              className="panel ui-card canvas-search-results"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="card-header">
                <span className="label">Search results</span>
                <Button type="button" className="link-button" variant="link" size="sm" onClick={() => setResults([])}>
                  clear
                </Button>
              </div>
              <ul className="repo-list">
                {results.map((r, i) => (
                  <motion.li
                    key={r.nodeId}
                    style={{ display: 'block' }}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.2 }}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="result-row"
                      onClick={() => void focusNodeById(r.nodeId)}
                    >
                      <span className="result-name">{r.name}</span>
                      <span className="result-meta">
                        {r.nodeType}
                        {r.filePath ? ` · ${r.filePath}` : ''}
                        {r.score ? ` · ${(r.score * 100).toFixed(0)}% match` : ''}
                      </span>
                    </Button>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
        </div>

        {loading ? (
          <div className="panel ui-card" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="skeleton" style={{ width: 220, height: 10, margin: '0 auto 10px' }} />
              <div className="skeleton" style={{ width: 150, height: 10, margin: '0 auto' }} />
              <p className="muted small" style={{ marginTop: 12 }}>Loading graph…</p>
            </div>
          </div>
        ) : visibleNodeCount === 0 ? (
          <div className="panel ui-card" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <div style={{ textAlign: 'center', maxWidth: 380 }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>🧭</div>
              <h3>Nothing in this view</h3>
              <p className="muted small">
                {MODE_HINTS[mode]} — no matching nodes were extracted from this repository. Try
                another view mode, or re-index after pushing the relevant code.
              </p>
            </div>
          </div>
        ) : (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            mode={mode}
            layout={activeLayout}
            selectedNodeId={selected?.id ?? null}
            highlightIds={highlight}
            focusNodeId={focusNodeId}
            onSelect={(node) => {
              if (node) {
                setSelected(node);
                setHighlight([node.id]);
                setFocusNodeId(null); // plain tap highlights without yanking the view
              } else {
                setSelected(null);
                setHighlight([]);
                setFocusNodeId(null);
              }
            }}
          />
        )}

        <div className="canvas-bottom">
          <CanvasLegend />
          <div className="canvas-status">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span title={MODE_HINTS[mode]}>
              {MODES.find((m) => m.value === mode)?.label} · {visibleNodeCount} nodes in view
            </span>
            <span className="muted">
              {counts ? `${counts.nodes} nodes · ${counts.edges} relationships` : ''}
              {truncated ? ' · view truncated' : ''}
            </span>
            {activeLayout === 'auto' && visibleNodeCount > 0 && (
              <span className="auto-badge" title={layoutRationale(resolved, visibleNodeCount, mode)}>
                ✦ Auto → {resolved}
              </span>
            )}
          </div>
          <div>
            {status ? `scope: ${status}` : ''} · graph: {indexStatus}
          </div>
        </div>
        </div>
      </div>

      <NodeDetails
        repositoryId={repositoryId}
        nodeId={selected?.id ?? null}
        onFocusNode={(nodeId) => void focusNodeById(nodeId)}
      />

      <AnimatePresence>
        {error && (
          <motion.div
            className="panel"
            style={{ position: 'absolute', bottom: 12, right: 372, maxWidth: 360, zIndex: 8 }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <p className="error small">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

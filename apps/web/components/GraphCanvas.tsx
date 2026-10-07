'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ApiEdge, ApiNode } from '@/lib/api';

export type CanvasMode =
  | 'full'
  | 'dependencies'
  | 'components'
  | 'api'
  | 'calls'
  | 'pr-impact';

export type CanvasLayout = 'auto' | 'force' | 'radial' | 'cluster' | 'collapsible';

export const LAYOUTS: Array<{
  value: CanvasLayout;
  label: string;
  description: string;
  bestFor: string;
}> = [
  { value: 'auto', label: 'Auto', description: 'Chooses by repository size', bestFor: 'hands-off exploration' },
  { value: 'force', label: 'Force', description: 'Force-directed physics', bestFor: 'exploring any graph' },
  { value: 'radial', label: 'Radial', description: 'Radial tree around the root', bestFor: 'large repositories' },
  { value: 'cluster', label: 'Cluster', description: 'Dendrogram with aligned leaves', bestFor: 'comparing hierarchy levels' },
  { value: 'collapsible', label: 'Hierarchy', description: 'Collapsible hierarchy — click to expand', bestFor: 'reading the containment flow' },
];

/**
 * Layout choice follows the size of the graph — the bigger the project,
 * the more spread-out the layout needs to be. Small graphs read best as a
 * collapsible tree (the clearest containment flow), medium graphs as a
 * cluster dendrogram, and large graphs as a radial tree. Flow modes
 * (API traffic, call graph) are directed graphs rather than hierarchies,
 * so they always resolve to physics — a tree would hide the connections
 * the mode exists to show.
 */
export function resolveLayout(
  layout: CanvasLayout,
  nodeCount: number,
  mode: CanvasMode = 'full',
): Exclude<CanvasLayout, 'auto'> {
  if (layout !== 'auto') return layout;
  if (mode === 'api' || mode === 'calls') return 'force';
  if (nodeCount <= 70) return 'collapsible';
  if (nodeCount <= 150) return 'cluster';
  return 'radial';
}

export function layoutRationale(
  layout: Exclude<CanvasLayout, 'auto'>,
  nodeCount: number,
  mode: CanvasMode = 'full',
): string {
  if (layout === 'force' && (mode === 'api' || mode === 'calls')) {
    return `Force — ${nodeCount} flow nodes read best with physics, not a tree`;
  }
  if (layout === 'collapsible') return `Hierarchy — ${nodeCount} nodes read best as a step-by-step flow`;
  if (layout === 'cluster') return `Cluster — ${nodeCount} nodes, aligned leaves make levels comparable`;
  if (layout === 'radial') return `Radial — ${nodeCount} nodes, a large graph spreads best around the root`;
  return 'Force — free exploration';
}

export const NODE_COLORS: Record<string, string> = {
  repository: '#e5e7eb',
  folder: '#64748b',
  file: '#94a3b8',
  component: '#38bdf8',
  hook: '#a78bfa',
  function: '#34d399',
  service: '#fbbf24',
  class: '#f472b6',
  interface: '#22d3ee',
  type: '#67e8f9',
  enum: '#fdba74',
  constant: '#cbd5e1',
  variable: '#cbd5e1',
  route: '#f97316',
  api_endpoint: '#ef4444',
  store: '#e879f9',
  context: '#c084fc',
  middleware: '#fb7185',
  test: '#84cc16',
  package: '#facc15',
  configuration: '#a3a3a3',
};

export const MODE_NODE_FILTER: Record<CanvasMode, (n: ApiNode) => boolean> = {
  full: (n) => n.nodeType !== 'configuration',
  dependencies: (n) => ['file', 'folder', 'package', 'service', 'repository'].includes(n.nodeType),
  // Keep the containment backbone (repository → folders → files) so tree
  // layouts still have a root, plus everything a component renders into.
  components: (n) =>
    ['component', 'hook', 'context', 'store', 'route', 'middleware', 'file', 'folder', 'repository'].includes(
      n.nodeType,
    ),
  // Flow modes: endpoints of the mode's edges must survive the filter —
  // CALLS lives on constants/components/services, so constants belong here.
  api: (n) =>
    [
      'api_endpoint',
      'route',
      'service',
      'component',
      'hook',
      'function',
      'class',
      'constant',
      'variable',
      'middleware',
      'store',
      'context',
    ].includes(n.nodeType),
  calls: (n) =>
    [
      'function',
      'class',
      'component',
      'hook',
      'service',
      'constant',
      'variable',
      'interface',
      'api_endpoint',
      'middleware',
      'store',
      'context',
    ].includes(n.nodeType),
  'pr-impact': (n) => n.metadata['impact'] === 'DIRECT' || n.metadata['impact'] === 'INDIRECT' || n.nodeType === 'file',
};

const MODE_EDGE_FILTER: Record<CanvasMode, (e: ApiEdge) => boolean> = {
  full: () => true,
  dependencies: (e) => ['IMPORTS', 'DEPENDS_ON', 'CONTAINS', 'EXPORTS'].includes(e.edgeType),
  components: (e) =>
    ['RENDERS', 'USES', 'USES_CONTEXT', 'USES_STORE', 'IMPORTS', 'CONTAINS', 'NAVIGATES_TO'].includes(e.edgeType),
  api: (e) => ['CALLS_API', 'CALLS', 'NAVIGATES_TO', 'IMPLEMENTS', 'USES', 'CONTAINS'].includes(e.edgeType),
  calls: (e) => ['CALLS', 'CALLS_API', 'USES', 'IMPLEMENTS'].includes(e.edgeType),
  'pr-impact': (e) => e.edgeType !== 'CONTAINS',
};

/**
 * Filters are looked up defensively: an unknown mode (a stale saved value, a
 * hand-edited URL) must degrade to "full system", not throw and white-screen
 * the canvas.
 */
function nodeFilterFor(mode: CanvasMode): (n: ApiNode) => boolean {
  return MODE_NODE_FILTER[mode] ?? MODE_NODE_FILTER.full;
}

function edgeFilterFor(mode: CanvasMode): (e: ApiEdge) => boolean {
  return MODE_EDGE_FILTER[mode] ?? MODE_EDGE_FILTER.full;
}

/** Narrow an arbitrary persisted/remote value to a real canvas mode. */
export function coerceCanvasMode(value: string | null | undefined): CanvasMode {
  return value && value in MODE_NODE_FILTER ? (value as CanvasMode) : 'full';
}

/** Narrow an arbitrary persisted/remote value to a real layout. */
export function coerceCanvasLayout(value: string | null | undefined): CanvasLayout {
  return value && LAYOUTS.some((l) => l.value === value) ? (value as CanvasLayout) : 'auto';
}

/**
 * Visible node set for a mode. Flow modes (api/calls) additionally drop
 * nodes that have no surviving mode edge — a sea of isolated dots reads as
 * a broken graph, and the story of these modes *is* the connections.
 */
export function modeVisibleNodes(nodes: ApiNode[], edges: ApiEdge[], mode: CanvasMode): ApiNode[] {
  const visible = nodes.filter(nodeFilterFor(mode));
  if (mode !== 'api' && mode !== 'calls') return visible;
  const edgeFilter = edgeFilterFor(mode);
  const nodeIds = new Set(visible.map((n) => n.id));
  const incident = new Set<string>();
  for (const e of edges) {
    if (!edgeFilter(e)) continue;
    if (nodeIds.has(e.source)) incident.add(e.source);
    if (nodeIds.has(e.target)) incident.add(e.target);
  }
  return visible.filter((n) => incident.has(n.id));
}

/** Hierarchy duplicates: drawing these as curved cross-links adds noise. */
const NO_CROSS_EDGE = new Set(['CONTAINS', 'DEFINED_IN', 'EXPORTS']);
/** Directed relationships get arrowheads on cross-links. */
const DIRECTED_CROSS = new Set(['CALLS', 'CALLS_API', 'NAVIGATES_TO', 'IMPLEMENTS', 'RENDERS', 'USES']);

function shortLabel(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

/**
 * Zoom level below which labels are hidden. Sibling spacing decides when
 * labels can coexist without overlap: cluster leaves get 64px slots, so text
 * (≈114px wide incl. offset) only fits from ~1.8× zoom. Small graphs that fit
 * on screen at readable scale keep their labels at any zoom.
 */
function labelMinScale(layout: Exclude<CanvasLayout, 'auto'>, nodeCount: number): number {
  if (layout === 'collapsible') return 0;
  if (layout === 'cluster') return nodeCount > 40 ? 1.8 : 0.8;
  if (layout === 'radial') return nodeCount > 120 ? 0.9 : 0.6;
  return nodeCount > 90 ? 1.1 : 0; // force
}

/** Datum id across shapes: hierarchy nodes carry .data.id, sim nodes .id. */
function datumId(d: unknown): string {
  const o = d as { id?: string; data?: { id?: string } } | null;
  return o?.data?.id ?? o?.id ?? '';
}

/** Endpoint id of a link whose source/target may be id strings or node objects. */
function linkEndId(x: unknown): string {
  if (typeof x === 'string') return x;
  const o = x as { id?: string; data?: { id?: string } } | null;
  return o?.data?.id ?? o?.id ?? '';
}

function edgeTouches(d: unknown, active: Set<string>): boolean {
  const e = d as { source?: unknown; target?: unknown } | null;
  return active.has(linkEndId(e?.source)) || active.has(linkEndId(e?.target));
}

interface SimNode extends d3.SimulationNodeDatum, ApiNode {
  radius: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  edgeType: string;
  confidence: number;
  source: string | SimNode;
  target: string | SimNode;
}

interface TreeDatum {
  id: string;
  node: ApiNode;
  children?: TreeDatum[];
  hasChildren: boolean;
}

export interface GraphCanvasProps {
  nodes: ApiNode[];
  edges: ApiEdge[];
  mode: CanvasMode;
  layout: CanvasLayout;
  selectedNodeId: string | null;
  highlightIds?: string[];
  focusNodeId?: string | null;
  onSelect: (node: ApiNode | null) => void;
}

function radiusFor(node: ApiNode): number {
  switch (node.nodeType) {
    case 'repository':
      return 16;
    case 'folder':
      return 9;
    case 'file':
      return 7;
    case 'api_endpoint':
    case 'route':
      return 11;
    case 'component':
    case 'service':
    case 'store':
    case 'context':
      return 10;
    default:
      return 6;
  }
}

function edgeColor(edgeType: string): string {
  switch (edgeType) {
    case 'CALLS_API':
      return '#ef4444';
    case 'RENDERS':
      return '#38bdf8';
    case 'CALLS':
      return '#34d399';
    case 'IMPORTS':
      return '#475569';
    default:
      return '#334155';
  }
}

/**
 * Derives a containment tree from the graph. Tree layouts are honest about
 * structure: they follow CONTAINS edges (repository → folders → files →
 * symbols). When no containment exists in the current view the caller falls
 * back to the force layout.
 */
function buildContainmentTree(
  nodes: ApiNode[],
  edges: ApiEdge[],
  collapsed: Set<string>,
): TreeDatum | null {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edgeType !== 'CONTAINS') continue;
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    const list = childrenOf.get(e.source) ?? [];
    list.push(e.target);
    childrenOf.set(e.source, list);
  }
  if (childrenOf.size === 0) return null;

  const childIds = new Set<string>();
  for (const list of childrenOf.values()) for (const id of list) childIds.add(id);

  const rootId =
    nodes.find((n) => n.nodeType === 'repository')?.id ??
    nodes.find((n) => !childIds.has(n.id))?.id ??
    nodes[0]?.id;
  if (!rootId) return null;

  const seen = new Set<string>();
  function build(id: string): TreeDatum | null {
    const node = nodeById.get(id);
    if (!node || seen.has(id)) return null;
    seen.add(id);
    const kids = collapsed.has(id)
      ? undefined
      : ((childrenOf.get(id) ?? []).map(build).filter(Boolean) as TreeDatum[]);
    return { id, node, children: kids, hasChildren: (childrenOf.get(id) ?? []).length > 0 };
  }
  const root = build(rootId);
  // A tree needs at least one level of hierarchy to be worth drawing.
  if (!root || seen.size < 2) return null;
  return root;
}

export function GraphCanvas({
  nodes,
  edges,
  mode,
  layout,
  selectedNodeId,
  highlightIds,
  focusNodeId,
  onSelect,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const isForceRef = useRef(false);
  const lastFocusRef = useRef<string | null>(null);
  const focusTimerRef = useRef<number | undefined>(undefined);
  const hadActiveRef = useRef(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const visibleNodes = modeVisibleNodes(nodes, edges, mode);
    const ids = new Set(visibleNodes.map((n) => n.id));
    const edgeFilter = edgeFilterFor(mode);
    const visibleEdges = edges.filter((e) => edgeFilter(e) && ids.has(e.source) && ids.has(e.target));
    return { visibleNodes, visibleEdges, ids };
  }, [nodes, edges, mode]);

  const highlightSet = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);
  const selectedSet = useMemo(() => new Set(selectedNodeId ? [selectedNodeId] : []), [selectedNodeId]);

  const resolvedLayout = resolveLayout(layout, filtered.visibleNodes.length, mode);

  // Collapse state belongs to a specific dataset — reset when the graph is replaced.
  useEffect(() => {
    setCollapsed(new Set());
  }, [nodes]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = svgEl.clientWidth || 900;
    const height = svgEl.clientHeight || 620;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const root = svg.append('g').attr('class', 'canvas-root');

    const defs = svg.append('defs');
    defs
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#475569');

    // Soft glow for highlighted nodes (chat → canvas integration).
    const glow = defs.append('filter').attr('id', 'glow').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    glow.append('feGaussianBlur').attr('stdDeviation', 3.5).attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const simNodes: SimNode[] = filtered.visibleNodes.map((n) => ({
      ...n,
      radius: radiusFor(n),
    })) as SimNode[];
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = filtered.visibleEdges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        id: e.id,
        edgeType: e.edgeType,
        confidence: e.confidence,
        source: e.source,
        target: e.target,
      }));

    const showLabels = filtered.visibleNodes.length <= 220;
    // Zoom threshold below which labels are hidden: at fit-to-view scale the
    // text is a sub-pixel smudge anyway, and zooming in reveals it only once
    // node spacing outgrows the label width (no overlapping text, ever).
    const minLabelScale = labelMinScale(resolvedLayout, filtered.visibleNodes.length);

    // ------------------------------------------------------------------ trees
    const treeRoot =
      resolvedLayout === 'force' ? null : buildContainmentTree(filtered.visibleNodes, edges, collapsed);
    if (treeRoot) {
      {

        // Tree layouts mutate the hierarchy in place, adding x/y — so the
        // HierarchyNode returned by d3.hierarchy() is a HierarchyPointNode in
        // practice; the cast keeps descendants()/links() typed precisely.
        const hroot = d3.hierarchy<TreeDatum>(treeRoot, (d) => d.children) as d3.HierarchyPointNode<TreeDatum>;
        const descendants = hroot.descendants();
        const links = hroot.links();

        let groupTransform = '';
        let nodeTransform: (d: d3.HierarchyPointNode<TreeDatum>) => string;
        let labelTransform: (d: d3.HierarchyPointNode<TreeDatum>) => string;
        let linkPath: (d: d3.HierarchyLink<TreeDatum>) => string;

        if (resolvedLayout === 'radial') {
          const radius = Math.min(width, height) / 2 - 110;
          d3
            .tree<TreeDatum>()
            .size([2 * Math.PI, Math.max(radius, 120)])
            .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(a.depth, 1))(hroot);
          groupTransform = `translate(${width / 2},${height / 2})`;
          nodeTransform = (d) => {
            const angle = (d.x ?? 0) - Math.PI / 2;
            const r = d.y ?? 0;
            return `translate(${Math.cos(angle) * r},${Math.sin(angle) * r})`;
          };
          const flip = (d: d3.HierarchyPointNode<TreeDatum>) => (d.x ?? 0) >= Math.PI;
          labelTransform = (d) => {
            const deg = ((d.x ?? 0) * 180) / Math.PI - 90;
            return `rotate(${flip(d) ? deg + 180 : deg})`;
          };
          const radialLink = d3
            .linkRadial<d3.HierarchyPointLink<TreeDatum>, d3.HierarchyPointNode<TreeDatum>>()
            .angle((d) => d.x ?? 0)
            .radius((d) => d.y ?? 0);
          linkPath = (d) => radialLink(d as d3.HierarchyPointLink<TreeDatum>) ?? '';
        } else if (resolvedLayout === 'cluster') {
          // Leaf spacing must outgrow the label width — labels render at
          // scale ≥1, so 64px slots keep 18-char names from colliding.
          d3.tree<TreeDatum>().nodeSize([64, 104])(hroot);
          {
            const xs = descendants.map((d) => d.x ?? 0);
            const midX = ((d3.min(xs) ?? 0) + (d3.max(xs) ?? 0)) / 2;
            groupTransform = `translate(${width / 2 - midX}, 70)`;
          }
          nodeTransform = (d) => `translate(${d.x ?? 0},${d.y ?? 0})`;
          labelTransform = () => '';
          const verticalLink = d3
            .linkVertical<d3.HierarchyPointLink<TreeDatum>, d3.HierarchyPointNode<TreeDatum>>()
            .x((d) => d.x ?? 0)
            .y((d) => d.y ?? 0);
          linkPath = (d) => verticalLink(d as d3.HierarchyPointLink<TreeDatum>) ?? '';
        } else {
          // collapsible — horizontal, root on the left
          d3.tree<TreeDatum>().nodeSize([26, 190])(hroot);
          const xs = descendants.map((d) => d.x ?? 0);
          const minX = d3.min(xs) ?? 0;
          const maxX = d3.max(xs) ?? 0;
          const offsetY = height / 2 - (minX + maxX) / 2;
          groupTransform = `translate(90,${offsetY})`;
          nodeTransform = (d) => `translate(${d.y ?? 0},${d.x ?? 0})`;
          labelTransform = () => '';
          const horizontalLink = d3
            .linkHorizontal<d3.HierarchyPointLink<TreeDatum>, d3.HierarchyPointNode<TreeDatum>>()
            .x((d) => d.y ?? 0)
            .y((d) => d.x ?? 0);
          linkPath = (d) => horizontalLink(d as d3.HierarchyPointLink<TreeDatum>) ?? '';
        }

        const treeLayer = root.append('g').attr('transform', groupTransform);

        // Screen-space offset of the layer: node transforms are layer-local,
        // but zoom/focus maths runs on root coordinates.
        const gOff = /translate\(\s*(-?[\d.]+)\D+(-?[\d.]+)\s*\)/.exec(groupTransform);
        const gox = gOff ? parseFloat(gOff[1]!) : 0;
        const goy = gOff ? parseFloat(gOff[2]!) : 0;

        // Radial depth rings — spatial reference so large graphs feel navigable.
        if (resolvedLayout === 'radial') {
          const depths = Array.from(new Set(descendants.map((d) => d.depth)));
          treeLayer
            .append('g')
            .attr('class', 'depth-rings')
            .selectAll<SVGCircleElement, number>('circle')
            .data(depths.filter((d) => d > 0))
            .join('circle')
            .attr('r', (d) => (hroot.descendants().find((n) => n.depth === d)?.y ?? 0) + 60)
            .attr('fill', 'none')
            .attr('stroke', 'rgba(10, 132, 255, 0.1)')
            .attr('stroke-dasharray', '2 6')
            .attr('opacity', 0)
            .transition()
            .duration(800)
            .attr('opacity', 1);
        }

        const linkSel = treeLayer
          .append('g')
          .attr('class', 'links')
          .selectAll<SVGPathElement, d3.HierarchyPointLink<TreeDatum>>('path')
          .data(links)
          .join('path')
          .attr('fill', 'none')
          .attr('stroke', (d) => edgeColor(edgeTypeBetween(d.target.data.id, d.source.data.id, edges)))
          .attr('stroke-opacity', 0)
          .attr('stroke-width', (d) => (edgeTypeBetween(d.target.data.id, d.source.data.id, edges) === 'CONTAINS' ? 1.2 : 1.6))
          .attr('d', linkPath);

        // Draw-in animation: each link traces itself from parent to child.
        linkSel.each(function () {
          const len = (this as SVGPathElement).getTotalLength();
          d3.select(this)
            .attr('stroke-dasharray', `${len} ${len}`)
            .attr('stroke-dashoffset', len);
        });
        linkSel
          .transition()
          .duration(600)
          .delay((d) => d.target.depth * 60)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0)
          .attr('stroke-opacity', 0.55)
          .on('end', function () {
            d3.select(this).attr('stroke-dasharray', null);
          });

        // Cross-links: the mode's real story (CALLS, RENDERS, CALLS_API…)
        // drawn as curves between final positions. Without these, switching
        // to "API flow" inside a tree layout showed no API edges at all.
        const treePos = new Map<string, { x: number; y: number }>();
        descendants.forEach((d) => {
          const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(nodeTransform(d));
          if (m) treePos.set(d.data.id, { x: parseFloat(m[1]!), y: parseFloat(m[2]!) });
        });
        const crossEdges = filtered.visibleEdges.filter(
          (e) => !NO_CROSS_EDGE.has(e.edgeType) && treePos.has(e.source) && treePos.has(e.target),
        );
        const crossSel = treeLayer
          .append('g')
          .attr('class', 'cross-links')
          .selectAll<SVGPathElement, ApiEdge>('path')
          .data(crossEdges)
          .join('path')
          .attr('fill', 'none')
          .attr('stroke', (d) => edgeColor(d.edgeType))
          .attr('stroke-width', (d) => (d.edgeType === 'CALLS_API' ? 1.6 : 1.1))
          .attr('stroke-opacity', 0)
          .attr('marker-end', (d) => (DIRECTED_CROSS.has(d.edgeType) ? 'url(#arrow)' : null))
          .attr('d', (d) => {
            const s = treePos.get(d.source)!;
            const t = treePos.get(d.target)!;
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const len = Math.hypot(dx, dy) || 1;
            const bow = Math.min(64, len * 0.2);
            const mx = (s.x + t.x) / 2 - (dy / len) * bow;
            const my = (s.y + t.y) / 2 + (dx / len) * bow;
            return `M${s.x},${s.y}Q${mx},${my} ${t.x},${t.y}`;
          });
        crossSel
          .transition()
          .duration(420)
          .delay(640)
          .attr('stroke-opacity', 0.45);

        const parentPos = (d: d3.HierarchyPointNode<TreeDatum>): string =>
          d.parent ? nodeTransform(d.parent) : nodeTransform(d);

        const nodeSel = treeLayer
          .append('g')
          .attr('class', 'nodes')
          .selectAll<SVGGElement, d3.HierarchyPointNode<TreeDatum>>('g')
          .data(descendants)
          .join('g')
          .attr('class', 'node')
          .classed('selected', (d) => selectedSet.has(d.data.id))
          .classed('highlighted', (d) => highlightSet.has(d.data.id))
          .classed('expandable', (d) => resolvedLayout === 'collapsible' && d.data.hasChildren)
          .style('cursor', 'pointer')
          .attr('transform', parentPos)
          .attr('opacity', 0)
          .on('click', (_event, d) => {
            if (resolvedLayout === 'collapsible' && d.data.hasChildren) {
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(d.data.id)) next.delete(d.data.id);
                else next.add(d.data.id);
                return next;
              });
            }
            onSelect(d.data.node);
          });

        nodeSel
          .append('circle')
          .attr('r', (d) => radiusFor(d.data.node))
          .attr('fill', (d) => NODE_COLORS[d.data.node.nodeType] ?? '#94a3b8')
          .attr('stroke', (d) =>
            selectedSet.has(d.data.id) ? '#f8fafc' : highlightSet.has(d.data.id) ? '#facc15' : 'rgba(15,23,42,0.9)',
          )
          .attr('stroke-width', (d) => (selectedSet.has(d.data.id) ? 3 : highlightSet.has(d.data.id) ? 2.5 : 1))
          .attr('filter', (d) => (highlightSet.has(d.data.id) ? 'url(#glow)' : null));

        // dashed ring marks collapsible nodes with hidden children
        nodeSel
          .filter((d) => resolvedLayout === 'collapsible' && d.data.hasChildren && collapsed.has(d.data.id))
          .append('circle')
          .attr('r', (d) => radiusFor(d.data.node) + 4)
          .attr('fill', 'none')
          .attr('stroke', '#facc15')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3 3')
          .attr('opacity', 0.8);

        if (showLabels) {
          const labels = nodeSel
            .append('text')
            .text((d) => shortLabel(d.data.node.name))
            .attr('font-size', 10)
            .attr('fill', '#cbd5e1')
            .attr('pointer-events', 'none');
          if (resolvedLayout === 'radial') {
            // Dense radial rings can't fit every label — keep the structure
            // readable and let hover/selection/title carry the rest.
            if (descendants.length > 120) {
              labels.classed('deep-label', (d) => d.depth > 2);
            }
            labels
              .attr('transform', labelTransform)
              .attr('text-anchor', (d) => ((d.x ?? 0) < Math.PI ? 'start' : 'end'))
              .attr('dy', '0.32em')
              .attr('x', (d) => ((d.x ?? 0) < Math.PI ? 1 : -1) * (radiusFor(d.data.node) + 5));
          } else {
            labels.attr('x', (d) => radiusFor(d.data.node) + 5).attr('y', 3);
          }
        }
        nodeSel.append('title').text((d) => {
          const hint =
            resolvedLayout === 'collapsible' && d.data.hasChildren
              ? collapsed.has(d.data.id)
                ? '\nClick to expand'
                : '\nClick to collapse'
              : '';
          return `${d.data.node.name} (${d.data.node.nodeType})\n${d.data.node.filePath ?? ''}${hint}`;
        });

        // Grow-in animation: every node eases out from its parent's position.
        nodeSel
          .transition()
          .duration(560)
          .delay((d) => d.depth * 50)
          .ease(d3.easeCubicOut)
          .attr('transform', nodeTransform)
          .attr('opacity', 1);

        // Record final screen positions in root space (for focus/zoom) —
        // node transforms are layer-local, so the layer offset is added.
        descendants.forEach((d) => {
          const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(nodeTransform(d));
          if (m) {
            positionsRef.current.set(d.data.id, {
              x: parseFloat(m[1]!) + gox,
              y: parseFloat(m[2]!) + goy,
            });
          }
        });
      }
    } else {
      renderForce();
    }

    function renderForce() {
      // Physics render — used for force layout and as the fallback for views
      // with no containment hierarchy. Full feature parity with the tree:
      // arrows, highlight glow, drag, labels and focus positions.
      isForceRef.current = true;
      const link = root
        .append('g')
        .attr('class', 'links')
        .selectAll<SVGLineElement, SimLink>('line')
        .data(simLinks)
        .join('line')
        .attr('stroke', (d) => edgeColor(d.edgeType))
        .attr('stroke-opacity', (d) => (highlightSet.size > 0 ? 0.15 : Math.max(0.25, d.confidence * 0.7)))
        .attr('stroke-width', (d) => (d.edgeType === 'CALLS_API' ? 2 : 1))
        .attr('marker-end', 'url(#arrow)');

      const nodeGroup = root
        .append('g')
        .attr('class', 'nodes')
        .selectAll<SVGGElement, SimNode>('g')
        .data(simNodes)
        .join('g')
        .attr('class', 'node')
        .classed('selected', (d) => selectedSet.has(d.id))
        .classed('highlighted', (d) => highlightSet.has(d.id))
        .style('cursor', 'pointer')
        .on('click', (_event, d) => onSelect(d as ApiNode));

      nodeGroup
        .append('circle')
        .attr('r', (d) => d.radius)
        .attr('fill', (d) => NODE_COLORS[d.nodeType] ?? '#94a3b8')
        .attr('stroke', (d) =>
          selectedSet.has(d.id) ? '#f8fafc' : highlightSet.has(d.id) ? '#facc15' : 'rgba(15,23,42,0.9)',
        )
        .attr('stroke-width', (d) => (selectedSet.has(d.id) ? 3 : highlightSet.has(d.id) ? 2.5 : 1))
        .attr('filter', (d) => (highlightSet.has(d.id) || selectedSet.has(d.id) ? 'url(#glow)' : null));

      if (showLabels) {
        nodeGroup
          .append('text')
          .text((d) => shortLabel(d.name))
          .attr('x', (d) => d.radius + 4)
          .attr('y', 3)
          .attr('font-size', 10)
          .attr('fill', '#cbd5e1')
          .attr('pointer-events', 'none');
      }
      nodeGroup.append('title').text((d) => `${d.name} (${d.nodeType})\n${d.filePath ?? ''}`);

      const simulation = d3
        .forceSimulation<SimNode>(simNodes)
        .force(
          'link',
          d3
            .forceLink<SimNode, SimLink>(simLinks)
            .id((d) => d.id)
            .distance((d) => (d.edgeType === 'CONTAINS' ? 40 : 90))
            .strength(0.35),
        )
        .force('charge', d3.forceManyBody().strength(-220))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide<SimNode>().radius((d) => d.radius + 4))
        .force('x', d3.forceX(width / 2).strength(0.04))
        .force('y', d3.forceY(height / 2).strength(0.04));

      simulationRef.current = simulation;

      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as SimNode).x ?? 0)
          .attr('y1', (d) => (d.source as SimNode).y ?? 0)
          .attr('x2', (d) => (d.target as SimNode).x ?? 0)
          .attr('y2', (d) => (d.target as SimNode).y ?? 0);
        nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        for (const n of simNodes) positionsRef.current.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      });

      const drag = d3
        .drag<SVGGElement, SimNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });
      nodeGroup.call(drag);
    }

    // Force simulations are still running when the render finishes — wait for
    // them to settle before framing, but also give a late-arriving settle a
    // way to frame without waiting on another render cycle.
    isForceRef.current = resolvedLayout === 'force' || !treeRoot;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.04, 6])
      .on('start', () => {
        // Stop the physics before a user pans/zooms — dragging a live sim
        // fights back and makes the graph feel sticky and noisy.
        simulationRef.current?.alphaTarget(0);
      })
      .on('zoom', (event) => {
        root.attr('transform', event.transform.toString());
        root.classed('labels-hidden', event.transform.k < minLabelScale);
      });
    zoomRef.current = zoom;
    svg.call(zoom);
    svg.on('dblclick.zoom', null);    // Frame the whole graph on first load so the user sees the shape
    // immediately — no zoomed-in subset. Force layouts also get re-fitted
    // once the simulation settles, otherwise a drag can leave the graph
    // indefinitely framed off-center.
    const fitForBounds = (left: number, top: number, w: number, h: number) => {
      if (w < 1 || h < 1 || !zoomRef.current) return;
      const pad = 48;
      const scale = Math.min(
        (width - pad * 2) / w,
        (height - pad * 2) / h,
        1.2,
      );
      if (scale < 0.3 || scale > 5) return;
      const fit = d3.zoomIdentity
        .translate(
          width / 2 - scale * (left + w / 2),
          height / 2 - scale * (top + h / 2),
        )
        .scale(scale);
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const svg = d3.select(svgEl);
      root.classed('labels-hidden', scale < minLabelScale);
      svg.transition().duration(450).call(zoom.transform, fit);
    };

    if (!isForceRef.current) {
      // Tree layouts are deterministic at render time — fit straight away.
      try {
        const bbox = (root.node() as SVGGElement).getBBox();
        if (bbox.width > 1 && bbox.height > 1) {
          const pad = 48;
          const scale = Math.min(
            (width - pad * 2) / bbox.width,
            (height - pad * 2) / bbox.height,
            1.4,
          );
          root.classed('labels-hidden', scale < minLabelScale);
          const fit = d3.zoomIdentity
            .translate(
              width / 2 - scale * (bbox.x + bbox.width / 2),
              height / 2 - scale * (bbox.y + bbox.height / 2),
            )
            .scale(scale);
          // Delay past the grow-in animation so the bounds are final.
          svg.transition().duration(400).delay(620).call(zoom.transform, fit);
        }
      } catch {
        // getBBox can throw on a detached node; fitting is best-effort.
      }
    } else {
      // Force simulations settle over several ticks — either re-fit when
      // they calm down, or wait a beat and fit whatever positions exist.
      const sim = simulationRef.current;
      if (!sim) return;

      let settled = false;
      const fitOnce = () => {
        if (settled) return;
        settled = true;
        fitForBounds(
          d3.min(simNodes, (n) => n.x ?? 0) ?? 0,
          d3.min(simNodes, (n) => n.y ?? 0) ?? 0,
          (d3.max(simNodes, (n) => n.x ?? 0) ?? 0) - (d3.min(simNodes, (n) => n.x ?? 0) ?? 0),
          (d3.max(simNodes, (n) => n.y ?? 0) ?? 0) - (d3.min(simNodes, (n) => n.y ?? 0) ?? 0),
        );
      };
      sim.on('end', fitOnce);
      const timer = window.setTimeout(fitOnce, 2400);
      return () => {
        sim.on('end', null);
        window.clearTimeout(timer);
      };
    }

    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.visibleNodes, filtered.visibleEdges, resolvedLayout, collapsed]);

  // View state — selection, highlight and focus are applied to the render
  // that already exists. Rebuilding the whole graph on every tap would replay
  // the draw-in animation and steal the user's pan/zoom.
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const visibleIds = filtered.ids;

    const active = new Set<string>();
    for (const id of highlightIds ?? []) if (visibleIds.has(id)) active.add(id);
    const selectedId = selectedNodeId && visibleIds.has(selectedNodeId) ? selectedNodeId : null;
    svg.classed('has-highlight', active.size > 0);

    svg
      .selectAll<SVGGElement, unknown>('.node')
      .classed('selected', (d) => datumId(d) === selectedId)
      .classed('highlighted', (d) => active.has(datumId(d)))
      .select<SVGCircleElement>('circle')
      .attr('stroke', (d) => {
        const id = datumId(d);
        return id === selectedId ? '#f8fafc' : active.has(id) ? '#facc15' : 'rgba(15,23,42,0.9)';
      })
      .attr('stroke-width', (d) => (datumId(d) === selectedId ? 3 : active.has(datumId(d)) ? 2.5 : 1))
      .attr('filter', (d) => (active.has(datumId(d)) || datumId(d) === selectedId ? 'url(#glow)' : null));

    // Dim everything the highlight doesn't touch so the marked nodes pop.
    const wasActive = hadActiveRef.current;
    if (active.size > 0 || wasActive) {
      svg
        .selectAll<SVGLineElement, unknown>('.links line')
        .interrupt()
        .attr('stroke-opacity', (d) => {
          if (active.size === 0) {
            const conf = (d as { confidence?: number }).confidence ?? 0.5;
            return Math.max(0.25, conf * 0.7);
          }
          return edgeTouches(d, active) ? 0.9 : 0.08;
        });
      svg
        .selectAll<SVGPathElement, unknown>('.links path')
        .interrupt()
        .attr('stroke-dasharray', null)
        .attr('stroke-opacity', (d) => (active.size === 0 ? 0.55 : edgeTouches(d, active) ? 0.8 : 0.1));
      svg
        .selectAll<SVGPathElement, unknown>('.cross-links path')
        .interrupt()
        .attr('stroke-opacity', (d) => (active.size === 0 ? 0.45 : edgeTouches(d, active) ? 0.9 : 0.07));
      hadActiveRef.current = active.size > 0;
    }

    // Zoom to a searched/chat-highlighted node — once per focus target.
    if (focusNodeId && focusNodeId !== lastFocusRef.current && visibleIds.has(focusNodeId)) {
      lastFocusRef.current = focusNodeId;
      const apply = () => {
        const target = positionsRef.current.get(focusNodeId);
        const zoom = zoomRef.current;
        if (!target || !zoom) return;
        const w = svgEl.clientWidth || 900;
        const h = svgEl.clientHeight || 620;
        const t = d3.zoomIdentity
          .translate(w / 2, h / 2)
          .scale(2)
          .translate(-target.x, -target.y);
        svg.interrupt();
        svg.transition().duration(550).call(zoom.transform, t);
      };
      window.clearTimeout(focusTimerRef.current);
      if (isForceRef.current) {
        // Physics is still moving nodes — aim after it calms down.
        focusTimerRef.current = window.setTimeout(apply, 600);
      } else {
        apply();
      }
    }
    if (!focusNodeId) {
      lastFocusRef.current = null;
      window.clearTimeout(focusTimerRef.current);
    }

    return () => window.clearTimeout(focusTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, highlightIds, focusNodeId, filtered]);

  return (
    <svg
      ref={svgRef}
      className="graph-canvas"
      role="img"
      aria-label="Codebase graph"
      onClick={(e) => {
        if (e.target === svgRef.current) onSelect(null);
      }}
    />
  );
}

/** Best-effort edge type between two nodes in the raw edge list, for tree link colouring. */
function edgeTypeBetween(source: string, target: string, edges: ApiEdge[]): string {
  const found = edges.find((e) => e.source === source && e.target === target);
  return found?.edgeType ?? 'CONTAINS';
}

export function CanvasLegend() {
  const entries = ['repository', 'folder', 'file', 'component', 'hook', 'function', 'service', 'route', 'api_endpoint', 'store', 'test'];
  return (
    <div className="legend">
      {entries.map((type) => (
        <span key={type} className="legend-item">
          <span className="legend-dot" style={{ background: NODE_COLORS[type] }} />
          {type}
        </span>
      ))}
    </div>
  );
}

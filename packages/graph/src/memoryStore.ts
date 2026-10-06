import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { GraphEdge, GraphNode } from '@cbi/shared';
import {
  bfsNeighborhood,
  DEFAULT_TRAVERSAL_LIMITS,
  type GraphCounts,
  type GraphStore,
  type NodeFilter,
  type PathResult,
  type Subgraph,
  type TraversalLimits,
} from './model.js';

export interface InMemoryGraphStoreOptions {
  /**
   * When set, the whole graph is snapshotted to this file (debounced) and
   * reloaded on construction, so an API restart does not empty the canvas.
   */
  persistPath?: string;
}

export class InMemoryGraphStore implements GraphStore {
  readonly kind = 'memory' as const;

  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private outIndex = new Map<string, Set<string>>();
  private inIndex = new Map<string, Set<string>>();
  private persistPath: string | null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: InMemoryGraphStoreOptions = {}) {
    this.persistPath = options.persistPath ?? null;
    this.loadSnapshot();
  }

  private loadSnapshot(): void {
    if (!this.persistPath) return;
    for (const candidate of [this.persistPath, `${this.persistPath}.bak`]) {
      if (!existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          nodes?: GraphNode[];
          edges?: GraphEdge[];
        };
        for (const n of parsed.nodes ?? []) this.nodes.set(n.id, n);
        for (const e of parsed.edges ?? []) {
          this.edges.set(e.id, e);
          addTo(this.outIndex, e.sourceNodeId, e.id);
          addTo(this.inIndex, e.targetNodeId, e.id);
        }
        return;
      } catch {
        // Corrupt snapshot — try the backup, then start empty. A bad snapshot
        // must never prevent startup; it is rewritten on the next mutation.
        this.nodes.clear();
        this.edges.clear();
        this.outIndex.clear();
        this.inIndex.clear();
      }
    }
  }

  private schedulePersist(): void {
    if (!this.persistPath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 800);
    this.persistTimer.unref?.();
  }

  /** Flush the current graph to disk now (also used on shutdown). */
  persist(): void {
    if (!this.persistPath) return;
    try {
      const file = resolve(this.persistPath);
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // Unique tmp per process/write: two API processes can briefly overlap
      // during a `tsx watch` reload, and a shared tmp path corrupts the file.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify({ nodes: [...this.nodes.values()], edges: [...this.edges.values()] }));
      if (existsSync(file)) renameSync(file, `${file}.bak`);
      renameSync(tmp, file);
    } catch {
      // Persistence is best-effort; the live graph stays authoritative.
    }
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persist();
  }

  async upsertNodes(nodes: GraphNode[]): Promise<void> {
    for (const n of nodes) this.nodes.set(n.id, n);
    this.schedulePersist();
  }

  async upsertEdges(edges: GraphEdge[]): Promise<void> {
    for (const e of edges) {
      this.edges.set(e.id, e);
      addTo(this.outIndex, e.sourceNodeId, e.id);
      addTo(this.inIndex, e.targetNodeId, e.id);
    }
    this.schedulePersist();
  }

  async deleteNodes(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.nodes.delete(id);
      for (const eid of this.outIndex.get(id) ?? []) this.removeEdge(eid);
      for (const eid of this.inIndex.get(id) ?? []) this.removeEdge(eid);
      this.outIndex.delete(id);
      this.inIndex.delete(id);
    }
    this.schedulePersist();
  }

  async deleteEdges(ids: string[]): Promise<void> {
    for (const id of ids) this.removeEdge(id);
    this.schedulePersist();
  }

  async clearRepository(repositoryId: string): Promise<void> {
    const nodeIds = [...this.nodes.values()].filter((n) => n.repositoryId === repositoryId).map((n) => n.id);
    await this.deleteNodes(nodeIds);
    for (const e of [...this.edges.values()]) {
      if (e.repositoryId === repositoryId) this.removeEdge(e.id);
    }
    this.schedulePersist();
  }

  async getNode(id: string): Promise<GraphNode | null> {
    return this.nodes.get(id) ?? null;
  }

  async getNodes(ids: string[]): Promise<GraphNode[]> {
    return ids.map((id) => this.nodes.get(id)).filter((n): n is GraphNode => Boolean(n));
  }

  async getNodesByRepository(repositoryId: string, filter?: NodeFilter): Promise<GraphNode[]> {
    let out = [...this.nodes.values()].filter((n) => n.repositoryId === repositoryId);
    return applyFilter(out, filter);
  }

  async getEdgesByRepository(repositoryId: string, filter?: NodeFilter): Promise<GraphEdge[]> {
    let out = [...this.edges.values()].filter((e) => e.repositoryId === repositoryId);
    if (filter?.edgeTypes) out = out.filter((e) => filter.edgeTypes!.includes(e.edgeType));
    if (filter?.limit) out = out.slice(0, filter.limit);
    return out;
  }

  async getEdgesFrom(nodeId: string): Promise<GraphEdge[]> {
    return [...(this.outIndex.get(nodeId) ?? [])].map((id) => this.edges.get(id)).filter((e): e is GraphEdge => Boolean(e));
  }

  async getEdgesTo(nodeId: string): Promise<GraphEdge[]> {
    return [...(this.inIndex.get(nodeId) ?? [])].map((id) => this.edges.get(id)).filter((e): e is GraphEdge => Boolean(e));
  }

  async count(repositoryId: string): Promise<GraphCounts> {
    let nodes = 0;
    for (const n of this.nodes.values()) if (n.repositoryId === repositoryId) nodes++;
    let edges = 0;
    for (const e of this.edges.values()) if (e.repositoryId === repositoryId) edges++;
    return { nodes, edges };
  }

  async neighborhood(nodeId: string, limits: Partial<TraversalLimits> = {}): Promise<Subgraph> {
    const merged: TraversalLimits = { ...DEFAULT_TRAVERSAL_LIMITS, ...limits };
    return bfsNeighborhood(
      nodeId,
      merged,
      (id) => this.nodes.get(id),
      (id, dir) => (dir === 'out' ? [...(this.outIndex.get(id) ?? [])].map((e) => this.edges.get(e)!) : [...(this.inIndex.get(id) ?? [])].map((e) => this.edges.get(e)!)),
    );
  }

  async findPath(fromId: string, toId: string, maxDepth = 6): Promise<PathResult> {
    if (fromId === toId) {
      const n = this.nodes.get(fromId);
      return { found: Boolean(n), nodes: n ? [n] : [], edges: [], length: 0 };
    }
    const prev = new Map<string, { nodeId: string; edge: GraphEdge }>();
    const visited = new Set<string>([fromId]);
    let frontier = [fromId];
    let depth = 0;
    let found = false;
    while (frontier.length && depth < maxDepth && !found) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of await this.getEdgesFrom(id)) {
          const other = e.targetNodeId;
          if (visited.has(other)) continue;
          visited.add(other);
          prev.set(other, { nodeId: id, edge: e });
          if (other === toId) {
            found = true;
            break;
          }
          next.push(other);
        }
        if (found) break;
      }
      frontier = next;
      depth++;
    }
    if (!found) return { found: false, nodes: [], edges: [], length: 0 };

    const pathEdges: GraphEdge[] = [];
    const pathNodes: GraphNode[] = [];
    let cursor = toId;
    while (cursor !== fromId) {
      const step = prev.get(cursor);
      if (!step) break;
      pathEdges.unshift(step.edge);
      pathNodes.unshift(this.nodes.get(cursor)!);
      cursor = step.nodeId;
    }
    pathNodes.unshift(this.nodes.get(fromId)!);
    return { found: true, nodes: pathNodes, edges: pathEdges, length: pathEdges.length };
  }

  async reachable(anchorIds: string[], limits: Partial<TraversalLimits> = {}): Promise<Map<string, number>> {
    const merged: TraversalLimits = { ...DEFAULT_TRAVERSAL_LIMITS, depth: 4, maxNodes: 500, ...limits };
    const distances = new Map<string, number>();
    let frontier = [...anchorIds];
    for (const a of anchorIds) distances.set(a, 0);
    let depth = 0;
    while (frontier.length && depth < merged.depth && distances.size < merged.maxNodes) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of await this.getEdgesFrom(id)) {
          if (merged.edgeTypes && !merged.edgeTypes.includes(e.edgeType)) continue;
          const other = e.targetNodeId;
          if (distances.has(other)) continue;
          distances.set(other, depth + 1);
          next.push(other);
          if (distances.size >= merged.maxNodes) break;
        }
      }
      frontier = next;
      depth++;
    }
    return distances;
  }

  private removeEdge(id: string): void {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    this.outIndex.get(e.sourceNodeId)?.delete(id);
    this.inIndex.get(e.targetNodeId)?.delete(id);
  }
}

function addTo(index: Map<string, Set<string>>, key: string, value: string): void {
  const set = index.get(key);
  if (set) set.add(value);
  else index.set(key, new Set([value]));
}

function applyFilter(nodes: GraphNode[], filter?: NodeFilter): GraphNode[] {
  let out = nodes;
  if (filter?.nodeTypes) out = out.filter((n) => filter.nodeTypes!.includes(n.nodeType));
  if (filter?.filePrefix) out = out.filter((n) => n.filePath?.startsWith(filter.filePrefix!) ?? false);
  if (filter?.nameQuery) {
    const q = filter.nameQuery.toLowerCase();
    out = out.filter((n) => n.name.toLowerCase().includes(q) || n.qualifiedName.toLowerCase().includes(q));
  }
  if (filter?.limit) out = out.slice(0, filter.limit);
  return out;
}

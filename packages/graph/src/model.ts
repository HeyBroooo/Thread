import type { EdgeType, GraphEdge, GraphNode, NodeType } from '@cbi/shared';

export interface GraphCounts {
  nodes: number;
  edges: number;
}

export interface NodeFilter {
  nodeTypes?: NodeType[];
  edgeTypes?: EdgeType[];
  filePrefix?: string;
  nameQuery?: string;
  limit?: number;
}

/** Bounded traversal parameters (doc §87). Never traverse unbounded. */
export interface TraversalLimits {
  depth: number;
  maxNodes: number;
  edgeTypes?: EdgeType[];
  direction?: 'out' | 'in' | 'both';
}

export const DEFAULT_TRAVERSAL_LIMITS: TraversalLimits = {
  depth: 3,
  maxNodes: 100,
  direction: 'out',
};

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface PathResult {
  found: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  length: number;
}

/**
 * The graph store abstraction. PostgreSQL is the source of truth (doc §18);
 * the in-memory implementation exists so the platform runs locally without
 * external services and so tests are fast and deterministic.
 */
export interface GraphStore {
  readonly kind: 'memory' | 'postgres';
  init(): Promise<void>;
  close(): Promise<void>;

  upsertNodes(nodes: GraphNode[]): Promise<void>;
  upsertEdges(edges: GraphEdge[]): Promise<void>;
  deleteNodes(ids: string[]): Promise<void>;
  deleteEdges(ids: string[]): Promise<void>;
  /** Remove all graph data for a repository (used by full rebuild). */
  clearRepository(repositoryId: string): Promise<void>;

  getNode(id: string): Promise<GraphNode | null>;
  getNodes(ids: string[]): Promise<GraphNode[]>;
  getNodesByRepository(repositoryId: string, filter?: NodeFilter): Promise<GraphNode[]>;
  getEdgesByRepository(repositoryId: string, filter?: NodeFilter): Promise<GraphEdge[]>;
  getEdgesFrom(nodeId: string): Promise<GraphEdge[]>;
  getEdgesTo(nodeId: string): Promise<GraphEdge[]>;
  count(repositoryId: string): Promise<GraphCounts>;

  /** Bounded BFS around a node (doc §55). */
  neighborhood(nodeId: string, limits?: Partial<TraversalLimits>): Promise<Subgraph>;
  /** Shortest path between two nodes, bounded. */
  findPath(fromId: string, toId: string, maxDepth?: number): Promise<PathResult>;
  /** All nodes reachable from anchors, with distance (used for PR impact). */
  reachable(anchorIds: string[], limits?: Partial<TraversalLimits>): Promise<Map<string, number>>;
}

/** BFS over an adjacency list with node/depth ceilings. Shared by stores. */
export function bfsNeighborhood(
  startId: string,
  limits: TraversalLimits,
  nodeOf: (id: string) => GraphNode | undefined,
  edgesOf: (id: string, direction: 'out' | 'in') => GraphEdge[],
): Subgraph {
  const edgeTypes = limits.edgeTypes ? new Set(limits.edgeTypes) : null;
  const direction = limits.direction ?? 'out';
  const visited = new Set<string>([startId]);
  const edges = new Map<string, GraphEdge>();
  let frontier = [startId];
  let depth = 0;
  let truncated = false;

  while (frontier.length > 0 && depth < limits.depth) {
    const next: string[] = [];
    for (const id of frontier) {
      const outgoing = direction !== 'in' ? edgesOf(id, 'out') : [];
      const incoming = direction !== 'out' ? edgesOf(id, 'in') : [];
      for (const edge of [...outgoing, ...incoming]) {
        if (edgeTypes && !edgeTypes.has(edge.edgeType)) continue;
        const other = edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;
        edges.set(edge.id, edge);
        if (visited.has(other)) continue;
        if (visited.size >= limits.maxNodes) {
          truncated = true;
          continue;
        }
        visited.add(other);
        next.push(other);
      }
    }
    frontier = next;
    depth++;
  }

  const nodes: GraphNode[] = [];
  for (const id of visited) {
    const n = nodeOf(id);
    if (n) nodes.push(n);
  }
  return { nodes, edges: [...edges.values()], truncated };
}

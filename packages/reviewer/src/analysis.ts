import type { EdgeType, GraphEdge, GraphNode, ImpactNode } from '@cbi/shared';
import type { GraphStore } from '@cbi/graph';
import { loadGraphView } from '@cbi/graph';
import type { ParsedDiff } from './diff.js';

export interface ChangedSymbolResult {
  changedFiles: string[];
  /** Symbols whose line range intersects the changed lines. */
  changedNodes: GraphNode[];
  /** Files present in the graph that changed (used as fallback anchors). */
  changedFileNodes: GraphNode[];
  /** Files that changed but are not in the indexed graph (e.g. brand new). */
  unindexedFiles: string[];
  /** file path -> changed symbol nodes */
  byFile: Map<string, GraphNode[]>;
}

export async function mapChangedSymbols(
  store: GraphStore,
  repositoryId: string,
  parsed: ParsedDiff,
): Promise<ChangedSymbolResult> {
  const nodes = await store.getNodesByRepository(repositoryId, { limit: 500_000 });
  const byFile = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.filePath) continue;
    const list = byFile.get(node.filePath);
    if (list) list.push(node);
    else byFile.set(node.filePath, [node]);
  }

  const changedNodes: GraphNode[] = [];
  const changedFileNodes: GraphNode[] = [];
  const unindexedFiles: string[] = [];
  const nodeById = new Map<string, GraphNode>();
  const resultByFile = new Map<string, GraphNode[]>();

  for (const file of parsed.changedFiles) {
    const fileNodes = byFile.get(file);
    if (!fileNodes || fileNodes.length === 0) {
      unindexedFiles.push(file);
      continue;
    }
    const touched = parsed.touchedLineSet.get(file) ?? new Set<number>();
    const added = parsed.addedLineSet.get(file) ?? new Set<number>();
    const fileNode = fileNodes.find((n) => n.nodeType === 'file');
    const symbols = fileNodes.filter((n) => n.nodeType !== 'file');

    const fileChanged: GraphNode[] = [];
    for (const node of symbols) {
      const start = node.startLine ?? 1;
      const end = node.endLine ?? start;
      let intersects = false;
      for (const line of touched) {
        if (line >= start && line <= end) {
          intersects = true;
          break;
        }
      }
      // A pure addition of a brand-new symbol also intersects via added lines.
      if (!intersects) {
        for (const line of added) {
          if (line >= start && line <= end) {
            intersects = true;
            break;
          }
        }
      }
      if (intersects) {
        fileChanged.push(node);
        if (!nodeById.has(node.id)) {
          nodeById.set(node.id, node);
          changedNodes.push(node);
        }
      }
    }

    if (fileChanged.length === 0 && fileNode) {
      fileChanged.push(fileNode);
      if (!nodeById.has(fileNode.id)) {
        nodeById.set(fileNode.id, fileNode);
        changedFileNodes.push(fileNode);
      }
    }
    resultByFile.set(file, fileChanged);
  }

  return {
    changedFiles: parsed.changedFiles,
    changedNodes,
    changedFileNodes,
    unindexedFiles,
    byFile: resultByFile,
  };
}

export interface ImpactAnalysis {
  /** anchor node id -> distance (0 = changed) */
  distances: Map<string, number>;
  nodes: ImpactNode[];
  direct: ImpactNode[];
  indirect: ImpactNode[];
  truncated: boolean;
}

/**
 * Bidirectional impact traversal (doc §36): callers, callees, dependencies and
 * dependents. Distance 1 is DIRECT, distance >= 2 is INDIRECT.
 */
export async function computeImpact(
  store: GraphStore,
  anchorIds: string[],
  options: { depth?: number; maxNodes?: number; edgeTypes?: EdgeType[] } = {},
): Promise<ImpactAnalysis> {
  const depth = options.depth ?? 3;
  const maxNodes = options.maxNodes ?? 300;
  const edgeTypes = options.edgeTypes ? new Set(options.edgeTypes) : null;

  const distances = new Map<string, number>();
  const nodesById = new Map<string, GraphNode>();
  for (const id of anchorIds) distances.set(id, 0);
  let frontier = [...anchorIds];
  let currentDepth = 0;
  let truncated = false;

  while (frontier.length > 0 && currentDepth < depth) {
    const next: string[] = [];
    for (const id of frontier) {
      const [out, incoming] = await Promise.all([store.getEdgesFrom(id), store.getEdgesTo(id)]);
      for (const edge of [...out, ...incoming]) {
        if (edgeTypes && !edgeTypes.has(edge.edgeType)) continue;
        const other = edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;
        if (distances.has(other)) continue;
        if (distances.size >= maxNodes) {
          truncated = true;
          continue;
        }
        distances.set(other, currentDepth + 1);
        next.push(other);
      }
    }
    frontier = next;
    currentDepth++;
  }

  const ids = [...distances.keys()];
  for (const node of await store.getNodes(ids)) nodesById.set(node.id, node);

  const impactNodes: ImpactNode[] = [];
  for (const [id, distance] of distances) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.nodeType === 'folder' || node.nodeType === 'repository') continue;
    impactNodes.push({
      nodeId: node.id,
      name: node.name,
      nodeType: node.nodeType,
      filePath: node.filePath,
      impact: distance === 0 ? 'DIRECT' : distance === 1 ? 'DIRECT' : 'INDIRECT',
      distance,
    });
  }

  return {
    distances,
    nodes: impactNodes,
    direct: impactNodes.filter((n) => n.impact === 'DIRECT'),
    indirect: impactNodes.filter((n) => n.impact === 'INDIRECT'),
    truncated,
  };
}

export interface SymbolRelationshipBundle {
  node: GraphNode;
  relationships: GraphEdge[];
}

/** Collect the relationships touching changed symbols, for AI context. */
export async function collectSymbolRelationships(
  store: GraphStore,
  nodes: GraphNode[],
  perNode = 25,
): Promise<SymbolRelationshipBundle[]> {
  const out: SymbolRelationshipBundle[] = [];
  for (const node of nodes.slice(0, 40)) {
    const [edgesOut, edgesIn] = await Promise.all([store.getEdgesFrom(node.id), store.getEdgesTo(node.id)]);
    out.push({ node, relationships: [...edgesOut, ...edgesIn].slice(0, perNode) });
  }
  return out;
}

export async function loadRepositoryGraph(store: GraphStore, repositoryId: string) {
  return loadGraphView(store, repositoryId);
}

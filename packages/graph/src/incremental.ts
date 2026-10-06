import type { GraphEdge, GraphNode } from '@cbi/shared';

export interface IncrementalPlan {
  /** Nodes that must be removed because their file changed or was deleted. */
  removeNodeIds: string[];
  /** Edges that must be removed because their source file changed or an endpoint was removed. */
  removeEdgeIds: string[];
}

/**
 * Compute the removals needed before applying a re-parse of `changedFiles`.
 *
 * Nodes are file-scoped by `filePath`; edges are scoped by `sourceFile` and by
 * whether either endpoint is being removed. Only nodes/edges owned by the
 * changed files are touched, so unaffected parts of the graph are preserved
 * (doc §22).
 */
export function planIncrementalUpdate(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  changedFiles: string[],
): IncrementalPlan {
  const changed = new Set(changedFiles.map((f) => f.replace(/\\/g, '/')));
  const removeNodeIds: string[] = [];
  const removedNodeSet = new Set<string>();

  for (const node of graph.nodes) {
    if (node.filePath && changed.has(node.filePath)) {
      removeNodeIds.push(node.id);
      removedNodeSet.add(node.id);
    }
  }

  const removeEdgeIds: string[] = [];
  for (const edge of graph.edges) {
    if (removedNodeSet.has(edge.sourceNodeId) || removedNodeSet.has(edge.targetNodeId)) {
      removeEdgeIds.push(edge.id);
      continue;
    }
    if (edge.sourceFile && changed.has(edge.sourceFile)) {
      removeEdgeIds.push(edge.id);
    }
  }

  return { removeNodeIds, removeEdgeIds };
}

/**
 * Select the part of a freshly built graph that must replace the affected
 * region of an existing graph.
 *
 * This includes nodes owned by the changed files *and* every edge that touches
 * one of those nodes — even when the edge's own source file did not change
 * (e.g. folder CONTAINS edges, or an unchanged caller of a changed symbol).
 * Missing those edges is the classic incremental-indexing bug.
 */
export function selectReplacementSet(
  nodes: GraphNode[],
  edges: GraphEdge[],
  changedFiles: string[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const changed = new Set(changedFiles.map((f) => f.replace(/\\/g, '/')));
  const changedNodeIds = new Set<string>();
  const changedNodes: GraphNode[] = [];
  for (const node of nodes) {
    if (node.filePath && changed.has(node.filePath)) {
      changedNodeIds.add(node.id);
      changedNodes.push(node);
    }
  }
  const changedEdges = edges.filter(
    (e) =>
      (e.sourceFile && changed.has(e.sourceFile)) ||
      changedNodeIds.has(e.sourceNodeId) ||
      changedNodeIds.has(e.targetNodeId),
  );
  return { nodes: changedNodes, edges: changedEdges };
}

/**
 * Edges pointing at nodes that no longer exist after a partial update. These
 * are repaired by re-resolving impacted symbols (doc §22), but we surface them
 * so the caller can decide.
 */
export function staleEdges(after: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphEdge[] {
  const ids = new Set(after.nodes.map((n) => n.id));
  return after.edges.filter((e) => !ids.has(e.sourceNodeId) || !ids.has(e.targetNodeId));
}

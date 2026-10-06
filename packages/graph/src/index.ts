import { createLogger } from '@cbi/shared';
import { hasDatabase } from '@cbi/db';
import type { GraphEdge, GraphNode } from '@cbi/shared';
import { InMemoryGraphStore } from './memoryStore.js';
import { PgGraphStore } from './pgStore.js';
import type { GraphStore } from './model.js';
import { planIncrementalUpdate } from './incremental.js';
import type { BuiltGraph } from './builder.js';

export * from './model.js';
export * from './memoryStore.js';
export * from './pgStore.js';
export * from './builder.js';
export * from './validation.js';
export * from './incremental.js';

const log = createLogger({ component: 'graph' });

let singleton: GraphStore | null = null;

/** Pick PostgreSQL when configured, otherwise an in-memory store. */
export function createGraphStore(force?: 'memory' | 'postgres'): GraphStore {
  if (force === 'memory') return new InMemoryGraphStore();
  if (force === 'postgres') return new PgGraphStore();
  return hasDatabase() ? new PgGraphStore() : new InMemoryGraphStore();
}

export function getGraphStore(): GraphStore {
  if (!singleton) singleton = createGraphStore();
  return singleton;
}

export function setGraphStore(store: GraphStore): void {
  singleton = store;
}

export interface ApplyOptions {
  /** Full rebuild: clear the repository graph first. */
  replace?: boolean;
  /** Incremental: files being updated; their old nodes/edges are removed first. */
  changedFiles?: string[];
}

/** Persist a freshly built graph into a store, replacing or patching as requested. */
export async function applyBuiltGraph(
  store: GraphStore,
  repositoryId: string,
  built: BuiltGraph,
  options: ApplyOptions = {},
): Promise<{ nodes: number; edges: number; removedNodes: number; removedEdges: number }> {
  let removedNodes = 0;
  let removedEdges = 0;

  if (options.replace) {
    await store.clearRepository(repositoryId);
  } else if (options.changedFiles && options.changedFiles.length > 0) {
    const previous = {
      nodes: await store.getNodesByRepository(repositoryId),
      edges: await store.getEdgesByRepository(repositoryId),
    };
    const plan = planIncrementalUpdate(previous, options.changedFiles);
    if (plan.removeEdgeIds.length) await store.deleteEdges(plan.removeEdgeIds);
    if (plan.removeNodeIds.length) await store.deleteNodes(plan.removeNodeIds);
    removedNodes = plan.removeNodeIds.length;
    removedEdges = plan.removeEdgeIds.length;
  }

  await store.upsertNodes(built.nodes);
  await store.upsertEdges(built.edges);
  log.info('graph.applied', {
    repositoryId,
    nodes: built.nodes.length,
    edges: built.edges.length,
    removedNodes,
    removedEdges,
    replace: options.replace ?? false,
  });
  return { nodes: built.nodes.length, edges: built.edges.length, removedNodes, removedEdges };
}

export async function loadGraphView(
  store: GraphStore,
  repositoryId: string,
): Promise<{ repositoryId: string; nodes: GraphNode[]; edges: GraphEdge[] }> {
  const [nodes, edges] = await Promise.all([
    store.getNodesByRepository(repositoryId),
    store.getEdgesByRepository(repositoryId),
  ]);
  return { repositoryId, nodes, edges };
}

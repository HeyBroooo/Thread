import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { GraphEdge, GraphNode } from '@cbi/shared';
import { InMemoryGraphStore, type GraphStore } from '@cbi/graph';

export interface GraphSnapshot {
  version: 1;
  repositoryId: string;
  commitSha: string | null;
  createdAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function snapshotPath(repositoryId: string): string {
  return resolve(process.cwd(), '.cbi', `graph-${repositoryId}.json`);
}

export function saveSnapshot(snapshot: GraphSnapshot, path = snapshotPath(snapshot.repositoryId)): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot), 'utf8');
}

export function loadSnapshot(repositoryId: string, path = snapshotPath(repositoryId)): GraphSnapshot | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GraphSnapshot;
  } catch {
    return null;
  }
}

export async function storeFromSnapshot(snapshot: GraphSnapshot): Promise<GraphStore> {
  const store = new InMemoryGraphStore();
  await store.init();
  await store.upsertNodes(snapshot.nodes);
  await store.upsertEdges(snapshot.edges);
  return store;
}

export async function exportStore(store: GraphStore, repositoryId: string, commitSha: string | null): Promise<GraphSnapshot> {
  const [nodes, edges] = await Promise.all([
    store.getNodesByRepository(repositoryId),
    store.getEdgesByRepository(repositoryId),
  ]);
  return { version: 1, repositoryId, commitSha, createdAt: new Date().toISOString(), nodes, edges };
}

export function isGitCheckout(path: string): boolean {
  return existsSync(join(path, '.git'));
}

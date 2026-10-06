import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeRepository, type AnalyzedRepository } from '@cbi/parser';
import { InMemoryGraphStore, buildGraph, type BuiltGraph } from '@cbi/graph';
import type { GraphEdge, GraphNode } from '@cbi/shared';

export const FIXTURE_ROOT = resolve(__dirname, 'fixtures', 'react-app');

export interface FixtureAnalysis {
  analyzed: AnalyzedRepository;
  built: BuiltGraph;
  store: InMemoryGraphStore;
  repositoryId: string;
}

export function analyzeFixture(root = FIXTURE_ROOT): AnalyzedRepository {
  return analyzeRepository(root);
}

export async function indexFixture(root = FIXTURE_ROOT, repositoryId = 'test-repo'): Promise<FixtureAnalysis> {
  const analyzed = analyzeRepository(root);
  const built = buildGraph(repositoryId, analyzed);
  const store = new InMemoryGraphStore();
  await store.init();
  await store.upsertNodes(built.nodes);
  await store.upsertEdges(built.edges);
  return { analyzed, built, store, repositoryId };
}

export function nodeByName(built: BuiltGraph, name: string): GraphNode | undefined {
  return built.nodes.find((n) => n.name === name);
}

export function nodesByName(built: BuiltGraph, name: string): GraphNode[] {
  return built.nodes.filter((n) => n.name === name);
}

export function nodeByType(built: BuiltGraph, type: string, name: string): GraphNode | undefined {
  return built.nodes.find((n) => n.nodeType === type && n.name === name);
}

export function edgesBetween(
  built: BuiltGraph,
  sourceName: string,
  edgeType: string,
  targetName: string,
): GraphEdge[] {
  const idsByName = new Map<string, Set<string>>();
  for (const n of built.nodes) {
    const set = idsByName.get(n.name) ?? new Set<string>();
    set.add(n.id);
    idsByName.set(n.name, set);
  }
  const sources = idsByName.get(sourceName) ?? new Set();
  const targets = idsByName.get(targetName) ?? new Set();
  return built.edges.filter(
    (e) => e.edgeType === edgeType && sources.has(e.sourceNodeId) && targets.has(e.targetNodeId),
  );
}

export function hasEdge(built: BuiltGraph, sourceName: string, edgeType: string, targetName: string): boolean {
  return edgesBetween(built, sourceName, edgeType, targetName).length > 0;
}

/** Copy the fixture repository to a temp dir so a test can mutate it. */
export function cloneFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cbi-fixture-'));
  cpSync(FIXTURE_ROOT, dir, { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

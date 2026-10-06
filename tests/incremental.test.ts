import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGraph, planIncrementalUpdate, selectReplacementSet } from '@cbi/graph';
import { analyzeFixture, cloneFixture } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const REPO = 'incremental-repo';

function ids(items: Array<{ id: string }>): string[] {
  return items.map((i) => i.id).sort();
}

/**
 * The core correctness requirement (doc §22.2): the incremental graph for
 * A -> B must equal a clean full index of B for the affected graph state.
 */
describe('incremental indexing', () => {
  it('equals a full rebuild when a file is added and a function is appended', () => {
    const { dir, cleanup } = cloneFixture();
    cleanups.push(cleanup);

    const analyzedA = analyzeFixture(dir);
    const builtA = buildGraph(REPO, analyzedA);

    const changedFiles = ['src/services/patientService.ts', 'src/components/patient/DischargeNote.tsx'];

    appendFileSync(
      join(dir, 'src/services/patientService.ts'),
      '\nexport function summarizePatient(name: string): string {\n  return name.trim().toLowerCase();\n}\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'src/components/patient/DischargeNote.tsx'),
      "import { cn } from '@/lib/utils';\n\nexport function DischargeNote() {\n  return <p className={cn('note')}>Discharged</p>;\n}\n",
      'utf8',
    );

    const builtB = buildGraph(REPO, analyzeFixture(dir));

    // ---- incremental merge ----
    const plan = planIncrementalUpdate({ nodes: builtA.nodes, edges: builtA.edges }, changedFiles);
    const removedNodes = new Set(plan.removeNodeIds);
    const removedEdges = new Set(plan.removeEdgeIds);

    const { nodes: newNodes, edges: newEdges } = selectReplacementSet(builtB.nodes, builtB.edges, changedFiles);

    const mergedNodes = [...builtA.nodes.filter((n) => !removedNodes.has(n.id)), ...newNodes];
    const mergedEdges = [...builtA.edges.filter((e) => !removedEdges.has(e.id)), ...newEdges];

    expect(ids(mergedNodes)).toEqual(ids(builtB.nodes));
    expect(ids(mergedEdges)).toEqual(ids(builtB.edges));
  });

  it('removes a deleted file and everything it owned', () => {
    const { dir, cleanup } = cloneFixture();
    cleanups.push(cleanup);

    const builtA = buildGraph(REPO, analyzeFixture(dir));
    const deleted = 'src/api/patient.ts';
    rmSync(join(dir, deleted));

    const builtB = buildGraph(REPO, analyzeFixture(dir));
    const plan = planIncrementalUpdate({ nodes: builtA.nodes, edges: builtA.edges }, [deleted]);

    // Everything owned by the deleted file is removed.
    for (const nodeId of plan.removeNodeIds) {
      const node = builtA.nodes.find((n) => n.id === nodeId);
      expect(node?.filePath).toBe(deleted);
    }
    expect(plan.removeNodeIds.length).toBeGreaterThan(0);

    // Every node the full rebuild no longer has for that file is removed too.
    const removedIds = new Set(plan.removeNodeIds);
    const staleKept = builtA.nodes.filter(
      (n) => n.filePath === deleted && !removedIds.has(n.id),
    );
    expect(staleKept).toHaveLength(0);
    expect(builtB.nodes.some((n) => n.filePath === deleted)).toBe(false);
  });

  it('only touches nodes owned by the changed files', () => {
    const { dir, cleanup } = cloneFixture();
    cleanups.push(cleanup);
    const builtA = buildGraph(REPO, analyzeFixture(dir));

    const plan = planIncrementalUpdate({ nodes: builtA.nodes, edges: builtA.edges }, ['src/lib/utils.ts']);
    const affectedFiles = new Set(
      plan.removeNodeIds.map((id) => builtA.nodes.find((n) => n.id === id)?.filePath).filter(Boolean),
    );
    expect([...affectedFiles]).toEqual(['src/lib/utils.ts']);
  });
});

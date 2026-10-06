import { describe, expect, it } from 'vitest';
import { validateGraph } from '@cbi/graph';
import { hasEdge, indexFixture, nodeByName, nodeByType } from './helpers.js';

describe('graph golden tests', () => {
  it('builds the patient discharge chain with evidence', async () => {
    const { built } = await indexFixture();

    // Rendering tree
    expect(hasEdge(built, 'PatientDetails', 'RENDERS', 'PatientActions')).toBe(true);
    expect(hasEdge(built, 'PatientActions', 'RENDERS', 'DischargeButton')).toBe(true);

    // Call chain into the service layer and the API
    expect(hasEdge(built, 'DischargeButton', 'CALLS', 'dischargePatient')).toBe(true);
    expect(hasEdge(built, 'dischargePatient', 'CALLS', 'patientApi')).toBe(true);
    expect(hasEdge(built, 'patientApi', 'CALLS', 'apiClient')).toBe(true);
    const endpoint = built.nodes.find((n) => n.nodeType === 'api_endpoint' && n.metadata['method'] === 'POST');
    expect(endpoint).toBeDefined();
    expect(endpoint!.metadata['path']).toContain('/patient/{id}/discharge');
    expect(hasEdge(built, 'patientApi', 'CALLS_API', endpoint!.name)).toBe(true);

    // Hook usage
    expect(hasEdge(built, 'PatientDetails', 'USES', 'usePatient')).toBe(true);
  });

  it('connects frontend call sites to the server route handler (full-stack graph)', async () => {
    const { built } = await indexFixture();
    const endpoint = built.nodes.find((n) => n.nodeType === 'api_endpoint' && n.metadata['method'] === 'POST');
    expect(endpoint).toBeDefined();
    // The client call site and the server route handler are linked into one node.
    expect(endpoint!.metadata['kind']).toBe('both');
    expect(endpoint!.metadata['path']).toBe('/api/patient/{id}/discharge');
    expect(endpoint!.metadata['clientPath']).toBe('/patient/{id}/discharge');

    // The Next.js route handler implements the same endpoint.
    expect(hasEdge(built, 'POST', 'IMPLEMENTS', endpoint!.name)).toBe(true);
  });

  it('creates a route node that renders the page component', async () => {
    const { built } = await indexFixture();
    const route = nodeByType(built, 'route', '/patients/{id}');
    expect(route).toBeDefined();
    expect(route!.metadata['kind']).toBe('nextjs-app');
    expect(route!.metadata['dynamic']).toBe(true);
    expect(hasEdge(built, '/patients/{id}', 'RENDERS', 'PatientPage')).toBe(true);
  });

  it('links tests to the code they cover', async () => {
    const { built } = await indexFixture();
    expect(hasEdge(built, 'DischargeButton.test.tsx', 'TESTS', 'DischargeButton')).toBe(true);
  });

  it('records source evidence on every relationship', async () => {
    const { built } = await indexFixture();
    const callEdges = built.edges.filter((e) => e.edgeType === 'CALLS');
    expect(callEdges.length).toBeGreaterThan(0);
    for (const edge of callEdges) {
      expect(edge.evidence.length).toBeGreaterThan(0);
      expect(edge.sourceFile).toBeTruthy();
      expect(edge.sourceLine).toBeGreaterThan(0);
      expect(edge.confidence).toBeGreaterThan(0);
    }
  });

  it('passes graph validation with no errors', async () => {
    const { built, repositoryId } = await indexFixture();
    const report = validateGraph({ repositoryId, nodes: built.nodes, edges: built.edges });
    expect(report.errors).toBe(0);
    expect(report.status).toBe('passed');
  });

  it('detects project conventions from real examples', async () => {
    const { built } = await indexFixture();
    const names = built.analysis.conventions.map((c) => c.name);
    expect(names).toContain('shared-classname-utility');
    expect(names).toContain('zustand-stores');
    const cn = built.analysis.conventions.find((c) => c.name === 'shared-classname-utility')!;
    expect(cn.examples[0]?.filePath).toBeTruthy();
    expect(cn.examples[0]?.snippet).toContain('cn(');
  });

  it('builds a deterministic architecture summary', async () => {
    const { built } = await indexFixture();
    expect(built.analysis.architecture.frontend).toEqual(expect.arrayContaining(['React', 'Next.js']));
    expect(built.analysis.architecture.state).toEqual(expect.arrayContaining(['zustand']));
    expect(built.analysis.architecture.routing).toBe('Next.js App Router');
    expect(built.analysis.architecture.api).toContain('REST');
  });

  it('produces stable node ids across repeated builds', async () => {
    const a = await indexFixture();
    const b = await indexFixture();
    const idsA = a.built.nodes.map((n) => n.id).sort();
    const idsB = b.built.nodes.map((n) => n.id).sort();
    expect(idsA).toEqual(idsB);
  });

  it('does not fabricate a relationship for an unresolved module', async () => {
    const { built } = await indexFixture();
    // `react` is a package import; there must be no IMPORTS edge to a made-up node.
    const fake = nodeByName(built, 'react');
    expect(fake).toBeUndefined();
  });
});

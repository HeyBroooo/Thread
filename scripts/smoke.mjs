/**
 * End-to-end smoke test against a running API server.
 *
 *   npm run dev:api            # in one shell
 *   node scripts/smoke.mjs     # in another
 *
 * Exercises: repository connect -> index job -> graph -> search -> node detail -> chat.
 */
import { resolve } from 'node:path';

const BASE = process.env.SMOKE_API_URL ?? 'http://localhost:8787';
const checkoutPath = resolve('tests/fixtures/react-app');

const results = [];
function record(name, ok, info = '') {
  results.push({ name, ok, info });
  process.stdout.write(`${ok ? '  ✓' : '  ✗'} ${name}${info ? `  — ${info}` : ''}\n`);
}

async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function main() {
  process.stdout.write(`\nCodebase Intelligence smoke test → ${BASE}\n\n`);

  const health = await call('/health');
  record('GET /health', health.status === 200, JSON.stringify(health.json));

  const created = await call('/api/repositories', {
    method: 'POST',
    body: JSON.stringify({ owner: 'fixture', name: 'react-app', branch: 'main', checkoutPath }),
  });
  record('POST /api/repositories', created.status === 201, created.json?.repository?.id);
  const repoId = created.json?.repository?.id;
  if (!repoId) throw new Error('No repository id returned.');

  const start = await call(`/api/repositories/${repoId}/index`, { method: 'POST', body: JSON.stringify({}) });
  record('POST /api/repositories/:id/index', start.status === 202, start.json?.job?.id);

  let status = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const poll = await call(`/api/repositories/${repoId}/index`);
    status = poll.json;
    if (status?.job?.status === 'COMPLETED' || status?.job?.status === 'FAILED') break;
  }
  const job = status?.job;
  record('indexing completes', job?.status === 'COMPLETED', `${job?.status} · ${job?.nodesCreated ?? 0} nodes`);
  if (job?.status !== 'COMPLETED') {
    process.stdout.write(`\nJob error: ${job?.error}\n`);
  }

  const graph = await call(`/api/repositories/${repoId}/graph?scope=overview&limit=300`);
  record(
    'GET /graph (overview)',
    graph.status === 200 && graph.json?.nodes?.length > 0,
    `${graph.json?.nodes?.length ?? 0} nodes in overview, ${graph.json?.counts?.edges ?? 0} total edges`,
  );

  const search = await call(`/api/repositories/${repoId}/search`, {
    method: 'POST',
    body: JSON.stringify({ query: 'patient discharge', limit: 8 }),
  });
  const hits = search.json?.results ?? [];
  record('POST /search', search.status === 200 && hits.length > 0, hits.slice(0, 3).map((h) => h.name).join(', '));

  const endpointHit = hits.find((h) => h.nodeType === 'api_endpoint');
  if (endpointHit) {
    const detail = await call(`/api/repositories/${repoId}/nodes/${endpointHit.nodeId}`);
    record('GET /nodes/:id (endpoint)', detail.status === 200 && Boolean(detail.json?.node), detail.json?.node?.name);
  } else {
    record('GET /nodes/:id (endpoint)', false, 'no api_endpoint in search results');
  }

  const anchor = hits[0];
  if (anchor) {
    const neighborhood = await call(`/api/repositories/${repoId}/nodes/${anchor.nodeId}/neighborhood?depth=2&direction=both`);
    record(
      'GET /nodes/:id/neighborhood',
      neighborhood.status === 200 && neighborhood.json?.nodes?.length > 0,
      `${neighborhood.json?.nodes?.length ?? 0} nodes`,
    );
  }

  const chat = await call(`/api/repositories/${repoId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message: 'What happens when the patient discharge button is clicked?' }),
  });
  const answer = chat.json;
  record(
    'POST /chat (grounded answer)',
    chat.status === 200 && typeof answer?.answer === 'string' && answer.answer.length > 20,
    `${(answer?.references ?? []).length} references, confidence ${answer?.confidence}`,
  );
  if (answer?.answer) {
    process.stdout.write(`\n  Answer: ${answer.answer.slice(0, 300)}\n`);
    for (const ref of answer.references ?? []) {
      process.stdout.write(`    → ${ref.filePath}:${ref.startLine}-${ref.endLine}\n`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n\n`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((e) => {
  process.stderr.write(`\nSmoke test failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

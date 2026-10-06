import { resolve } from 'node:path';
import { InMemoryGraphStore, createGraphStore } from '@cbi/graph';
import { SearchService } from '@cbi/search';
import { CodebaseChat, OpenRouterProvider } from '@cbi/ai';
import { DiskSourceRegistry, createLogger, getConfig, redact } from '@cbi/shared';
import { runIndexingJob } from '@cbi/indexer';
import { runMigrations, hasDatabase } from '@cbi/db';
import { exportStore, loadSnapshot, saveSnapshot, storeFromSnapshot } from './snapshot.js';

const log = createLogger({ component: 'cli' });

interface Flags {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const command = argv[0] ?? 'help';
  const positional: string[] = [];
  const flags: Flags = {};
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

function usage(): string {
  return `
Codebase Intelligence CLI

  cbi index <path> [--repo <id>] [--incremental <sha>] [--changed <a,b>] [--include-generated] [--db]
      Deeply analyze a local checkout and build the evidence-backed codebase graph.
      Defaults to an in-memory graph snapshot in .cbi/ (pass --db to use PostgreSQL).

  cbi graph <path> [--repo <id>] [--db]
      Print the deterministic architecture summary and graph statistics.

  cbi search <path> <query> [--repo <id>] [--mode hybrid|exact|semantic|text] [--limit 10]
      Hybrid search across the graph.

  cbi ask <path> <question> [--repo <id>] [--depth 2]
      Ask a natural-language question grounded in the graph (requires OPENROUTER_API_KEY).

  cbi node <path> <nodeId>
      Show a node with its relationships and source evidence.

  cbi migrate
      Run PostgreSQL migrations.

Environment: see .env.example
`;
}

async function ensureStore(
  root: string,
  repositoryId: string,
  useDatabase = false,
): Promise<{ store: Awaited<ReturnType<typeof createGraphStore>>; commitSha: string | null }> {
  const snapshot = loadSnapshot(repositoryId);
  if (snapshot) {
    const store = await storeFromSnapshot(snapshot);
    process.stderr.write(`Using cached graph snapshot (${snapshot.nodes.length} nodes) from .cbi/graph-${repositoryId}.json\n`);
    return { store, commitSha: snapshot.commitSha };
  }

  if (useDatabase) {
    const store = createGraphStore('postgres');
    await store.init();
    return { store, commitSha: null };
  }

  const store = new InMemoryGraphStore();
  await store.init();
  const result = await runIndexingJob({
    repositoryId,
    root,
    commitSha: 'HEAD',
    store,
    persistToDatabase: false,
    onProgress: (p) => {
      if (process.env.CBI_VERBOSE === '1') process.stderr.write(`  ${p.stage} ${p.progress}%\n`);
    },
  });
  const snapshotOut = await exportStore(store, repositoryId, result.commitSha);
  saveSnapshot(snapshotOut);
  return { store, commitSha: result.commitSha };
}

async function commandIndex(positional: string[], flags: Flags): Promise<void> {
  const path = positional[0];
  if (!path) throw new Error('index requires a <path> argument.');
  const root = resolve(path);
  const repositoryId = (flags['repo'] as string) ?? `local:${root.split(/[\\/]/).pop()}`;

  const wantsDb = Boolean(flags['db']) && hasDatabase();
  const store = wantsDb ? createGraphStore('postgres') : new InMemoryGraphStore();
  await store.init();

  const incremental = Boolean(flags['incremental']);
  const changed = typeof flags['changed'] === 'string' ? flags['changed'].split(',').map((s) => s.trim()).filter(Boolean) : [];

  const result = await runIndexingJob({
    repositoryId,
    root,
    commitSha: (flags['commit'] as string) ?? 'HEAD',
    store,
    incremental,
    changedFiles: changed,
    analyzeOptions: {
      includeGenerated: Boolean(flags['include-generated']),
      ...(flags['include'] ? { include: String(flags['include']).split(',') } : {}),
      ...(flags['exclude'] ? { exclude: String(flags['exclude']).split(',') } : {}),
    },
    persistToDatabase: wantsDb,
    onProgress: (p) => {
      if (process.env.CBI_QUIET === '1') return;
      process.stderr.write(`  [${String(p.progress).padStart(3)}%] ${p.stage}\n`);
    },
  });

  const snapshot = await exportStore(store, repositoryId, result.commitSha);
  saveSnapshot(snapshot);

  process.stdout.write(
    [
      '',
      `Indexed ${root}  (repository ${repositoryId})`,
      `  files parsed:        ${result.filesParsed} (${result.filesSkipped} skipped)`,
      `  nodes:               ${result.nodes}`,
      `  edges:               ${result.edges}`,
      `  unresolved imports:  ${result.unresolvedImports}`,
      `  parse errors:        ${result.parseErrors}`,
      `  validation:          ${result.validation.status} (${result.validation.errors} errors, ${result.validation.warnings} warnings, ${result.validation.orphanNodes} orphan nodes)`,
      `  architecture:        ${result.architecture.frontend.join(' + ') || 'unknown'} · state: ${result.architecture.state.join(', ') || 'none'} · api: ${result.architecture.api.join(', ') || 'none'}`,
      `  routing:             ${result.architecture.routing}`,
      `  conventions:         ${result.conventions.map((c) => c.name).join(', ') || 'none detected'}`,
      result.skippedLanguages.length ? `  skipped languages:   ${result.skippedLanguages.join(', ')}` : '',
      `  duration:            ${result.durationMs}ms`,
      '',
      `Snapshot written to .cbi/graph-${repositoryId}.json`,
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  await store.close();
}

async function commandGraph(positional: string[], flags: Flags): Promise<void> {
  const path = positional[0];
  if (!path) throw new Error('graph requires a <path> argument.');
  const root = resolve(path);
  const repositoryId = (flags['repo'] as string) ?? `local:${root.split(/[\\/]/).pop()}`;
  const { store } = await ensureStore(root, repositoryId, Boolean(flags['db']));
  const nodes = await store.getNodesByRepository(repositoryId);
  const edges = await store.getEdgesByRepository(repositoryId);

  const byType = new Map<string, number>();
  for (const n of nodes) byType.set(n.nodeType, (byType.get(n.nodeType) ?? 0) + 1);
  const edgeByType = new Map<string, number>();
  for (const e of edges) edgeByType.set(e.edgeType, (edgeByType.get(e.edgeType) ?? 0) + 1);

  process.stdout.write(
    [
      '',
      `Graph for ${repositoryId}`,
      `  nodes: ${nodes.length}  edges: ${edges.length}`,
      '',
      '  nodes by type:',
      ...[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `    ${t.padEnd(16)} ${c}`),
      '',
      '  edges by type:',
      ...[...edgeByType.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `    ${t.padEnd(16)} ${c}`),
      '',
    ].join('\n'),
  );
  await store.close();
}

async function commandSearch(positional: string[], flags: Flags): Promise<void> {
  const [path, ...queryParts] = positional;
  const query = queryParts.join(' ');
  if (!path || !query) throw new Error('search requires <path> and a <query>.');
  const root = resolve(path);
  const repositoryId = (flags['repo'] as string) ?? `local:${root.split(/[\\/]/).pop()}`;
  const { store } = await ensureStore(root, repositoryId, Boolean(flags['db']));
  const search = new SearchService(store);
  const results = await search.search(repositoryId, query, {
    mode: (flags['mode'] as 'hybrid' | 'exact' | 'semantic' | 'text') ?? 'hybrid',
    limit: Number(flags['limit'] ?? 10),
  });
  process.stdout.write(
    ['', `Search results for "${query}":`, ...results.map((r) => `  ${r.score.toFixed(3)}  ${r.nodeType.padEnd(12)} ${r.name}  ${r.filePath ?? ''}${r.startLine ? `:${r.startLine}` : ''}`), ''].join('\n'),
  );
  await store.close();
}

async function commandAsk(positional: string[], flags: Flags): Promise<void> {
  const [path, ...questionParts] = positional;
  const question = questionParts.join(' ');
  if (!path || !question) throw new Error('ask requires <path> and a <question>.');
  const root = resolve(path);
  const repositoryId = (flags['repo'] as string) ?? `local:${root.split(/[\\/]/).pop()}`;
  const config = getConfig();
  if (!config.ai.apiKey) {
    process.stderr.write('OPENROUTER_API_KEY is not set. Add it to .env to use chat.\n');
    process.exitCode = 1;
    return;
  }

  const { store } = await ensureStore(root, repositoryId, Boolean(flags['db']));
  const search = new SearchService(store);
  const sources = new DiskSourceRegistry(root);
  const chat = new CodebaseChat({ store, search, sources, provider: new OpenRouterProvider() });

  process.stderr.write('Asking OpenRouter with graph-grounded evidence...\n');
  const answer = await chat.ask(repositoryId, question, {
    depth: Number(flags['depth'] ?? 2),
    maxNodes: Number(flags['maxNodes'] ?? 60),
    maxTokens: Number(flags['maxTokens'] ?? 6000),
  });

  process.stdout.write(
    [
      '',
      answer.answer,
      '',
      `confidence: ${answer.confidence}${answer.unverified ? ' (unverified)' : ''}`,
      answer.references.length ? '\nReferences:' : '',
      ...answer.references.map((r) => `  ${r.filePath}:${r.startLine}-${r.endLine}${r.symbol ? `  ${r.symbol}` : ''}`),
      answer.canvasPath.length ? `\nCanvas path (${answer.canvasPath.length} nodes): ${answer.canvasPath.slice(0, 8).join(' -> ')}${answer.canvasPath.length > 8 ? ' -> …' : ''}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  await store.close();
}

async function commandNode(positional: string[], flags: Flags): Promise<void> {
  const [path, nodeId] = positional;
  if (!path || !nodeId) throw new Error('node requires <path> and a <nodeId>.');
  const root = resolve(path);
  const repositoryId = `local:${root.split(/[\\/]/).pop()}`;
  const { store } = await ensureStore(root, repositoryId, Boolean(flags['db']));
  const node = await store.getNode(nodeId);
  if (!node) {
    process.stderr.write(`Node ${nodeId} not found.\n`);
    await store.close();
    return;
  }
  const [out, incoming] = await Promise.all([store.getEdgesFrom(node.id), store.getEdgesTo(node.id)]);
  const sources = new DiskSourceRegistry(root);
  const content = node.filePath ? sources.getFileContent(node.filePath) : null;
  const snippet =
    content && node.startLine
      ? content
          .split(/\r?\n/)
          .slice(node.startLine - 1, node.endLine ?? node.startLine)
          .join('\n')
      : '';

  process.stdout.write(
    [
      '',
      `${node.name}  (${node.nodeType})`,
      `  file:  ${node.filePath ?? 'n/a'}${node.startLine ? `:${node.startLine}-${node.endLine}` : ''}`,
      `  calls/uses:`,
      ...out.filter((e) => ['CALLS', 'USES', 'RENDERS', 'CALLS_API', 'NAVIGATES_TO'].includes(e.edgeType)).map((e) => `    --${e.edgeType}--> ${e.targetNodeId}  (${redact(e.evidence)})`),
      `  referenced by:`,
      ...incoming.slice(0, 15).map((e) => `    <--${e.edgeType}-- ${e.sourceNodeId}`),
      snippet ? '\n  source:\n' + snippet.split('\n').map((l) => '    ' + l).join('\n') : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  await store.close();
}

async function commandMigrate(): Promise<void> {
  if (!hasDatabase()) {
    process.stderr.write('DATABASE_URL is not set; nothing to migrate.\n');
    process.exitCode = 1;
    return;
  }
  const result = await runMigrations();
  process.stdout.write(`Migrations applied: ${result.applied.join(', ') || 'none'} (skipped ${result.skipped.length}).\n`);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'index':
      return commandIndex(positional, flags);
    case 'graph':
      return commandGraph(positional, flags);
    case 'search':
      return commandSearch(positional, flags);
    case 'ask':
      return commandAsk(positional, flags);
    case 'node':
      return commandNode(positional, flags);
    case 'migrate':
      return commandMigrate();
    default:
      process.stdout.write(usage());
  }
}

main().catch((e) => {
  log.error('cli.failed', { message: e instanceof Error ? e.message : String(e) });
  process.stderr.write(`\nError: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

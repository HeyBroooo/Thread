import { resolve } from 'node:path';
import { createGraphStore } from '@cbi/graph';
import { createLogger, getConfig } from '@cbi/shared';
import { runIndexingJob } from './pipeline.js';

const log = createLogger({ component: 'indexer.worker' });

/**
 * Indexer worker.
 *
 * Usage:
 *   tsx workers/indexer/src/index.ts <checkout-path> [--repository <id>] [--commit <sha>]
 *
 * In production this process consumes the indexing queue (Redis). Locally it
 * can run a one-shot index so the platform is fully usable without a broker.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    log.info('indexer.worker_idle', {
      note: 'No checkout path supplied. Provide: tsx workers/indexer/src/index.ts <path> --repository <id>',
      database: Boolean(getConfig().databaseUrl),
    });
    return;
  }

  const repositoryId = argValue(args, '--repository') ?? 'local';
  const commitSha = argValue(args, '--commit') ?? 'HEAD';
  const root = resolve(path);

  const store = createGraphStore();
  await store.init();

  const result = await runIndexingJob({
    repositoryId,
    root,
    commitSha,
    store,
    persistToDatabase: Boolean(getConfig().databaseUrl),
    onProgress: (p) => {
      log.info('indexer.progress', { stage: p.stage, progress: p.progress, files: `${p.filesProcessed}/${p.filesTotal}` });
    },
  });

  log.info('indexer.done', {
    repositoryId,
    nodes: result.nodes,
    edges: result.edges,
    files: result.filesParsed,
    durationMs: result.durationMs,
  });
  // Print a compact human summary for CLI use.
  process.stdout.write(
    [
      '',
      `Indexed ${root}`,
      `  files:   ${result.filesParsed}`,
      `  nodes:   ${result.nodes}`,
      `  edges:   ${result.edges}`,
      `  unresolved imports: ${result.unresolvedImports}`,
      `  validation: ${result.validation.status} (${result.validation.errors} errors, ${result.validation.warnings} warnings)`,
      `  frontend: ${result.architecture.frontend.join(', ') || 'n/a'}`,
      `  routing:  ${result.architecture.routing}`,
      `  duration: ${result.durationMs}ms`,
      result.skippedLanguages.length ? `  skipped languages: ${result.skippedLanguages.join(', ')}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  await store.close();
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

main().catch((e) => {
  log.error('indexer.worker_failed', { message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});

export * from './pipeline.js';

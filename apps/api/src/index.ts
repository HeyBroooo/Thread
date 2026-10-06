import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createLogger, getConfig } from '@cbi/shared';
import { hasDatabase, runMigrations, ensureBootstrap, setDatabaseAvailability } from '@cbi/db';
import { InMemoryGraphStore, getGraphStore, setGraphStore } from '@cbi/graph';
import { createApp } from './app.js';
import { flushState, stateDir } from './state.js';
import { startPrSync } from './prSync.js';

const log = createLogger({ component: 'api.server' });

async function bootstrapDatabase(): Promise<void> {
  if (!hasDatabase()) {
    log.info('api.database_disabled', { note: 'DATABASE_URL not set — using in-memory graph and repository registry.' });
    return;
  }
  try {
    const { applied } = await runMigrations();
    await ensureBootstrap();
    setDatabaseAvailability(true);
    log.info('api.database_ready', { applied });
  } catch (e) {
    setDatabaseAvailability(false);
    log.error('api.database_bootstrap_failed', {
      message: e instanceof Error ? e.message : String(e),
      note: 'Falling back to the in-memory graph and repository registry.',
    });
  }
}

async function main(): Promise<void> {
  await bootstrapDatabase();
  const config = getConfig();

  // Without PostgreSQL the graph is in-memory — snapshot it so a restart
  // (tsx watch reloads on every edit) does not empty the canvas.
  if (!hasDatabase()) {
    setGraphStore(new InMemoryGraphStore({ persistPath: resolve(stateDir(), 'graph.json') }));
  }

  const app = createApp();
  // Safety net for PR reviews: the webhook only fires once the GitHub App is
  // installed, so open PRs are also discovered by polling.
  startPrSync();

  const shutdown = () => {
    try {
      const store = getGraphStore();
      if (store instanceof InMemoryGraphStore) store.persist();
    } catch {
      // best effort
    }
    flushState();
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info('api.listening', {
      port: info.port,
      env: config.nodeEnv,
      database: hasDatabase(),
      aiConfigured: Boolean(config.ai.apiKey),
      githubConfigured: Boolean(config.github.appId),
    });
    process.stdout.write(`\nCodebase Intelligence API listening on http://localhost:${info.port}\n`);
  });
}

main().catch((e) => {
  log.error('api.startup_failed', { message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});

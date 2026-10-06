import { createLogger } from '@cbi/shared';
import { getPool } from './pool.js';
import { MIGRATIONS } from './schema.js';

const log = createLogger({ component: 'migrate' });

export async function runMigrations(): Promise<{ applied: number[]; skipped: number[] }> {
  const pool = getPool();
  const applied: number[] = [];
  const skipped: number[] = [];

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const existing = await pool.query<{ version: number }>('SELECT version FROM schema_migrations');
  const seen = new Set(existing.rows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (seen.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }
    log.info('migration.applying', { version: migration.version, name: migration.name });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
      await client.query('COMMIT');
      applied.push(migration.version);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      client.release();
    }
  }

  log.info('migration.done', { applied, skipped });
  return { applied, skipped };
}

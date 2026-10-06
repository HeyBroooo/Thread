import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { getConfig } from '@cbi/shared';

let pool: pg.Pool | null = null;
/** null = not yet probed, true = reachable, false = configured but unreachable. */
let availability: boolean | null = null;

/**
 * A configured DATABASE_URL is not the same as a *usable* database. The flag is
 * set by the migration/bootstrap step so the API degrades to the in-memory
 * graph instead of failing every request when Postgres is down.
 */
export function setDatabaseAvailability(value: boolean | null): void {
  availability = value;
}

export function getDatabaseAvailability(): boolean | null {
  return availability;
}

export function hasDatabase(): boolean {
  if (!getConfig().databaseUrl) return false;
  return availability !== false;
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const url = getConfig().databaseUrl;
  if (!url) {
    throw new Error('DATABASE_URL is not configured.');
  }
  pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', event: 'pg.pool_error', message: err.message }));
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(sql, params as never[]);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export type { PoolClient };

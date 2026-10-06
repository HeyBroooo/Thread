import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '@cbi/shared';

const log = createLogger({ component: 'state' });

/**
 * Small JSON-on-disk state store.
 *
 * The API runs without PostgreSQL in development, which used to mean every
 * restart silently dropped the repository registry, the indexed graph and the
 * review results. Everything the platform needs to keep working across a
 * restart is written here (`.cbi/state/`, git-ignored).
 */
export function stateDir(): string {
  return resolve(process.env.CBI_STATE_DIR ?? resolve(process.cwd(), '.cbi', 'state'));
}

export function readState<T>(name: string, fallback: T): T {
  const file = resolve(stateDir(), name);
  for (const candidate of [file, `${file}.bak`]) {
    if (!existsSync(candidate)) continue;
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')) as T;
    } catch (e) {
      log.warn('state.read_failed', {
        file: candidate,
        message: e instanceof Error ? e.message : String(e),
        note: candidate === file ? 'falling back to the backup copy' : 'no usable state',
      });
    }
  }
  return fallback;
}

let writeCounter = 0;

/**
 * Atomic write (unique tmp + rename) so a crash mid-write cannot corrupt the
 * state. The tmp name must be unique per call: `tsx watch` briefly runs two API
 * processes side by side during a reload, and a shared tmp path let their
 * writes interleave into one file.
 */
export function writeState(name: string, value: unknown): void {
  const dir = stateDir();
  const file = resolve(dir, name);
  const tmp = `${file}.${process.pid}.${writeCounter++}.tmp`;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(value));
    if (existsSync(file)) renameSync(file, `${file}.bak`);
    renameSync(tmp, file);
  } catch (e) {
    log.warn('state.write_failed', { file, message: e instanceof Error ? e.message : String(e) });
  }
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; value: () => unknown }>();

/** Debounced write — used by hot paths (graph mutations) that flush often. */
export function writeStateDebounced(name: string, value: () => unknown, delayMs = 800): void {
  const existing = pending.get(name);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(name);
    writeState(name, value());
  }, delayMs);
  timer.unref?.();
  pending.set(name, { timer, value });
}

/** Flush any pending debounced write immediately (shutdown/tests). */
export function flushState(name?: string): void {
  for (const [key, entry] of [...pending]) {
    if (name && key !== name) continue;
    clearTimeout(entry.timer);
    pending.delete(key);
    writeState(key, entry.value());
  }
}

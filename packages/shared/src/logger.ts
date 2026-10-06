import { redactObject } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  child(fields: LogFields): Logger;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info';
}

function emit(level: LogLevel, base: LogFields, event: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...base,
    ...(fields ?? {}),
  };
  const safe = redactObject(record);
  const line = JSON.stringify(safe);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export function createLogger(base: LogFields = {}): Logger {
  return {
    child(fields: LogFields): Logger {
      return createLogger({ ...base, ...fields });
    },
    debug: (event, fields) => emit('debug', base, event, fields),
    info: (event, fields) => emit('info', base, event, fields),
    warn: (event, fields) => emit('warn', base, event, fields),
    error: (event, fields) => emit('error', base, event, fields),
  };
}

export const logger = createLogger();

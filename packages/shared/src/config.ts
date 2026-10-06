import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from './errors.js';

let envLoaded = false;

/** Load .env without a dependency. Node >=20 exposes process.loadEnvFile. */
export function loadEnv(cwd = process.cwd()): void {
  if (envLoaded) return;
  envLoaded = true;
  const paths = [resolve(cwd, '.env'), resolve(cwd, '.env.local')];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const loader = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
      if (loader) loader.call(process, p);
    } catch {
      // ignore malformed .env; explicit config validation will surface problems
    }
  }
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  apiUrl: string;
  databaseUrl: string | null;
  redisUrl: string | null;
  github: {
    appId: string | null;
    privateKey: string | null;
    webhookSecret: string | null;
    clientId: string | null;
    clientSecret: string | null;
  };
  ai: {
    apiKey: string | null;
    model: string;
    baseUrl: string;
    appUrl: string;
    appTitle: string;
  };
  authSecret: string;
  encryptionKey: string;
}

let cached: AppConfig | null = null;

export function getConfig(overrides: Partial<Pick<AppConfig, 'nodeEnv'>> = {}): AppConfig {
  if (cached && !overrides.nodeEnv) return cached;
  loadEnv();
  const env = process.env;
  const config: AppConfig = {
    nodeEnv: overrides.nodeEnv ?? env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 8787),
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    apiUrl: env.API_URL ?? 'http://localhost:8787',
    databaseUrl: env.DATABASE_URL ?? null,
    redisUrl: env.REDIS_URL ?? null,
    github: {
      appId: env.GITHUB_APP_ID ?? null,
      privateKey: env.GITHUB_PRIVATE_KEY ?? null,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? null,
      clientId: env.GITHUB_CLIENT_ID ?? null,
      clientSecret: env.GITHUB_CLIENT_SECRET ?? null,
    },
    ai: {
      apiKey: env.OPENROUTER_API_KEY ?? null,
      model: env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
      baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      appUrl: env.OPENROUTER_APP_URL ?? 'http://localhost:3000',
      appTitle: env.OPENROUTER_APP_TITLE ?? 'Codebase Intelligence',
    },
    authSecret: env.AUTH_SECRET ?? 'dev-only-change-me',
    encryptionKey: env.ENCRYPTION_KEY ?? 'dev-only-32-byte-key-change-me!!!',
  };
  if (!overrides.nodeEnv) cached = config;
  return config;
}

/** Reset cache (tests). */
export function resetConfigCache(): void {
  cached = null;
  envLoaded = false;
}

export function requireAiKey(): string {
  const key = getConfig().ai.apiKey;
  if (!key) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'OPENROUTER_API_KEY is not set. Add it to .env to use chat and PR review.',
      503,
    );
  }
  return key;
}

export function requireDatabaseUrl(): string {
  const url = getConfig().databaseUrl;
  if (!url) {
    throw new AppError('DB_NOT_CONFIGURED', 'DATABASE_URL is not set.', 503);
  }
  return url;
}

export function requireWebhookSecret(): string {
  const secret = getConfig().github.webhookSecret;
  if (!secret) {
    throw new AppError('WEBHOOK_NOT_CONFIGURED', 'GITHUB_WEBHOOK_SECRET is not set.', 503);
  }
  return secret;
}

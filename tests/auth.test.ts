import { randomBytes, scryptSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@cbi/shared';
import { createApp } from '../apps/api/src/app.js';
import {
  createSessionToken,
  SESSION_TTL_SECONDS,
  sessionCookie,
  sessionTokenFromCookie,
  verifyPassword,
  verifySessionToken,
} from '../apps/api/src/auth.js';

describe('admin session auth', () => {
  const envKeys = ['APP_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'NODE_ENV'] as const;
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    const environment = process.env as Record<string, string | undefined>;
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
    resetConfigCache();
  });

  it('accepts a signed session until its one-day expiry', () => {
    const now = Date.now();
    const token = createSessionToken('Admin', 'test-session-secret-that-is-long-enough', now);

    expect(verifySessionToken(token, 'test-session-secret-that-is-long-enough', now)).toBe('Admin');
    expect(
      verifySessionToken(token, 'test-session-secret-that-is-long-enough', now + SESSION_TTL_SECONDS * 1000),
    ).toBeNull();
  });

  it('rejects tampered sessions and sessions signed with another secret', () => {
    const token = createSessionToken('Admin', 'test-session-secret-that-is-long-enough');
    const [payload, signature] = token.split('.');

    expect(verifySessionToken(`${payload}.${signature}x`, 'test-session-secret-that-is-long-enough')).toBeNull();
    expect(verifySessionToken(token, 'a-different-session-secret-that-is-long-enough')).toBeNull();
  });

  it('reads the session cookie and emits secure one-day cookie attributes', () => {
    expect(sessionTokenFromCookie('other=value; cbi_admin_session=abc.def')).toBe('abc.def');
    expect(sessionCookie('abc.def', true)).toContain('HttpOnly; SameSite=Lax; Max-Age=86400; Secure');
  });

  it('verifies scrypt hashes and rejects malformed or incorrect values', async () => {
    const salt = randomBytes(16);
    const hash = scryptSync('correct horse battery staple', salt, 64);
    const encoded = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;

    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'plaintext')).resolves.toBe(false);
  });

  it('requires a valid admin session for API data and sets a 24-hour cookie on login', async () => {
    const salt = randomBytes(16);
    const hash = scryptSync('correct horse battery staple', salt, 64);
    process.env.APP_URL = 'https://thread.example.com';
    process.env.ADMIN_USERNAME = 'Admin';
    process.env.ADMIN_PASSWORD_HASH = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    resetConfigCache();
    const app = createApp();

    const blocked = await app.request('/api/repositories');
    expect(blocked.status).toBe(401);
    expect((await blocked.json()).error.code).toBe('AUTH_REQUIRED');

    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://thread.example.com',
        'content-type': 'application/json',
        'x-forwarded-for': `test-${randomBytes(4).toString('hex')}`,
      },
      body: JSON.stringify({ username: 'Admin', password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie');
    if (!cookie) throw new Error('Login did not set a session cookie.');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=86400');

    const session = await app.request('/api/auth/session', {
      headers: new Headers({ cookie: cookie!.split(';')[0]! }),
    });
    expect(await session.json()).toEqual({ authenticated: true });
  });
});

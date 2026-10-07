import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '@cbi/shared';
import { createApp } from '../apps/api/src/app.js';

const environmentKeys = [
  'APP_URL',
  'ADMIN_PASSWORD',
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
  'NODE_ENV',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'AUTH_EMAIL_FROM',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.unstubAllGlobals();
  const environment = process.env as Record<string, string | undefined>;
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  resetConfigCache();
});

describe('magic-link sign-in', () => {
  it('sends a one-time email link and consumes it only once', async () => {
    const environment = process.env as Record<string, string | undefined>;
    process.env.APP_URL = 'https://thread.example.com';
    process.env.ADMIN_PASSWORD = 'shared-entry-password';
    process.env.ADMIN_PASSWORD_HASH = '';
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
    process.env.SUPABASE_URL = 'https://supabase.example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.AUTH_EMAIL_FROM = 'ArchThread <login@example.com>';
    environment.NODE_ENV = 'test';
    resetConfigCache();

    let emailHtml = '';
    let tokenConsumed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = JSON.parse(String(init?.body)) as { html?: string };
      if (url.endsWith('/auth/v1/admin/generate_link')) {
        return new Response(JSON.stringify({ hashed_token: 'supabase-one-time-token' }), { status: 200 });
      }
      if (url === 'https://api.resend.com/emails') {
        emailHtml = payload.html ?? '';
        return new Response(JSON.stringify({ id: 'email_test' }), { status: 200 });
      }
      if (url.endsWith('/auth/v1/verify')) {
        if (tokenConsumed) return new Response(JSON.stringify({ msg: 'Token has expired or is invalid' }), { status: 400 });
        tokenConsumed = true;
        return new Response(JSON.stringify({ user: { email: 'person@example.com' } }), { status: 200 });
      }
      throw new Error(`Unexpected auth request: ${url}`);
    }));

    const app = createApp();
    const sent = await app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: {
        origin: 'https://thread.example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'person@example.com', from: '/repositories/repo_1' }),
    });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ sent: true });
    expect(emailHtml).toContain('ArchThread');

    const href = emailHtml.match(/href="([^"]*\/api\/auth\/magic\/verify[^"]*)"/)?.[1];
    if (!href) throw new Error('Magic-link URL was not rendered in the email.');
    const verifyUrl = new URL(href.replace(/&amp;/g, '&'));
    expect(verifyUrl.searchParams.get('token_hash')).toBe('supabase-one-time-token');
    const firstUse = await app.request(`${verifyUrl.pathname}${verifyUrl.search}`);
    expect(firstUse.status).toBe(302);
    expect(firstUse.headers.get('set-cookie')).toContain('cbi_admin_session=');
    expect(firstUse.headers.get('location')).toContain('/login?entry=1');

    const replay = await app.request(`${verifyUrl.pathname}${verifyUrl.search}`);
    expect(replay.status).toBe(302);
    expect(replay.headers.get('location')).toContain('error=magic-link');
  });

  it('starts Google OAuth through Supabase PKCE without Google credentials in app env', async () => {
    const environment = process.env as Record<string, string | undefined>;
    process.env.APP_URL = 'https://thread.example.com';
    process.env.ADMIN_PASSWORD = 'shared-entry-password';
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
    process.env.SUPABASE_URL = 'https://supabase.example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    environment.NODE_ENV = 'production';
    resetConfigCache();

    const app = createApp();
    const response = await app.request('/api/auth/google/start?from=%2Frepositories%2Frepo_1');
    expect(response.status).toBe(302);
    const authorization = new URL(response.headers.get('location')!);
    expect(authorization.origin).toBe('https://supabase.example.com');
    expect(authorization.pathname).toBe('/auth/v1/authorize');
    expect(authorization.searchParams.get('provider')).toBe('google');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorization.searchParams.get('redirect_to')).toContain('/api/auth/supabase/callback');
    expect(response.headers.get('set-cookie')).toContain('cbi_supabase_oauth_state=');
  });
});

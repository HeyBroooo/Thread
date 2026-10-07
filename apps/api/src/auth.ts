import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { scrypt as scryptCallback } from 'node:crypto';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'cbi_admin_session';
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

interface SessionPayload {
  username: string;
  expiresAt: number;
  email?: string;
  entryVerified?: boolean;
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(
  username: string,
  secret: string,
  now = Date.now(),
  options: Pick<SessionPayload, 'email' | 'entryVerified'> = {},
): string {
  const payload: SessionPayload = {
    username,
    expiresAt: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    entryVerified: options.entryVerified ?? true,
    ...(options.email ? { email: options.email } : {}),
  };
  return signPayload({ ...payload }, secret);
}

export function createIdentitySessionToken(email: string, secret: string, now = Date.now()): string {
  return createSessionToken('Admin', secret, now, { email, entryVerified: false });
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, secret)}`;
}

export function createSignedToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  return signPayload({ ...payload, expiresAt: Math.floor(now / 1000) + ttlSeconds }, secret);
}

export function verifySignedToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Record<string, unknown> | null {
  if (!token) return null;
  const [encoded, suppliedSignature, ...extra] = token.split('.');
  if (!encoded || !suppliedSignature || extra.length) return null;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.expiresAt !== 'number') return null;
    if (payload.expiresAt <= Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifySessionClaims(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  const payload = verifySignedToken(token, secret, now);
  if (
    !payload ||
    typeof payload.username !== 'string' ||
    typeof payload.expiresAt !== 'number' ||
    (payload.email !== undefined && typeof payload.email !== 'string') ||
    (payload.entryVerified !== undefined && typeof payload.entryVerified !== 'boolean')
  ) {
    return null;
  }
  return {
    username: payload.username,
    expiresAt: payload.expiresAt,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    ...(typeof payload.entryVerified === 'boolean' ? { entryVerified: payload.entryVerified } : {}),
  };
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  return verifySessionClaims(token, secret, now)?.username ?? null;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (password.length > 1024) return false;
  const [algorithm, salt, expectedHex, ...extra] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex || extra.length) return false;
  if (!/^[a-f0-9]{32,128}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;

  const actual = (await scrypt(password, Buffer.from(salt, 'hex'), 64)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(actual, expected);
}

export async function verifyConfiguredPassword(password: string): Promise<boolean> {
  if (password.length > 1024) return false;
  const configured = process.env.ADMIN_PASSWORD;
  if (configured) {
    const actual = createHash('sha256').update(password).digest();
    const expected = createHash('sha256').update(configured).digest();
    return timingSafeEqual(actual, expected);
  }
  const hash = process.env.ADMIN_PASSWORD_HASH;
  return hash ? verifyPassword(password, hash) : false;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function sessionTokenFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === SESSION_COOKIE) return item.slice(separator + 1).trim();
  }
  return undefined;
}

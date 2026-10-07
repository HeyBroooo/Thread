import { createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { scrypt as scryptCallback } from 'node:crypto';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'cbi_admin_session';
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

interface SessionPayload {
  username: string;
  expiresAt: number;
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(username: string, secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    username,
    expiresAt: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const [encoded, suppliedSignature, ...extra] = token.split('.');
  if (!encoded || !suppliedSignature || extra.length) return null;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof payload.username !== 'string' || typeof payload.expiresAt !== 'number') return null;
    if (payload.expiresAt <= Math.floor(now / 1000)) return null;
    return payload.username;
  } catch {
    return null;
  }
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

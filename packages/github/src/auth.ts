import { createSign } from 'node:crypto';
import { AppError } from '@cbi/shared';

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Build a GitHub App JWT (RS256). Docs require iat slightly in the past and
 * expiry below 10 minutes.
 */
export function createAppJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 540, iss: appId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  let signature: Buffer;
  try {
    signature = signer.sign(privateKeyPem);
  } catch {
    throw new AppError('GITHUB_APP_KEY_INVALID', 'GITHUB_PRIVATE_KEY could not be used to sign a JWT.', 500);
  }
  return `${signingInput}.${base64url(signature)}`;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

export async function createInstallationToken(
  installationId: number | string,
  appJwt: string,
  baseUrl = 'https://api.github.com',
): Promise<InstallationToken> {
  const res = await fetch(`${baseUrl}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${appJwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new AppError('GITHUB_AUTH_FAILED', `Failed to create installation token (${res.status}).`, 502);
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  return { token: json.token, expiresAt: json.expires_at };
}

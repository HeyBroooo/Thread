// Remove this GitHub App's own comments from a pull request.
//
// Duplicate review comments accumulate when a review is triggered more than
// once for the same commit (webhook + poller + manual click). This script
// deletes only comments authored by *this* App's bot account on the given PR,
// so a single clean review can be re-posted.
//
// Usage: node scripts/cleanup-pr-comments.mjs [owner] [repo] [prNumber]
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const [, , ownerArg, repoArg, prArg] = process.argv;
const owner = ownerArg ?? 'HeyBroooo';
const repo = repoArg ?? 'cognimail';
const prNumber = Number(prArg ?? 1);

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k) => {
  const marker = `\n${k}=`;
  const at = env.indexOf(marker);
  if (at === -1) return null;
  let rest = env.slice(at + marker.length);
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    rest = end === -1 ? rest.split('\n')[0] : rest.slice(0, end + 1);
  } else {
    rest = rest.split('\n')[0];
  }
  rest = rest.trim();
  if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
  return rest;
};

const appId = get('GITHUB_APP_ID');
let pk = get('GITHUB_PRIVATE_KEY') ?? '';
if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);
pk = pk.replace(/\\n/g, '\n');

const b64url = (s) =>
  Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const now = Math.floor(Date.now() / 1000);
const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
  JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
)}`;
const signer = createSign('RSA-SHA256');
signer.update(signingInput);
signer.end();
const jwt = `${signingInput}.${b64url(signer.sign(pk))}`;

const appHeaders = {
  authorization: `Bearer ${jwt}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'cbi-cleanup',
};

const api = 'https://api.github.com';

async function main() {
  const app = await (await fetch(`${api}/app`, { headers: appHeaders })).json();
  const slug = app.slug;
  if (!slug) throw new Error('Could not read the App slug.');
  const bot = `${slug}[bot]`;

  const installs = await (await fetch(`${api}/app/installations?per_page=100`, { headers: appHeaders })).json();
  const match = installs.find((i) => i.account?.login?.toLowerCase() === owner.toLowerCase());
  if (!match) throw new Error(`The App is not installed on ${owner}.`);

  const tokRes = await fetch(`${api}/app/installations/${match.id}/access_tokens`, {
    method: 'POST',
    headers: appHeaders,
  });
  const { token } = await tokRes.json();
  if (!token) throw new Error('Could not mint an installation token.');
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'cbi-cleanup',
  };

  const targets = [
    { list: `${api}/repos/${owner}/${repo}/issues/${prNumber}/comments`, del: (id) => `${api}/repos/${owner}/${repo}/issues/comments/${id}`, label: 'summary' },
    { list: `${api}/repos/${owner}/${repo}/pulls/${prNumber}/comments`, del: (id) => `${api}/repos/${owner}/${repo}/pulls/comments/${id}`, label: 'inline' },
  ];

  let deleted = 0;
  for (const t of targets) {
    const comments = await (await fetch(`${t.list}?per_page=100`, { headers })).json();
    if (!Array.isArray(comments)) {
      console.log(`  ${t.label}: could not list (${JSON.stringify(comments).slice(0, 120)})`);
      continue;
    }
    const mine = comments.filter((c) => c.user?.login === bot);
    console.log(`  ${t.label}: ${mine.length} of ${comments.length} authored by ${bot}`);
    for (const c of mine) {
      const res = await fetch(t.del(c.id), { method: 'DELETE', headers });
      if (res.status === 204) deleted++;
      else console.log(`    failed to delete ${c.id}: ${res.status}`);
    }
  }
  console.log(`Deleted ${deleted} comment(s) on ${owner}/${repo}#${prNumber}.`);
}

main().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});

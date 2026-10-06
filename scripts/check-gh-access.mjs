// Read-only diagnostic: is the configured GitHub App installed, with what
// permissions, and does it cover the target repository?
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

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
const si = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
  JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
)}`;
const signer = createSign('RSA-SHA256');
signer.update(si);
signer.end();
let sig;
try {
  sig = signer.sign(pk);
} catch (e) {
  console.log('SIGN_FAIL', e.message, '| key prefix:', pk.slice(0, 40).replace(/\n/g, '\\n'));
  process.exit(1);
}
const jwt = `${si}.${b64url(sig)}`;

const headers = {
  authorization: `Bearer ${jwt}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'cbi-diagnostic',
};

const j = async (url, h = headers) => {
  const r = await fetch(url, { headers: h });
  const body = await r.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not json */
  }
  return { status: r.status, parsed, body };
};

const main = async () => {
  const app = await j('https://api.github.com/app');
  console.log('== GET /app ==', app.status);
  if (app.parsed) {
    console.log('  name/slug:', app.parsed.name, '/', app.parsed.slug);
    console.log('  own permissions:', JSON.stringify(app.parsed.permissions ?? {}));
    console.log('  events:', JSON.stringify(app.parsed.events ?? []));
    console.log('  install_url (html):', app.parsed.html_url);
  } else console.log(' ', app.body.slice(0, 200));

  const insts = await j('https://api.github.com/app/installations');
  console.log('== GET /app/installations ==', insts.status);
  const list = Array.isArray(insts.parsed) ? insts.parsed : [];
  for (const i of list) {
    console.log(`  installation ${i.id}  account=${i.account?.login}  target=${i.target_type}  selection=${i.repository_selection}  suspended=${i.suspended_at}`);
    console.log('    permissions:', JSON.stringify(i.permissions ?? {}));
    console.log('    events:', JSON.stringify(i.events ?? []));
    const one = await j(`https://api.github.com/app/installations/${i.id}`);
    console.log('    GET /app/installations/{id}:', one.status, JSON.stringify(one.parsed?.permissions ?? {}));
    const repos = await j(`https://api.github.com/app/installations/${i.id}/repositories?per_page=100`);
    console.log('    accessible repos:', repos.status, repos.parsed?.total_count ?? repos.body.slice(0, 120));
    if (Array.isArray(repos.parsed?.repositories)) {
      console.log('      ->', repos.parsed.repositories.map((r) => r.full_name).join(', ') || '(none)');
    }
  }

  // Does the app cover the target repo?
  const inst = await j('https://api.github.com/repos/HeyBroooo/cognimail/installation');
  console.log('== GET /repos/HeyBroooo/cognimail/installation ==', inst.status, inst.body.slice(0, 200));

  // Can we mint a token for the existing installation and read the repo?
  if (list[0]) {
    const tok = await j(`https://api.github.com/app/installations/${list[0].id}/access_tokens`, {
      ...headers,
      'content-type': 'application/json',
    });
    // access_tokens requires POST
    const tokPost = await fetch(`https://api.github.com/app/installations/${list[0].id}/access_tokens`, {
      method: 'POST',
      headers,
    });
    const tokJson = await tokPost.json().catch(() => null);
    console.log('== POST access_tokens ==', tokPost.status);
    console.log('   granted permissions:', JSON.stringify(tokJson?.permissions ?? {}), '| selection:', tokJson?.repository_selection);
    if (tokJson?.token) {
      const th = { authorization: `Bearer ${tokJson.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'cbi-diagnostic' };
      const me = await j('https://api.github.com/installation/repositories?per_page=100', th);
      console.log('   installation/repositories ->', me.status, me.parsed?.total_count ?? me.body.slice(0, 160));
      const rl = await j('https://api.github.com/rate_limit', th);
      console.log('   rate_limit core:', JSON.stringify(rl.parsed?.resources?.core ?? {}));
      // Does installation token see the target repo?
      const repo = await fetch('https://api.github.com/repos/HeyBroooo/cognimail', { headers: th });
      console.log('   installation token GET /repos/HeyBroooo/cognimail ->', repo.status);
      const prs = await fetch('https://api.github.com/repos/HeyBroooo/cognimail/pulls?state=all&per_page=10', { headers: th });
      const prsJson = await prs.json().catch(() => null);
      console.log('   installation token GET pulls ->', prs.status, Array.isArray(prsJson) ? prsJson.map((p) => `#${p.number} ${p.base?.ref}<-${p.head?.ref}`).join(', ') : JSON.stringify(prsJson).slice(0, 160));
      const comments = await fetch('https://api.github.com/repos/HeyBroooo/cognimail/issues/1/comments', { headers: th });
      const cJson = await comments.json().catch(() => null);
      console.log('   existing comments on #1 ->', comments.status, Array.isArray(cJson) ? cJson.map((c) => c.user?.login).join(', ') : JSON.stringify(cJson).slice(0, 160));
    }
  }

  // Rate limit as this IP (anonymous).
  const rlAnon = await j('https://api.github.com/rate_limit', { accept: 'application/vnd.github+json', 'user-agent': 'cbi-diagnostic' });
  console.log('== anonymous rate_limit ==', rlAnon.status, JSON.stringify(rlAnon.parsed?.resources?.core ?? {}));
  console.log('\n-- ACTION LINKS --');
  console.log('  App permissions:', `https://github.com/settings/apps/archthread/permissions`);
  console.log('  App installation repos:', `https://github.com/settings/installations/167541461`);
};

main().catch((e) => console.log('ERR', e.message));

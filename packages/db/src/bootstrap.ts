import { query, queryOne } from './pool.js';
import type { OrganizationRow } from './repos.js';

const DEFAULT_ORG_NAME = 'Local Development';

/** Ensure a default organization + user exist so the app runs with zero setup. */
export async function ensureBootstrap(): Promise<{ organization: OrganizationRow; userId: string }> {
  let org = await queryOne<OrganizationRow>('SELECT id, name FROM organizations WHERE name = $1 LIMIT 1', [
    DEFAULT_ORG_NAME,
  ]);
  if (!org) {
    org = await queryOne<OrganizationRow>('INSERT INTO organizations (name) VALUES ($1) RETURNING id, name', [
      DEFAULT_ORG_NAME,
    ]);
  }
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, github_login)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [org!.id, 'dev@localhost', 'Local Developer', 'local-dev'],
  );
  return { organization: org!, userId: user!.id };
}

export async function resolveDefaultOrganization(): Promise<OrganizationRow> {
  const org = await queryOne<OrganizationRow>('SELECT id, name FROM organizations ORDER BY created_at LIMIT 1');
  if (org) return org;
  return (await ensureBootstrap()).organization;
}

export async function listOrganizations(): Promise<OrganizationRow[]> {
  return query<OrganizationRow>('SELECT id, name FROM organizations ORDER BY created_at');
}

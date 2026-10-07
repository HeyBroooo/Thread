import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodebaseChat, OpenRouterProvider, type AIProvider } from '@cbi/ai';
import { PgGraphStore, InMemoryGraphStore, getGraphStore, type GraphStore } from '@cbi/graph';
import { SearchService } from '@cbi/search';
import { DiskSourceRegistry, Errors, getConfig, uuid, type IndexStatus, type SourceRegistry } from '@cbi/shared';
import * as db from '@cbi/db';
import { readState, writeState } from './state.js';

export interface RepoRecord {
  id: string;
  organizationId: string;
  owner: string;
  name: string;
  branch: string;
  defaultBranch: string;
  indexedCommitSha: string | null;
  indexStatus: IndexStatus;
  parserVersion: string | null;
  graphSchemaVersion: number | null;
  checkoutPath: string;
  repositoryConfig: Record<string, unknown>;
  lastIndexedAt: string | null;
  error: string | null;
}

const DEV_ORG_ID = 'local-org';

async function resolveOrganizationId(organizationId: string): Promise<string> {
  if (!usingDatabase() || organizationId !== DEV_ORG_ID) return organizationId;
  const { organization } = await db.ensureBootstrap();
  return organization.id;
}

/**
 * Without PostgreSQL the registry lived only in process memory, so every API
 * restart made connected repositories (and their PR pages) disappear. The
 * in-memory registry is therefore mirrored to `.cbi/state/repos.json`.
 */
const memoryRepos = new Map<string, RepoRecord>();
for (const record of readState<RepoRecord[]>('repos.json', [])) memoryRepos.set(record.id, record);

function persistRepos(): void {
  writeState('repos.json', [...memoryRepos.values()]);
}

export function usingDatabase(): boolean {
  return Boolean(getConfig().databaseUrl) && db.hasDatabase();
}

export async function ensureBootstrapIfNeeded(): Promise<void> {
  if (!usingDatabase()) return;
  try {
    await db.ensureBootstrap();
  } catch {
    // database may be unreachable; API still works in-memory
  }
}

function defaultCheckoutPath(owner: string, name: string): string {
  const candidates = [
    process.env.CBI_CHECKOUT_DIR ? resolve(process.env.CBI_CHECKOUT_DIR, `${owner}__${name}`) : null,
    resolve(process.cwd(), '.cbi', 'checkouts', `${owner}__${name}`),
    resolve(process.cwd(), '..', name),
    resolve(process.cwd(), name),
  ].filter((p): p is string => Boolean(p));
  const existing = candidates.find((p) => existsSync(p));
  return existing ?? candidates[0]!;
}

export async function listRepos(organizationId = DEV_ORG_ID): Promise<RepoRecord[]> {
  if (usingDatabase()) {
    const rows = await db.listRepositories(await resolveOrganizationId(organizationId));
    const out: RepoRecord[] = [];
    for (const row of rows) {
      out.push({
        id: row.id,
        organizationId: row.organization_id,
        owner: row.owner,
        name: row.name,
        branch: row.branch,
        defaultBranch: row.default_branch,
        indexedCommitSha: row.indexed_commit_sha,
        indexStatus: row.index_status,
        parserVersion: row.parser_version,
        graphSchemaVersion: row.graph_schema_version,
        checkoutPath: defaultCheckoutPath(row.owner, row.name),
        repositoryConfig: await db.getRepositoryConfig(row.id).catch(() => ({})),
        lastIndexedAt: row.last_indexed_at,
        error: row.error,
      });
    }
    return out;
  }
  return [...memoryRepos.values()];
}

export async function createRepo(input: {
  owner: string;
  name: string;
  branch?: string;
  defaultBranch?: string;
  checkoutPath?: string;
  organizationId?: string;
}): Promise<RepoRecord> {
  const requestedOrganizationId = input.organizationId ?? DEV_ORG_ID;
  if (usingDatabase()) {
    const organizationId = await resolveOrganizationId(requestedOrganizationId);
    const row = await db.createRepository({
      organizationId,
      owner: input.owner,
      name: input.name,
      branch: input.branch,
      defaultBranch: input.defaultBranch,
    });
    const record: RepoRecord = {
      id: row.id,
      organizationId,
      owner: row.owner,
      name: row.name,
      branch: row.branch,
      defaultBranch: row.default_branch,
      indexedCommitSha: row.indexed_commit_sha,
      indexStatus: row.index_status,
      parserVersion: row.parser_version,
      graphSchemaVersion: row.graph_schema_version,
      checkoutPath: input.checkoutPath ?? defaultCheckoutPath(row.owner, row.name),
      repositoryConfig: {},
      lastIndexedAt: row.last_indexed_at,
      error: row.error,
    };
    if (input.checkoutPath) await db.setRepositoryConfig(row.id, { checkoutPath: input.checkoutPath });
    return record;
  }

  const organizationId = requestedOrganizationId;
  const id = `repo_${uuid().slice(0, 8)}`;
  const record: RepoRecord = {
    id,
    organizationId,
    owner: input.owner,
    name: input.name,
    branch: input.branch ?? input.defaultBranch ?? 'main',
    defaultBranch: input.defaultBranch ?? 'main',
    indexedCommitSha: null,
    indexStatus: 'CONNECTED',
    parserVersion: null,
    graphSchemaVersion: null,
    checkoutPath: input.checkoutPath ?? defaultCheckoutPath(input.owner, input.name),
    repositoryConfig: {},
    lastIndexedAt: null,
    error: null,
  };
  memoryRepos.set(id, record);
  persistRepos();
  return record;
}

export async function getRepo(id: string, organizationId = DEV_ORG_ID): Promise<RepoRecord | null> {
  if (usingDatabase()) {
    const row = await db.getRepositoryForOrg(id, await resolveOrganizationId(organizationId));
    if (!row) return null;
    const config = await db.getRepositoryConfig(id).catch(() => ({}) as Record<string, unknown>);
    return {
      id: row.id,
      organizationId: row.organization_id,
      owner: row.owner,
      name: row.name,
      branch: row.branch,
      defaultBranch: row.default_branch,
      indexedCommitSha: row.indexed_commit_sha,
      indexStatus: row.index_status,
      parserVersion: row.parser_version,
      graphSchemaVersion: row.graph_schema_version,
      checkoutPath: (config['checkoutPath'] as string) ?? defaultCheckoutPath(row.owner, row.name),
      repositoryConfig: config,
      lastIndexedAt: row.last_indexed_at,
      error: row.error,
    };
  }
  const record = memoryRepos.get(id);
  if (!record) return null;
  if (record.organizationId !== organizationId && organizationId !== DEV_ORG_ID) return null;
  return record;
}

export async function updateRepo(
  id: string,
  patch: Partial<Pick<RepoRecord, 'indexStatus' | 'indexedCommitSha' | 'parserVersion' | 'graphSchemaVersion' | 'lastIndexedAt' | 'error'>>,
): Promise<void> {
  if (usingDatabase()) {
    await db
      .updateRepositoryStatus(id, {
        indexStatus: patch.indexStatus,
        indexedCommitSha: patch.indexedCommitSha,
        parserVersion: patch.parserVersion ?? undefined,
        graphSchemaVersion: patch.graphSchemaVersion ?? undefined,
        error: patch.error ?? null,
        lastIndexedAt: patch.lastIndexedAt ? new Date(patch.lastIndexedAt) : undefined,
      })
      .catch(() => undefined);
    return;
  }
  const record = memoryRepos.get(id);
  if (!record) return;
  Object.assign(record, patch);
  persistRepos();
}

export async function updateRepoBranch(id: string, organizationId: string, branch: string): Promise<void> {
  if (usingDatabase()) {
    if (!(await db.updateRepositoryBranch(id, await resolveOrganizationId(organizationId), branch))) {
      throw Errors.repositoryNotFound(id);
    }
    return;
  }
  const record = memoryRepos.get(id);
  if (!record || record.organizationId !== organizationId) throw Errors.repositoryNotFound(id);
  record.branch = branch;
  record.defaultBranch = branch;
  persistRepos();
}

export async function deleteRepo(id: string, organizationId: string): Promise<void> {
  if (usingDatabase()) {
    if (!(await db.deleteRepository(id, await resolveOrganizationId(organizationId)))) {
      throw Errors.repositoryNotFound(id);
    }
    return;
  }
  const record = memoryRepos.get(id);
  if (!record || record.organizationId !== organizationId) throw Errors.repositoryNotFound(id);
  memoryRepos.delete(id);
  persistRepos();
}

// ------------------------------------------------------------------ graph & ai

export function graphStore(): GraphStore {
  return getGraphStore();
}

export function resetGraphStoreForTests(store: GraphStore): void {
  // used by tests
  void store;
}

export function createSearchService(store: GraphStore = graphStore()): SearchService {
  return new SearchService(store);
}

export function sourceRegistry(checkoutPath: string): SourceRegistry {
  return new DiskSourceRegistry(checkoutPath);
}

export function aiProvider(): AIProvider | null {
  const key = getConfig().ai.apiKey;
  if (!key) return null;
  try {
    return new OpenRouterProvider();
  } catch {
    return null;
  }
}

export function chatService(store: GraphStore, search: SearchService, sources: SourceRegistry): CodebaseChat {
  const provider = aiProvider();
  return new CodebaseChat({ store, search, sources, ...(provider ? { provider } : {}) });
}

export { PgGraphStore, InMemoryGraphStore };

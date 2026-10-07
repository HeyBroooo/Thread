import type { Finding, IndexStatus, Severity } from '@cbi/shared';
import { query, queryOne, withTransaction, type PoolClient } from './pool.js';

export interface OrganizationRow {
  id: string;
  name: string;
}

export interface RepositoryRow {
  id: string;
  organization_id: string;
  github_installation_id: string | null;
  github_repository_id: string | null;
  owner: string;
  name: string;
  default_branch: string;
  branch: string;
  indexed_commit_sha: string | null;
  index_status: IndexStatus;
  parser_version: string | null;
  graph_schema_version: number | null;
  last_indexed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndexingJobRow {
  id: string;
  repository_id: string;
  commit_sha: string;
  status: string;
  stage: string;
  progress: number;
  files_processed: number;
  files_total: number;
  nodes_created: number;
  edges_created: number;
  incremental: boolean;
  retry_count: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// ---------------------------------------------------------------- organizations

export async function createOrganization(name: string): Promise<OrganizationRow> {
  const row = await queryOne<OrganizationRow>(
    'INSERT INTO organizations (name) VALUES ($1) RETURNING id, name',
    [name],
  );
  return row!;
}

export async function getOrganization(id: string): Promise<OrganizationRow | null> {
  return queryOne<OrganizationRow>('SELECT id, name FROM organizations WHERE id = $1', [id]);
}

// ---------------------------------------------------------------- repositories

export async function createRepository(input: {
  organizationId: string;
  installationId?: string | null;
  githubRepositoryId?: number | null;
  owner: string;
  name: string;
  defaultBranch?: string;
  branch?: string;
}): Promise<RepositoryRow> {
  const row = await queryOne<RepositoryRow>(
    `INSERT INTO repositories (organization_id, github_installation_id, github_repository_id, owner, name, default_branch, branch)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id, owner, name, branch)
     DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      input.organizationId,
      input.installationId ?? null,
      input.githubRepositoryId ?? null,
      input.owner,
      input.name,
      input.defaultBranch ?? 'main',
      input.branch ?? input.defaultBranch ?? 'main',
    ],
  );
  return row!;
}

export async function getRepository(id: string): Promise<RepositoryRow | null> {
  return queryOne<RepositoryRow>('SELECT * FROM repositories WHERE id = $1', [id]);
}

/** Tenant-isolated lookup: a repository only resolves inside its organization. */
export async function getRepositoryForOrg(id: string, organizationId: string): Promise<RepositoryRow | null> {
  return queryOne<RepositoryRow>('SELECT * FROM repositories WHERE id = $1 AND organization_id = $2', [
    id,
    organizationId,
  ]);
}

export async function listRepositories(organizationId: string): Promise<RepositoryRow[]> {
  return query<RepositoryRow>(
    'SELECT * FROM repositories WHERE organization_id = $1 ORDER BY updated_at DESC',
    [organizationId],
  );
}

export async function updateRepositoryBranch(id: string, organizationId: string, branch: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE repositories SET branch = $3, default_branch = $3, updated_at = now()
     WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [id, organizationId, branch],
  );
  return rows.length === 1;
}

/**
 * Whether a column exists and can hold NULL. Returns null when the column is
 * absent, so callers can skip a table that an older database never created.
 */
async function referenceColumn(table: string, column: string): Promise<boolean | null> {
  const row = await queryOne<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  if (!row) return null;
  return row.is_nullable === 'YES';
}

/**
 * Remove a repository together with every row that belongs to it.
 *
 * Child tables declare ON DELETE CASCADE, but production databases can carry
 * constraints that predate that (or that never had it). Deleting the children
 * explicitly inside one transaction keeps removal atomic and correct on either
 * shape: audit/history rows that reference the repository are detached first,
 * then the repository row itself. Without this, a single leftover reference
 * turns the whole request into an opaque 500 and leaves a half-deleted repo.
 */
export async function deleteRepository(id: string, organizationId: string): Promise<boolean> {
  const auditNullable = await referenceColumn('audit_logs', 'repository_id');
  const webhookNullable = await referenceColumn('webhook_deliveries', 'repository_id');

  return withTransaction(async (client: PoolClient) => {
    await detachHistory(client, 'audit_logs', auditNullable, id);
    await detachHistory(client, 'webhook_deliveries', webhookNullable, id);

    // Delete children in dependency order so the statement works even when the
    // database's foreign keys are NOT ON DELETE CASCADE.
    await client.query(
      'DELETE FROM finding_feedback WHERE finding_id IN (SELECT id FROM findings WHERE repository_id = $1)',
      [id],
    );
    await client.query('DELETE FROM findings WHERE repository_id = $1', [id]);
    await client.query(
      'DELETE FROM pr_reviews WHERE pull_request_id IN (SELECT id FROM pull_requests WHERE repository_id = $1)',
      [id],
    );
    await client.query('DELETE FROM pull_requests WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM embeddings WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM source_documents WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM graph_edges WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM graph_nodes WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM indexing_jobs WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM git_commits WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM file_history WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM repository_configs WHERE repository_id = $1', [id]);
    await client.query('DELETE FROM project_conventions WHERE repository_id = $1', [id]);

    const res = await client.query<{ id: string }>(
      'DELETE FROM repositories WHERE id = $1 AND organization_id = $2 RETURNING id',
      [id, organizationId],
    );
    return res.rowCount === 1;
  });
}

/** Detach (or drop) history rows that point at a repository being removed. */
async function detachHistory(
  client: PoolClient,
  table: 'audit_logs' | 'webhook_deliveries',
  nullable: boolean | null,
  repositoryId: string,
): Promise<void> {
  if (nullable === null) return; // table/column not present in this database
  if (nullable) {
    await client.query(`UPDATE ${table} SET repository_id = NULL WHERE repository_id = $1`, [repositoryId]);
  } else {
    await client.query(`DELETE FROM ${table} WHERE repository_id = $1`, [repositoryId]);
  }
}

export async function listRepositoriesByInstallation(installationId: string): Promise<RepositoryRow[]> {
  return query<RepositoryRow>('SELECT * FROM repositories WHERE github_installation_id = $1', [installationId]);
}

export async function updateRepositoryStatus(
  id: string,
  patch: {
    indexStatus?: IndexStatus;
    indexedCommitSha?: string | null;
    parserVersion?: string;
    graphSchemaVersion?: number;
    error?: string | null;
    lastIndexedAt?: Date | null;
  },
): Promise<void> {
  await query(
    `UPDATE repositories SET
       index_status = COALESCE($2, index_status),
       indexed_commit_sha = COALESCE($3, indexed_commit_sha),
       parser_version = COALESCE($4, parser_version),
       graph_schema_version = COALESCE($5, graph_schema_version),
       error = $6,
       last_indexed_at = COALESCE($7, last_indexed_at),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      patch.indexStatus ?? null,
      patch.indexedCommitSha ?? null,
      patch.parserVersion ?? null,
      patch.graphSchemaVersion ?? null,
      patch.error ?? null,
      patch.lastIndexedAt ?? null,
    ],
  );
}

export async function getRepositoryConfig(repositoryId: string): Promise<Record<string, unknown>> {
  const row = await queryOne<{ config_json: Record<string, unknown> }>(
    'SELECT config_json FROM repository_configs WHERE repository_id = $1',
    [repositoryId],
  );
  return row?.config_json ?? {};
}

export async function setRepositoryConfig(repositoryId: string, config: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO repository_configs (repository_id, config_json) VALUES ($1,$2)
     ON CONFLICT (repository_id) DO UPDATE SET config_json = $2, updated_at = now()`,
    [repositoryId, JSON.stringify(config)],
  );
}

// ---------------------------------------------------------------- indexing jobs

export async function createIndexingJob(input: {
  repositoryId: string;
  commitSha: string;
  incremental?: boolean;
  requestId?: string | null;
}): Promise<IndexingJobRow> {
  const row = await queryOne<IndexingJobRow>(
    `INSERT INTO indexing_jobs (repository_id, commit_sha, incremental, request_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.repositoryId, input.commitSha, input.incremental ?? false, input.requestId ?? null],
  );
  return row!;
}

export async function getIndexingJob(id: string): Promise<IndexingJobRow | null> {
  return queryOne<IndexingJobRow>('SELECT * FROM indexing_jobs WHERE id = $1', [id]);
}

export async function getLatestIndexingJob(repositoryId: string): Promise<IndexingJobRow | null> {
  return queryOne<IndexingJobRow>(
    'SELECT * FROM indexing_jobs WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 1',
    [repositoryId],
  );
}

export async function updateIndexingJob(
  id: string,
  patch: Partial<
    Pick<
      IndexingJobRow,
      | 'status'
      | 'stage'
      | 'progress'
      | 'files_processed'
      | 'files_total'
      | 'nodes_created'
      | 'edges_created'
      | 'error'
    >
  > & { startedAt?: Date | null; completedAt?: Date | null },
): Promise<void> {
  await query(
    `UPDATE indexing_jobs SET
       status = COALESCE($2, status),
       stage = COALESCE($3, stage),
       progress = COALESCE($4, progress),
       files_processed = COALESCE($5, files_processed),
       files_total = COALESCE($6, files_total),
       nodes_created = COALESCE($7, nodes_created),
       edges_created = COALESCE($8, edges_created),
       error = $9,
       started_at = COALESCE($10, started_at),
       completed_at = COALESCE($11, completed_at)
     WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.stage ?? null,
      patch.progress ?? null,
      patch.files_processed ?? null,
      patch.files_total ?? null,
      patch.nodes_created ?? null,
      patch.edges_created ?? null,
      patch.error ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
    ],
  );
}

// ---------------------------------------------------------------- pull requests

export async function upsertPullRequest(input: {
  repositoryId: string;
  number: number;
  baseSha: string | null;
  headSha: string | null;
  title: string | null;
  author: string | null;
  status?: string;
}): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO pull_requests (repository_id, github_pr_number, base_sha, head_sha, title, author, status)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'OPEN'))
     ON CONFLICT (repository_id, github_pr_number)
     DO UPDATE SET head_sha = EXCLUDED.head_sha, base_sha = EXCLUDED.base_sha,
                   title = EXCLUDED.title, author = EXCLUDED.author,
                   status = COALESCE($7, pull_requests.status), updated_at = now()
     RETURNING id`,
    [
      input.repositoryId,
      input.number,
      input.baseSha,
      input.headSha,
      input.title,
      input.author,
      input.status ?? null,
    ],
  );
  return row!;
}

export async function createPrReview(input: {
  pullRequestId: string;
  headSha: string;
  reviewVersion?: number;
}): Promise<{ id: string; status: string }> {
  const row = await queryOne<{ id: string; status: string }>(
    `INSERT INTO pr_reviews (pull_request_id, head_sha, review_version)
     VALUES ($1,$2,COALESCE($3,1))
     ON CONFLICT (pull_request_id, head_sha, review_version) DO NOTHING
     RETURNING id, status`,
    [input.pullRequestId, input.headSha, input.reviewVersion ?? 1],
  );
  if (row) return row;
  const existing = await queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM pr_reviews WHERE pull_request_id = $1 AND head_sha = $2 AND review_version = $3',
    [input.pullRequestId, input.headSha, input.reviewVersion ?? 1],
  );
  return existing!;
}

export async function updatePrReview(
  id: string,
  patch: {
    status?: string;
    summary?: string | null;
    aiStatus?: string;
    error?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  },
): Promise<void> {
  await query(
    `UPDATE pr_reviews SET
       status = COALESCE($2, status),
       summary = COALESCE($3, summary),
       ai_status = COALESCE($4, ai_status),
       error = $5,
       started_at = COALESCE($6, started_at),
       completed_at = COALESCE($7, completed_at)
     WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.summary ?? null,
      patch.aiStatus ?? null,
      patch.error ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
    ],
  );
}

export async function insertFindings(
  rows: Array<{
    prReviewId: string;
    repositoryId: string;
    finding: Finding;
  }>,
): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  for (const r of rows) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO findings
        (pr_review_id, repository_id, severity, category, file_path, line, title, explanation, suggestion, confidence, origin, analyzer, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        r.prReviewId,
        r.repositoryId,
        r.finding.severity satisfies Severity,
        r.finding.category,
        r.finding.file,
        r.finding.line,
        r.finding.title,
        r.finding.explanation,
        r.finding.suggestion ?? null,
        r.finding.confidence,
        r.finding.origin ?? 'ai',
        r.finding.analyzer ?? null,
        JSON.stringify({ evidence: r.finding.evidence ?? null }),
      ],
    );
    if (row) out.push(row);
  }
  return out;
}

export async function deleteFindingsForReview(reviewId: string): Promise<void> {
  await query('DELETE FROM findings WHERE pr_review_id = $1', [reviewId]);
}

export async function listFindings(repositoryId: string, limit = 50): Promise<
  Array<{
    id: string;
    severity: string;
    category: string;
    file_path: string;
    line: number;
    title: string;
    explanation: string;
    suggestion: string | null;
    confidence: number;
    origin: string;
    created_at: string;
  }>
> {
  return query(
    `SELECT id, severity, category, file_path, line, title, explanation, suggestion, confidence, origin, created_at
     FROM findings WHERE repository_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [repositoryId, limit],
  );
}

export async function setFindingCommentId(findingId: string, commentId: number): Promise<void> {
  await query('UPDATE findings SET github_comment_id = $2, status = $3 WHERE id = $1', [
    findingId,
    commentId,
    'POSTED',
  ]);
}

// ---------------------------------------------------------------- webhooks

export async function recordWebhookDelivery(input: {
  deliveryId: string;
  eventType: string;
  repositoryId?: string | null;
}): Promise<{ inserted: boolean }> {
  const row = await queryOne<{ delivery_id: string }>(
    `INSERT INTO webhook_deliveries (delivery_id, event_type, repository_id)
     VALUES ($1,$2,$3) ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`,
    [input.deliveryId, input.eventType, input.repositoryId ?? null],
  );
  return { inserted: Boolean(row) };
}

export async function markWebhookProcessed(deliveryId: string, error?: string): Promise<void> {
  await query('UPDATE webhook_deliveries SET status = $2, processed_at = now(), error = $3 WHERE delivery_id = $1', [
    deliveryId,
    error ? 'FAILED' : 'PROCESSED',
    error ?? null,
  ]);
}

export async function getWebhookDelivery(deliveryId: string): Promise<{ status: string } | null> {
  return queryOne<{ status: string }>('SELECT status FROM webhook_deliveries WHERE delivery_id = $1', [deliveryId]);
}

// ---------------------------------------------------------------- audit

export async function writeAuditLog(input: {
  organizationId?: string | null;
  repositoryId?: string | null;
  actor?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO audit_logs (organization_id, repository_id, actor, action, metadata_json, request_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.organizationId ?? null,
      input.repositoryId ?? null,
      input.actor ?? null,
      input.action,
      JSON.stringify(input.metadata ?? {}),
      input.requestId ?? null,
    ],
  );
}

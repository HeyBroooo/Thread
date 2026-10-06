/**
 * PostgreSQL schema (doc §19/§20). All tenant-owned rows are scoped by
 * organization_id / repository_id. pgvector stores semantic embeddings.
 *
 * Migrations are append-only and versioned; never edit a shipped migration.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const M1 = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  name             TEXT,
  github_login     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE TABLE IF NOT EXISTS github_installations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_installation_id BIGINT NOT NULL,
  account_login          TEXT NOT NULL,
  account_type           TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (github_installation_id)
);

CREATE TABLE IF NOT EXISTS repositories (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_installation_id  UUID REFERENCES github_installations(id) ON DELETE SET NULL,
  github_repository_id    BIGINT,
  owner                   TEXT NOT NULL,
  name                    TEXT NOT NULL,
  default_branch          TEXT NOT NULL DEFAULT 'main',
  branch                  TEXT NOT NULL DEFAULT 'main',
  indexed_commit_sha      TEXT,
  index_status            TEXT NOT NULL DEFAULT 'CONNECTED',
  parser_version          TEXT,
  graph_schema_version    INTEGER,
  last_indexed_at         TIMESTAMPTZ,
  error                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, owner, name, branch)
);

CREATE TABLE IF NOT EXISTS indexing_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id    UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'QUEUED',
  stage            TEXT NOT NULL DEFAULT 'QUEUED',
  progress         INTEGER NOT NULL DEFAULT 0,
  files_processed  INTEGER NOT NULL DEFAULT 0,
  files_total      INTEGER NOT NULL DEFAULT 0,
  nodes_created    INTEGER NOT NULL DEFAULT 0,
  edges_created    INTEGER NOT NULL DEFAULT 0,
  checkpoint       JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  incremental      BOOLEAN NOT NULL DEFAULT false,
  error            TEXT,
  request_id       TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_repo ON indexing_jobs(repository_id, created_at DESC);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id              TEXT PRIMARY KEY,
  repository_id   UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  node_type       TEXT NOT NULL,
  name            TEXT NOT NULL,
  qualified_name  TEXT NOT NULL,
  file_path       TEXT,
  language        TEXT,
  start_line      INTEGER,
  end_line        INTEGER,
  content_hash    TEXT,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_repo ON graph_nodes(repository_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_repo_type ON graph_nodes(repository_id, node_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_file ON graph_nodes(repository_id, file_path);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(repository_id, lower(name));

CREATE TABLE IF NOT EXISTS graph_edges (
  id               TEXT PRIMARY KEY,
  repository_id    UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_node_id   TEXT NOT NULL,
  target_node_id   TEXT NOT NULL,
  edge_type        TEXT NOT NULL,
  source_file      TEXT,
  source_line      INTEGER,
  source_column    INTEGER,
  evidence         TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  confidence       REAL NOT NULL DEFAULT 1.0,
  metadata_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_repo ON graph_edges(repository_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(repository_id, edge_type);

CREATE TABLE IF NOT EXISTS source_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id   UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  node_id         TEXT,
  file_path       TEXT NOT NULL,
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  start_line      INTEGER NOT NULL DEFAULT 1,
  end_line        INTEGER,
  language        TEXT,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_docs_repo ON source_documents(repository_id, file_path);

CREATE TABLE IF NOT EXISTS embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id       UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_document_id  UUID REFERENCES source_documents(id) ON DELETE CASCADE,
  node_id             TEXT,
  embedding           vector,
  model               TEXT NOT NULL,
  metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_embeddings_repo ON embeddings(repository_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_node ON embeddings(repository_id, node_id);

CREATE TABLE IF NOT EXISTS pull_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id     UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_pr_number  INTEGER NOT NULL,
  base_sha          TEXT,
  head_sha          TEXT,
  title             TEXT,
  author            TEXT,
  status            TEXT NOT NULL DEFAULT 'OPEN',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, github_pr_number)
);

CREATE TABLE IF NOT EXISTS pr_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_request_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  head_sha        TEXT NOT NULL,
  review_version  INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'QUEUED',
  summary         TEXT,
  ai_status       TEXT NOT NULL DEFAULT 'PENDING',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pull_request_id, head_sha, review_version)
);

CREATE TABLE IF NOT EXISTS findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_review_id      UUID REFERENCES pr_reviews(id) ON DELETE CASCADE,
  repository_id     UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  severity          TEXT NOT NULL,
  category          TEXT NOT NULL,
  file_path         TEXT NOT NULL,
  line              INTEGER NOT NULL,
  title             TEXT NOT NULL,
  explanation       TEXT NOT NULL,
  suggestion        TEXT,
  confidence        REAL NOT NULL,
  origin            TEXT NOT NULL DEFAULT 'ai',
  analyzer          TEXT,
  status            TEXT NOT NULL DEFAULT 'OPEN',
  github_comment_id BIGINT,
  metadata_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(pr_review_id);

CREATE TABLE IF NOT EXISTS finding_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  feedback    TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS git_commits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha           TEXT NOT NULL,
  author        TEXT,
  email         TEXT,
  message       TEXT,
  committed_at  TIMESTAMPTZ,
  UNIQUE (repository_id, sha)
);

CREATE TABLE IF NOT EXISTS file_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  commit_sha    TEXT NOT NULL,
  author        TEXT,
  committed_at  TIMESTAMPTZ,
  change_type   TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_history_repo_file ON file_history(repository_id, file_path);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id   TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  repository_id UUID,
  status        TEXT NOT NULL DEFAULT 'RECEIVED',
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  repository_id   UUID,
  actor           TEXT,
  action          TEXT NOT NULL,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS repository_configs (
  repository_id  UUID PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  config_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_conventions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  examples      JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence    REAL NOT NULL DEFAULT 1.0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const MIGRATIONS: Migration[] = [{ version: 1, name: 'initial_schema', sql: M1 }];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

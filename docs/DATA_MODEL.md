# Data Model Reference

PostgreSQL is the source of truth (spec §18). Migrations are append-only and live in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts); run them with `npm run migrate`.

## Graph

### `graph_nodes`

| column | notes |
| --- | --- |
| `id` | deterministic: `node_<sha1(repo\|type\|qualifiedName\|file)>` — stable across reindexes |
| `repository_id` | tenant scope |
| `node_type` | repository, folder, file, component, function, hook, class, interface, type, enum, constant, variable, route, api_endpoint, service, store, context, middleware, test, package, configuration |
| `name`, `qualified_name` | `qualified_name` is `file#Symbol` for symbols |
| `file_path`, `language` | evidence location |
| `start_line`, `end_line` | 1-based inclusive |
| `content_hash` | `sha256:` of source content |
| `metadata_json` | e.g. `{ method, path, kind }` for endpoints; `{ kind: 'nextjs-app' }` for routes |

### `graph_edges`

| column | notes |
| --- | --- |
| `id` | deterministic: `edge_<sha1(repo\|type\|src\|tgt\|file\|line)>` |
| `source_node_id`, `target_node_id` | must exist (validation enforces) |
| `edge_type` | see README for the full list |
| `source_file`, `source_line`, `source_column` | where the relationship was observed |
| `evidence` | human-readable proof, e.g. `import { cn } from '@/lib/utils'` |
| `extraction_method` | `typescript_ast`, `framework_convention`, `config_analysis`, `git_history`, `static_inference`, `unresolved_dynamic` |
| `confidence` | 0–1, tiers defined in spec §17 |

## Repository & jobs

- `organizations`, `users`, `github_installations` — tenancy and GitHub App identity.
- `repositories` — `index_status` (CONNECTED, QUEUED, INDEXING, PARTIAL, READY, STALE, FAILED), `indexed_commit_sha`, `parser_version`, `graph_schema_version`.
- `indexing_jobs` — stage, progress, counters, `checkpoint`, retry count, commit SHA.
- `repository_configs` — per-repository JSON (`analysis.include/exclude`, `review.*`, custom rules).

## Semantic

- `source_documents` — file content slices used as evidence.
- `embeddings` — `vector` column (pgvector) + `node_id`, `model`, metadata.
- `project_conventions` — detected conventions with **real examples** (`{ filePath, startLine, endLine, snippet }`).

## PR review

- `pull_requests`, `pr_reviews` (unique on `pull_request_id + head_sha + review_version` → idempotency), `findings` (with `origin` = deterministic | ai, `analyzer`, `github_comment_id`), `finding_feedback`.

## Audit & ops

- `webhook_deliveries` — GitHub delivery id → processed (never processed twice).
- `audit_logs` — repository connected, index started/completed/failed, PR reviewed, AI request created, finding posted.
- `git_commits`, `file_history` — git history intelligence (supporting context only).
- `schema_migrations` — applied migration versions.

## Determinism guarantees

Given the same `repository`, `commit SHA`, `parser_version`, `graph_schema_version` and configuration, the graph is reproducible: node and edge ids are pure functions of their content, and no AI output ever influences ids or structure.

## Incremental update rule

When files change, the affected region is exactly:

- every node whose `file_path` is a changed file, plus
- **every edge that touches one of those nodes** (including edges whose own `source_file` did not change).

Missing the second part is the classic incremental-indexing bug; it is implemented in `selectReplacementSet` and covered by `tests/incremental.test.ts`.

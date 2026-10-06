# Codebase Intelligence Platform

> **A persistent codebase intelligence platform that statically builds an evidence-backed graph of a software repository and uses that graph to power an interactive codebase canvas, grounded AI chat, and context-aware GitHub PR review.**

The AI reasons **over** the codebase intelligence graph. The AI does **not** construct the structural graph.

```
GitHub Repository → Deep Static Analysis → Codebase Intelligence Graph
                                              ├── Codebase Canvas (D3)
                                              ├── Grounded Chat ─┐
                                              └── PR Review ─────┴─→ OpenRouter
```

---

## Quick start (no database required)

```bash
npm install

# Analyze a local checkout, build the graph, write a snapshot
npx tsx apps/cli/src/index.ts index <path-to-repo> --repo my-repo

# Inspect the graph
npx tsx apps/cli/src/index.ts graph <path-to-repo> --repo my-repo

# Hybrid search
npx tsx apps/cli/src/index.ts search <path-to-repo> "patient discharge" --repo my-repo

# Ask a grounded question (needs OPENROUTER_API_KEY)
npx tsx apps/cli/src/index.ts ask <path-to-repo> "What happens after the discharge button is clicked?" --repo my-repo
```

Everything above runs **in-memory** — no Postgres, no Redis, no GitHub App. `index` writes `.cbi/graph-<repo>.json`, which later commands reuse.

### Full stack

```bash
cp .env.example .env          # add OPENROUTER_API_KEY at minimum
npm run infra:up              # Postgres (pgvector) + Redis, via Docker
npm run migrate

npm run dev:api               # Bun/Hono-style API on :8787
npm run dev:web               # Next.js + D3 canvas on :3000
npm run dev:indexer           # indexing worker
npm run dev:reviewer          # PR review worker

node scripts/smoke.mjs        # end-to-end API smoke test
```

> Either `bun run <script>` or `npm run <script>` works. The code is Bun-compatible;
> it runs on Node ≥ 20 with `tsx` when Bun is unavailable.

---

## Verify it works

```bash
npm run typecheck     # tsc --noEmit across the whole monorepo
npm test              # 35 tests: parser, golden graph, incremental correctness, AI grounding, PR review E2E
node scripts/smoke.mjs  # with the API running
```

The test suite includes the spec's **incremental correctness** requirement (§22.2): the graph produced incrementally from commit A → B must equal a clean full index of B for the affected graph state.

---

## Monorepo layout

```
packages/
  shared/    types, graph vocabulary, ids, config, logging, secret redaction, source registry, .gitignore matcher
  parser/    ts-morph AST extraction: files, symbols, imports/exports, calls, JSX, HTTP targets, server routes
  analyzer/  framework analysis: routes, API endpoints, architecture summary, conventions, deterministic rules
  graph/     node/edge model, builder, traversal (bounded), PostgreSQL + in-memory stores, validation, incremental
  search/    hybrid ranking (exact · path · text · semantic · graph) + pluggable embeddings
  ai/        provider abstraction, OpenRouter, prompts, context builder, zod schemas, chat + PR review
  reviewer/  diff parsing, changed-symbol mapping, impact analysis, deterministic analyzers, finding validation
  github/    GitHub App JWT/installation tokens, REST client, webhook HMAC verification, git history
  db/        PostgreSQL schema + migrations, data access, bootstrap
apps/
  api/       Hono control plane: repositories, index, graph, search, chat, PRs, webhooks, job queue
  web/       Next.js + D3 Codebase Canvas, chat (split view), repository overview, PR findings
  cli/       local index / graph / search / ask / node / migrate
workers/
  indexer/          end-to-end indexing pipeline
  pr-reviewer/      end-to-end PR review pipeline
tests/              golden fixtures + parser/graph/incremental/AI/review tests
infrastructure/     docker-compose services (Postgres + pgvector, Redis)
docs/               architecture notes and spec mapping
```

---

## The graph is the product

**Nodes:** repository, folder, file, component, function, hook, class, interface, type, enum, constant, variable, route, api_endpoint, service, store, context, middleware, test, package, configuration

**Edges:** CONTAINS, IMPORTS, EXPORTS, CALLS, REFERENCES, RENDERS, USES, DEPENDS_ON, EXTENDS, IMPLEMENTS, NAVIGATES_TO, CALLS_API, DEFINED_IN, READS, WRITES, USES_CONTEXT, USES_STORE, TESTS, CHANGED_WITH, MODIFIED_BY

Every relationship carries **evidence**, an extraction method and a **confidence** value (spec §15/§16/§17). Ask the graph *why* and it answers with the exact source line:

```json
{
  "sourceFile": "src/components/patient/DischargeButton.tsx",
  "sourceLine": 3,
  "evidence": "dischargePatient(1 args) at src/components/patient/DischargeButton.tsx:13",
  "extractionMethod": "typescript_ast",
  "confidence": 0.95
}
```

### Full-stack linking

Client call sites and server route handlers are linked into one endpoint node when the paths align, so a single graph spans the whole stack:

```
DischargeButton ──CALLS──▶ dischargePatient ──CALLS──▶ patientApi ──CALLS──▶ apiClient
                                                                              │
                                                                        CALLS_API
                                                                              ▼
                            POST /api/patient/{id}/discharge  (kind: both)
                                      ▲
                                  IMPLEMENTS
                                      │
                                  POST handler  (app/api/patient/[id]/discharge/route.ts)
```

---

## Grounded chat

Chat is **retrieval-first** (spec §24/§60/§118): search → bounded graph traversal → compact evidence package → OpenRouter → schema validation → **repository validation**.

Hallucination protection (§62) discards references to files that are not in the graph and clamps line ranges; if every reference is rejected the answer is marked `unverified` and the confidence is downgraded. Partial graphs are labelled in the answer (§12).

## PR review

```
webhook → HMAC verify → idempotency → queue → diff → changed files → changed symbols
       → impact (direct/indirect) → deterministic analyzers → AI review → finding validation → GitHub comments
```

Findings are validated before posting (§40): file must exist, line must be within the file, AI findings must point at lines in the PR, severity/category/confidence must be valid, and duplicates are removed. Noise is deliberately bounded (§41). GitHub always owns approval and merge (§3.5).

Deterministic analyzers: circular dependencies, layer violations (UI → data layer), custom architecture rules, duplicate utilities, hardcoded secrets (values are never echoed), dependency additions, `useEffect` without a dependency array.

---

## Security posture

- Webhook signatures verified with constant-time HMAC (`X-Hub-Signature-256`); deliveries are idempotent.
- Secrets are redacted before any AI request or log line (`packages/shared/src/redact.ts`).
- Repository content is treated as **untrusted data**; prompts include explicit injection defenses.
- Only retrieved evidence is sent to the model — never whole repositories or environment files.
- Tenant isolation via `organization_id` / `repository_id` on every query (see `packages/db`).
- The AI never receives shell, filesystem-write, GitHub-write or database-write capability.

---

## Environment

See [.env.example](.env.example). Required for AI features: `OPENROUTER_API_KEY`. Required for persistence: `DATABASE_URL`. `GITHUB_*` are required only for GitHub App integration.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the code maps to the specification, and the explicit non-goals.
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — graph + relational schema reference.

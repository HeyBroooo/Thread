# Architecture & Specification Coverage

This document maps the implementation to the specification and states — honestly — what is complete, what is a working skeleton, and what is deliberately out of scope.

## The one rule that shapes everything

```
SOURCE CODE → STATIC ANALYSIS → GRAPH → SEARCH + TRAVERSAL → RELEVANT EVIDENCE → AI REASONING → EXPLANATION
```

The AI never writes structural facts into the graph. The graph is built by deterministic analysis and stored in PostgreSQL. D3 only renders. OpenRouter only reasons.

## Data flow

```
                    ┌──────────────────────── apps/api (Hono) ────────────────────────┐
GitHub webhook ───▶ │ verify HMAC → idempotent delivery → enqueue review job          │
                    │ REST: repositories · index · graph · search · chat · prs        │
                    └───────────────┬─────────────────────────────┬──────────────────┘
                                    │                             │
                         index job  ▼                    review job ▼
                     workers/indexer                 workers/pr-reviewer
                     parse → analyze → build         diff → changed symbols → impact
                          → validate → persist        → analyzers → AI → validate → comments
                                    │
                                    ▼
                    packages/graph  (GraphStore: PostgreSQL | in-memory)
                                    │
                 packages/search ────┴──── packages/ai (ContextBuilder → OpenRouter)
```

## Coverage matrix

| Spec area | Status | Where |
| --- | --- | --- |
| §7 Monorepo (Turborepo layout) | ✅ structure + `turbo.json` | root, `packages/`, `apps/`, `workers/` |
| §8 Stack (TS, Hono, D3, Next.js, Postgres, pgvector) | ✅ | all |
| §9–§10 Indexing pipeline (11 stages) | ✅ | `workers/indexer/src/pipeline.ts` |
| §11 Real indexing progress | ✅ stage-accurate, no fake progress | `STAGE_PROGRESS`, job queue |
| §12 Partial graph clearly labelled | ✅ | `IndexStatus`, chat `partial` flag |
| §13–§17 Node/edge schema, evidence, confidence | ✅ | `packages/shared/src/types.ts`, `factories.ts` |
| §18 Graph as source of truth | ✅ Postgres; D3 is render-only | `packages/graph` |
| §19–§20 Database schema | ✅ pgvector + all core tables | `packages/db/src/schema.ts` |
| §21 Job state machine | ✅ | `INDEX_STAGES`, PG store |
| §22 Incremental indexing + correctness test | ✅ plan + replacement-set + test | `packages/graph/src/incremental.ts`, `tests/incremental.test.ts` |
| §23 Graph validation | ✅ errors/warnings/orphans | `packages/graph/src/validation.ts` |
| §24–§26 Chat pipeline + response contract | ✅ | `packages/ai/src/chat.ts`, `schemas.ts` |
| §27 AI grounding rules | ✅ prompts + reference validation | `packages/ai/src/prompts.ts` |
| §28–§29 Provider abstraction + OpenRouter | ✅ retries, JSON mode, no key hardcoding | `packages/ai/src/provider.ts`, `openrouter.ts` |
| §30–§42 PR review (webhook → comments) | ✅ | `packages/reviewer`, `workers/pr-reviewer` |
| §36 Impact analysis (direct/indirect) | ✅ bidirectional BFS | `packages/reviewer/src/analysis.ts` |
| §37 Deterministic analyzers | ✅ architecture, duplication, security, dependency, performance | `packages/analyzer/src/rules.ts`, `reviewer/src/analyzers.ts` |
| §38 Convention detection | ✅ from real examples | `packages/analyzer/src/architecture.ts` |
| §40–§41 Finding validation & noise control | ✅ | `packages/reviewer/src/validation.ts` |
| §42 PR idempotency | ✅ unique (pr, head_sha, review_version) | `packages/db`, `pr-reviewer` |
| §43–§49 Canvas (D3, zoom/pan/drag/select/filters/modes) | ✅ | `apps/web/components/GraphCanvas.tsx` |
| §50 Search experience | ✅ hybrid | `apps/web`, `packages/search` |
| §51–§55 API | ✅ | `apps/api/src/app.ts` |
| §56–§58 Security (secrets, tenant isolation, audit, webhook security) | ✅ | `shared/redact.ts`, `db`, `github/webhook.ts` |
| §59–§62 Prompts, context builder, schema + repo validation | ✅ | `packages/ai` |
| §63–§67 Testing | ✅ 35 tests incl. golden graph, incremental, AI, PR E2E | `tests/` |
| §68 Observability (structured logs) | ✅ | `packages/shared/src/logger.ts` |
| §69–§72 Performance, large repos, recovery, caching | ◐ partial | batching + bounded traversal + checkpoints column; full checkpoint/resume is a follow-up |
| §73–§75 Versioning & reproducibility | ✅ parser/graph-schema versions stored | `packages/parser`, `repositories` |
| §76–§78 Repository config & custom architecture rules | ✅ custom rules + config wired into index/review | `RuleConfig`, job handlers |
| §83 Architecture summary | ✅ | `packages/analyzer/src/architecture.ts` |
| §84–§86 Semantic docs, embeddings, hybrid ranking | ✅ pluggable; local deterministic fallback | `packages/search` |
| §87 Traversal limits | ✅ depth/maxNodes/edgeTypes everywhere | `packages/graph/src/model.ts` |
| §88–§95 Multi-tenancy, auth, repo selection, staleness | ◐ org scoping + status + stale detection; OAuth login is a skeleton | `apps/api`, `apps/web` |
| §96–§97 Git history & change coupling | ✅ | `packages/github/src/gitHistory.ts` |
| §100 Design system | ✅ minimal dark, information-dense | `apps/web/app/globals.css` |
| §101–§109 UI routes | ✅ dashboard, overview, canvas, chat, PRs | `apps/web/app` |
| §110–§116 Env, local dev, Docker, production, scaling | ✅ docker-compose + docs | root |
| §130–§135 Unsupported code, generated files, monorepo | ✅ detected & labelled | parser/analyzer |
| §136–§138 API graph & full-stack linking | ✅ | `packages/analyzer/src/framework.ts` |
| §139 Tests as graph nodes | ✅ | builder `TESTS` edges |
| §176–§186 Non-negotiables & build order | ✅ see below | — |

## Non-negotiable constraints — verified

- ❌ No Playwright, browser automation, runtime crawling or network interception anywhere in the product intelligence path.
- ❌ No consumer ChatGPT automation.
- ✅ OpenRouter sits behind `AIProvider`; swapping providers is a one-file change.
- ✅ Graph is built deterministically and stored in PostgreSQL (in-memory for local runs).
- ✅ D3 is visualization only; React owns state.
- ✅ Every important relationship has evidence + confidence.
- ✅ AI output is schema-validated *and* repository-validated before anything is posted.

## Deliberate deviations / staged work

These are honest gaps, not oversights:

1. **Queue.** An in-process `JobQueue` (same surface as a broker-backed queue) is used so the whole system runs with zero infrastructure. Production swaps in Redis/BullMQ; see `apps/api/src/queue.ts`.
2. **Embeddings.** `LocalHashEmbeddingProvider` (deterministic hashing) makes semantic search work offline. Set `EMBEDDING_BASE_URL` + `EMBEDDING_API_KEY` + `EMBEDDING_MODEL` to use a real embeddings endpoint. pgvector storage is implemented.
3. **Auth.** Organization scoping is enforced end-to-end; GitHub OAuth login and the installation flow are represented structurally but not fully built out (`github_installations` table + client methods exist).
4. **Single language.** TypeScript/JavaScript first (§125). Other languages are detected and reported as skipped, never faked.
5. **Styling.** Hand-written CSS with a minimal developer theme rather than Tailwind + shadcn/ui. The component structure is compatible with layering them in.
6. **Checkpoint/resume.** Long jobs persist stage/progress and are restartable at the job level; byte-level resume of a partially parsed batch is a follow-up (§70/§71).
7. **Gitleaks-style secret scanning** currently covers the added lines of a diff; whole-repo history scanning is a follow-up.

## Known limitations of static analysis

The parser cannot resolve `await import(dynamicPath)` or `object[userInput]` calls. These are counted as `unsupportedDynamicRelationships` and never fabricated (spec §131).

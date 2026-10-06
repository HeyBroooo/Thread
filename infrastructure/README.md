# Infrastructure

Local services are defined in [`docker-compose.yml`](../docker-compose.yml).

```bash
npm run infra:up     # start Postgres (pgvector) + Redis
npm run infra:down   # stop them
npm run migrate      # apply migrations (requires DATABASE_URL)
```

| Service | Image | Port | Used for |
| --- | --- | --- | --- |
| postgres | `pgvector/pgvector:pg16` | 5432 | graph, metadata, embeddings |
| redis | `redis:7-alpine` | 6379 | job queue / cache in production |

The API and CLI degrade gracefully to an in-memory graph + repository registry when the database is unreachable, so the platform is always demoable. The API probes connectivity at startup and records the result (`setDatabaseAvailability`) rather than failing per request.

## Production shape

```
Internet → Load Balancer → Web (Next.js) + API (Hono)
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
                 Redis queue                   PostgreSQL + pgvector
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
     Indexer workers      PR reviewer workers
```

Scale the API and the two worker pools independently (indexing is CPU-bound, review is mixed CPU/network/AI). Redis is coordination/cache only — the graph itself is always PostgreSQL.

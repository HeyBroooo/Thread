# Deployment Guide — Codebase Intelligence

This guide describes the runtime requirements and environment variables. For
the supported Vercel setup, follow [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).
For a full self-hosted deployment on an Oracle VM with Cloudflare Tunnel, follow
[ORACLE_CLOUDFLARE_DEPLOYMENT.md](./ORACLE_CLOUDFLARE_DEPLOYMENT.md).

## What the project is

A monorepo:

- `apps/web` — Next.js 15 frontend (React 19, d3, framer-motion). Port 3000 in
  dev, 3001 in the current local setup.
- `apps/api` — Hono API server (`tsx apps/api/src/index.ts`), port 8787 in dev.
  Long-running Node server via `@hono/node-server`.
- `workers/*` — background indexer and PR-reviewer processes, also `tsx`.
- `docker-compose.yml` — Postgres (pgvector) + Redis for local/prod persistence.

Local dev uses `npm run dev:api` + `npm run dev:web`. The API stores the graph
in-memory and persists snapshots to `.cbi/state/` when `DATABASE_URL` is absent;
with `DATABASE_URL` set it uses PostgreSQL for the graph, repos, PRs, findings,
and audit log.

## Before you deploy

1. The app is on a real git branch (not uncommitted local changes). Vercel
   deploys from a branch.
2. `npm run typecheck` and `npm test` pass on that branch.
3. You have at least:
   - A GitHub account and a GitHub App (or a personal token) that can read the
     repositories you want to open in the app.
   - An OpenRouter API key for chat.
   - (Optional) A PostgreSQL + Redis instance. Without them the app degrades to
     in-memory storage and still runs, but indexed repos reset on restart.

### Environment variables you will need

Set these as secrets in whatever host you use. Never commit `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_APP_ID` | For private repos / PR reviews | GitHub App id |
| `GITHUB_PRIVATE_KEY` | For PR reviews via the App | App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | If you want GitHub webhooks | Webhook secret |
| `GITHUB_TOKEN` | Optional | Personal access token fallback for clone + review |
| `APP_URL` | Optional | Public HTTPS web URL; also hosts the logo shown in GitHub review comments |
| `OPENROUTER_API_KEY` | For chat | Model provider key |
| `DATABASE_URL` | Optional (degrades gracefully without) | Postgres DSN for persistent graph/repos/PRs |
| `REDIS_URL` | Reserved | The current job queue is in-process and does not use Redis |
| `PORT` | Set by the host usually | API listen port (8787 dev default) |
| `NODE_ENV` | Recommended | `production` on the deployed API |

`.env.example` in the repo root documents the required App permissions and the
GitHub token fallback. The runtime token can also be saved through the UI via
`POST /api/github/credentials`.

## Vercel deployment

The supported deployment is Vercel for `apps/web` plus an always-on Node API
service. The API's serverless limitations, Vercel project settings, exact
commands, required environment variables, and verification steps are covered
in [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md). Do not deploy the API as a
Vercel Function with the current in-process job queue and PR poller.

## Common issues

- Frontend calls localhost after deploy: `NEXT_PUBLIC_API_URL` was not set, so
  the built client still points at `localhost:8787`. Set it to the deployed API
  URL.
- Indexed repos disappear after a deploy or restart: the graph is in-memory with
  no `DATABASE_URL` and the ephemeral filesystem does not survive. Add
  `DATABASE_URL`, or accept the reset for a demo.
- PR reviews do not post: check `POST /api/github/access` to see whether the App
  or token can comment. The earlier "0 repos / empty permissions" state happened
  when the installation had not accepted the App's updated permissions — install
  or accept the new permissions, then refresh.
- Webhook does not fire: the webhook URL in GitHub must match one of the paths
  the app serves, and `GITHUB_WEBHOOK_SECRET` must match what GitHub sends.
- Chat is unavailable: `OPENROUTER_API_KEY` is missing or unset in the deployed
  API environment.
- Build fails to find workspace packages: dependencies were not installed at the
  monorepo root. Install at the root so the workspace hoisting works.

## Checklist

- [ ] Branch pushed to GitHub
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `.env` variables are set as secrets on the host(s), not committed
- [ ] `NEXT_PUBLIC_API_URL` points at the deployed API
- [ ] GitHub App installed / token saved, if you want PR reviews
- [ ] Webhook URL registered in GitHub, if you want webhook-triggered reviews
- [ ] `DATABASE_URL` set if you want persistent graphs/repos/PRs
- [ ] Frontend loads and the API health endpoint responds
- [ ] A repository can be added and indexed

# Deploy on Vercel

This guide deploys the Next.js frontend to Vercel and runs the API as a
long-lived Node service. This is the supported production shape for the current
code: the API runs a continuous pull-request poller and uses an in-process job
queue, so it must not be treated as a short-lived serverless function.

## Architecture

- Vercel hosts `apps/web` and serves the frontend and static logo assets.
- A long-running Node host runs `@cbi/api` and exposes it at a public HTTPS URL.
- The browser calls the API through a same-origin Vercel rewrite. This keeps the
  API's HttpOnly admin session cookie first-party while the API itself remains
  on the long-running Node host.
- A single admin login protects the site and API. The API stores only a
  scrypt password hash in its environment and issues signed 24-hour sessions.
- PostgreSQL stores repositories, graph data, reviews, and findings across
  restarts. Use a PostgreSQL 16 service with the `pgvector` extension available.
- The current API queue is in-process. Run one API instance; multiple instances
  do not share queued jobs. `REDIS_URL` is not a durable queue adapter in the
  current implementation.

The API starts with `@hono/node-server`, registers job handlers, and starts PR
polling from `apps/api/src/index.ts`. Although the Hono app can handle Fetch
requests, this repository does not include a Vercel API route adapter or a
durable serverless job runner. Deploying the API as a Vercel Function can lose
queued work and does not keep PR polling alive.

## Set up Supabase PostgreSQL

The database package uses the standard PostgreSQL driver and the repository's
versioned migrations; no Supabase client key or database adapter is needed.
Supabase's publishable key is not a database credential and is not used by the
API. Keep the database password and `DATABASE_URL` private.

1. In the Supabase project, confirm the `vector` extension is available/enabled.
   The initial migration also creates `vector` and `pgcrypto`.
2. In **Project Settings → Database → Connect**, copy a PostgreSQL connection
   string. Use the direct connection if the API host supports IPv6; otherwise
   use Supabase's **Session pooler** connection string. The API is long-running,
   so do not use the Transaction pooler for this deployment.
3. Replace the password placeholder locally or in the API host's secret settings.
   URL-encode special characters in the password (for example, `@` becomes
   `%40`). Ensure the URL uses TLS, such as `?sslmode=require` (or
   `&sslmode=require` if the URL already has query parameters).
4. Run the repository migrations from the project root once, using the same
   `DATABASE_URL` that the API will use:

   ```sh
   npm run migrate
   ```

5. Configure `DATABASE_URL` on the API host. Do not add it to Vercel's frontend
   project or prefix it with `NEXT_PUBLIC_`.

The migration command creates the application's tables and records applied
migration versions in `schema_migrations`. It does not migrate data from another
database.

## 1. Deploy the API

Create a long-running Node service on a host such as Railway, Render, Fly.io,
or a VPS. Configure it to use the repository root as its working directory so
the npm workspaces resolve correctly.

Use Node.js 20 or newer. Install the monorepo dependencies, including the root
development dependency `tsx` used by the current API start script:

```sh
npm ci --include=dev
```

Run database migrations once as a release/pre-deploy command:

```sh
npm run migrate
```

Start the API with:

```sh
npm run start --workspace @cbi/api
```

Set these environment variables on the API service:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | The port assigned by the host |
| `DATABASE_URL` | PostgreSQL 16 connection string with `pgvector` available |
| `APP_URL` | The public Vercel URL, for example `https://thread.example.com` |
| `OPENROUTER_API_KEY` | Your model provider key, if using AI chat/reviews |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | GitHub App private key in PEM format |
| `GITHUB_WEBHOOK_SECRET` | The secret configured for the GitHub webhook |
| `CBI_CHECKOUT_DIR` | Optional persistent directory for cloned repositories |
| `ADMIN_USERNAME` | Admin login name; defaults to `Admin` |
| `ADMIN_PASSWORD` | Shared workspace entry password, checked after Google or email identity verification |
| `ADMIN_PASSWORD_HASH` | Optional scrypt hash alternative to storing `ADMIN_PASSWORD` |
| `SESSION_SECRET` | Random secret of at least 32 characters, used to sign 24-hour sessions |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; API host only |
| `RESEND_API_KEY` | Resend API key for customizable magic-link emails |
| `AUTH_EMAIL_FROM` | Optional verified sender; defaults to Resend's onboarding sender |

The GitHub App needs `Contents: read`, `Pull requests: write`, and `Issues:
write`, and must be installed on the repositories you want to index and review.
Configure Supabase's Google provider in the Supabase dashboard (no Google
OAuth credentials are needed in Vercel or Render environment variables). Add
`https://<your-app-host>/api/auth/supabase/callback` to Supabase's allowed
redirect URLs. Google and email sign-in only establish identity; the shared
workspace entry password is still required before repository access is
granted. Set either `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`. Put
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`ADMIN_PASSWORD`, and `SESSION_SECRET` on the API host (Render), never on
Vercel. `SUPABASE_SERVICE_ROLE_KEY` must never be exposed as `NEXT_PUBLIC_*`.
The minimal Render auth settings are `APP_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ADMIN_PASSWORD`, and
`SESSION_SECRET`; `AUTH_EMAIL_FROM` is optional and only needed to use your own
verified Resend sender. The `.env.local` file is for local development and
does not populate Render's environment. In Vercel, set only `API_PROXY_TARGET`
for the API connection.

After deployment, verify the API health endpoint:

```text
https://api.example.com/health
```

It should return `ok: true`, with `database`, `ai`, and `github` showing the
configuration you expect. Keep this API service to one instance until the job
queue is moved to a shared durable broker.

## 2. Deploy the frontend to Vercel

1. Import the GitHub repository into Vercel.
2. In **Project Settings → General**, set **Root Directory** to `apps/web`.
3. Enable **Include source files outside of the Root Directory** so the web
   workspace can use dependencies installed from the monorepo root.
4. Select Next.js as the framework. Keep the detected build command and output
   directory (`next build` and the default `.next`) unless Vercel asks for an
   explicit override.
5. Add this environment variable to the Vercel project:

| Variable | Value |
| --- | --- |
| `API_PROXY_TARGET` | API origin, for example `https://api.example.com` |

The API URL is now used by the Next.js server rewrite and is not exposed to
browser JavaScript. Redeploy after changing it. Do not set it to `localhost` in
a production deployment.

Before deployment, configure the Supabase and Resend credentials plus
`ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`) and `SESSION_SECRET` on the API
host. Supabase owns Google provider setup in its dashboard.

Google or a one-time email link verifies identity; the shared entry password
is then required to enter the workspace. Sessions use HttpOnly, Secure,
SameSite=Lax cookies and expire after 24 hours. GitHub webhook signature
verification remains the authentication mechanism for webhook routes.

Vercel detects the root `package-lock.json` and npm workspace configuration.
If dependency installation fails because Vercel is installing only inside
`apps/web`, set its install command to `npm install --prefix ../..`.

## 3. Point the GitHub App webhook at the API

GitHub must send webhook deliveries directly to the always-on API service, not
to the Vercel frontend or a Vercel preview deployment. Set the GitHub App's
**Webhook URL** to this canonical endpoint:

```text
https://api.example.com/webhooks/github
```

Replace any previous webhook URL that points at `thread.example.com`, a
`*.vercel.app` frontend/preview URL, or an old API host. There are two aliases
for backwards compatibility (`/api/github/webhook` and
`/api/webhooks/github`), but use `/webhooks/github` for new configuration.

In the GitHub App settings:

1. Open **Developer settings → GitHub Apps → ArchThread → General** (or the
   organization-owned GitHub App settings page).
2. In **Webhook**, set **Active** and replace **Webhook URL** with
   `https://api.example.com/webhooks/github`.
3. Set a new **Webhook secret**. Copy that exact value into
   `GITHUB_WEBHOOK_SECRET` on the API host, then restart/redeploy the API.
   Never put this secret in the Vercel frontend environment.
4. Under **Subscribe to events**, enable **Pull request** and save the App.

The handler accepts `opened`, `synchronize`, `reopened`, and `ready_for_review`
pull-request actions. It only queues reviews when the PR's base branch matches
the repository branch tracked in Thread. The App must also be installed on the
repository and have `Contents: read`, `Pull requests: write`, and `Issues:
write` permissions for indexing and comments.

### Keep the URLs straight

| Setting | URL to use | Where it goes |
| --- | --- | --- |
| `API_PROXY_TARGET` | `https://api.example.com` | Vercel server-side API rewrite target |
| `APP_URL` | `https://thread.example.com` | API environment; public logo URL in GitHub comments |
| GitHub App **Webhook URL** | `https://api.example.com/webhooks/github` | GitHub App settings; webhook deliveries |

The webhook secret is separate from all three URLs and belongs only in GitHub
App settings and the API host environment.

## 4. Verify the deployment

1. Open the Vercel URL and connect a public test repository.
2. Confirm indexing completes and the overview, canvas, and chat can load data
   from the API host.
3. In GitHub App settings, open **Advanced → Recent Deliveries**. Confirm the
   latest `ping` delivery succeeded; then open a test PR or push a new commit
   to trigger a supported `pull_request` action.
4. Confirm the API's logs show the webhook was accepted and the review job
   completed. If testing an already-open PR without changing it, use Thread's
   **Post new comment** action to exercise the API and GitHub write permission
   independently of webhook delivery.
5. Confirm the GitHub comment is present. The dashboard's **View comment** link
   opens that exact comment.
6. Confirm the comment header icon loads. It uses
   `https://<your-vercel-host>/logo-128.png`, derived from `APP_URL`.

If the delivery is not successful, check **Recent Deliveries** for the response
code and verify that the webhook URL uses the API hostname, the API is publicly
reachable over HTTPS, and `GITHUB_WEBHOOK_SECRET` exactly matches the GitHub
App secret. A `404` usually means the URL points at Vercel or has the wrong
path; a `503` means the API has no webhook secret configured; a `401` means the
signature does not match. GitHub App permission or installation problems appear
as review/comment errors after a successful webhook delivery, not as a webhook
signature failure.

## Limitations

- The API must remain running to poll GitHub and process in-memory jobs.
- One API instance is supported by the current in-process queue.
- The API's start script uses `tsx`; the Node host must install development
  dependencies or replace that start command with a compiled production build.
- Do not deploy the API as a Vercel Function until a Vercel adapter, durable
  shared queue, and a separate PR polling service are implemented.
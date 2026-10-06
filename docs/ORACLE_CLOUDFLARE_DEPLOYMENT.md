# Deploy the Full App on Oracle and Cloudflare

This guide runs the existing Node application on one Oracle Cloud VM and uses
Cloudflare DNS/Tunnel for public HTTPS. It keeps the current API, repository
indexing, GitHub webhook, PR review, and PostgreSQL behavior; it does not port
the backend to Cloudflare Workers.

## What you need

- An Oracle Cloud account with an eligible Always Free VM available in your
  region. Always Free capacity and account eligibility are controlled by
  Oracle and are not guaranteed.
- A domain whose DNS is managed by Cloudflare. Cloudflare Tunnel and DNS can be
  used on the free plan, but registering a custom domain is not free.
- A Git remote containing this project. This workspace currently has no Git
  remote, so push the code to a repository before cloning it on the VM.
- A GitHub App installed on the repositories you want to index/review, with
  `Contents: read`, `Pull requests: write`, and `Issues: write` permissions.
- An OpenRouter key for AI chat and AI-assisted reviews. Provider usage may
  incur charges even when the VM and Cloudflare are on free plans.

## 1. Create the VM

In Oracle Cloud, create an Ubuntu 22.04 or 24.04 ARM VM using an Always Free
eligible Ampere A1 shape, subject to regional capacity and your account quota.
Allocate persistent boot storage and assign a public IP for SSH administration.

Only SSH needs to be reachable from the internet. The app's web and API ports
are not published on the VM; Cloudflare Tunnel makes outbound connections from
the VM and routes public hostnames to the containers.

Connect over SSH, then install Docker and Compose:

```sh
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in so your account receives the Docker group membership, then
confirm `docker compose version` works.

## 2. Put the project on the VM

Push this workspace to a Git remote first. On the VM:

```sh
git clone <your-project-repository-url> codebase-intelligence
cd codebase-intelligence
```

The production files are [Dockerfile](../Dockerfile),
[docker-compose.production.yml](../docker-compose.production.yml), and
[deploy/oracle.env.example](../deploy/oracle.env.example).

## 3. Create the Cloudflare Tunnel

In Cloudflare Zero Trust, create a named tunnel for the VM using the Docker
connector. Add these two **Public Hostnames** to the tunnel:

| Hostname | Service |
| --- | --- |
| `app.example.com` | `http://web:3000` |
| `api.example.com` | `http://api:8787` |

The service names resolve on the Compose network. Cloudflare creates the DNS
records for the tunnel. Copy the tunnel token from Cloudflare; it is a secret.

Use a stable domain and hostnames. Quick Tunnel `trycloudflare.com` URLs are
temporary and are not suitable for a GitHub App webhook.

## 4. Configure production secrets

Create a private production environment file on the VM:

```sh
cp deploy/oracle.env.example deploy/oracle.env
chmod 600 deploy/oracle.env
```

Edit `deploy/oracle.env` and set:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | A strong random alphanumeric password; the Compose URL uses it directly |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token for the named Cloudflare Tunnel |
| `APP_URL` | `https://app.example.com` |
| `NEXT_PUBLIC_API_URL` | `https://api.example.com` |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | PEM private key on one line with literal `\n` between lines |
| `GITHUB_WEBHOOK_SECRET` | Secret configured in GitHub App settings |
| `OPENROUTER_API_KEY` | Provider key for AI chat/review |

`GITHUB_TOKEN` is optional. Keep `deploy/oracle.env` only on the VM; the
Docker build excludes it, and it must not be committed or pasted into chat.
The public logo in GitHub review comments is served from `APP_URL`.

## 5. Start the complete stack

From the repository root on the VM:

```sh
docker compose --env-file deploy/oracle.env -f docker-compose.production.yml up -d --build
```

This starts:

- The Next.js web app on the internal Compose network.
- The Hono API as one long-running Node process.
- PostgreSQL 16 with pgvector and a persistent Docker volume.
- Persistent repository checkouts and API state volumes.
- The Cloudflare Tunnel connector.

The API applies database migrations during startup. It also starts the PR
poller and processes jobs in an in-process queue, so keep exactly one API
instance; scaling it to multiple replicas would create independent queues and
pollers. Redis is not used by the current queue implementation.

Check service status and API logs:

```sh
docker compose --env-file deploy/oracle.env -f docker-compose.production.yml ps
docker compose --env-file deploy/oracle.env -f docker-compose.production.yml logs --tail=100 api
```

Verify the public API health endpoint at
`https://api.example.com/health`. It should report `ok: true`, `database: true`,
and the expected AI/GitHub configuration.

## 6. Update the GitHub App webhook

In **GitHub → Settings → Developer settings → GitHub Apps → ArchThread →
General**, replace the webhook URL with:

```text
https://api.example.com/webhooks/github
```

Do not use the frontend hostname, a `*.vercel.app` URL, or a temporary Tunnel
URL. Set the same webhook secret in GitHub App settings and
`GITHUB_WEBHOOK_SECRET` in `deploy/oracle.env`, then restart the API:

```sh
docker compose --env-file deploy/oracle.env -f docker-compose.production.yml restart api
```

Subscribe the App to **Pull request** events. The handler processes `opened`,
`synchronize`, `reopened`, and `ready_for_review` actions when the PR base
branch matches the branch tracked by the connected repository.

In the GitHub App's **Advanced → Recent Deliveries**, confirm the `ping`
delivery succeeds. Then open or update a test PR and check the API logs for the
accepted delivery and completed review. For an existing PR, use **Post new
comment** in Thread to test review/comment permissions without waiting for a
new webhook event.

## 7. Keep it healthy

After pushing an update to the Git remote, update the VM:

```sh
git pull
docker compose --env-file deploy/oracle.env -f docker-compose.production.yml up -d --build
```

Back up PostgreSQL regularly and copy backups off the VM. Docker volumes
survive container rebuilds but do not protect against VM deletion or account
loss. The Oracle Always Free tier has no uptime guarantee; monitor disk and
memory use, and keep backups somewhere independent.
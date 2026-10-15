# Authentication and workspace boundaries

Google OAuth through Supabase is the only browser sign-in method. The API exchanges a
PKCE code after validating a signed, expiring, HttpOnly state cookie, checks the verified
Google identity, and creates a versioned session. The session contains the immutable
Supabase user ID, never a client-selected workspace. Old admin, password, email-link,
and development-bypass sessions are rejected. Logout revokes the server session.

A workspace UUID is derived from the issuer and Google user's Supabase ID. All repository
reads and writes resolve inside that workspace. Lists, graph endpoints, source evidence,
job status, indexing, chat, search, pull requests, and reviews use that same boundary.
A foreign repository, graph node, or job returns 404. The `x-organization-id` header has
no authority. Existing shared repositories are not silently claimed by a new account.

GitHub credentials are stored per workspace using authenticated AES-256-GCM encryption,
with the workspace ID bound as authenticated data. The key is derived from SESSION_SECRET.
No token or partial token is returned to the browser. Shared environment tokens and
unlinked GitHub App installations are excluded from tenant requests. Rotating the
session secret signs users out and requires reconnecting saved GitHub credentials.

Web API users cannot choose filesystem checkout paths. Each clone has its own workspace
and checkout directory. Re-indexing and review jobs use the repository's stored path.
Source reads check real paths, refuse escaping symlinks, and cap file sizes. Inventory
skips symlinks by default; workspace manifests cannot traverse outside the checkout.
The application statically parses code and never runs repository package scripts.

Cookie-authenticated mutations require the configured APP_URL origin; cross-site requests
are rejected. Private responses use no-store. Requests have a 1 MiB body limit. Account
mutations have a per-process limit of 30/minute; OAuth initiation is also limited. Signed
GitHub webhooks are the only unauthenticated mutation endpoints. Web responses include
frame, MIME, referrer, permissions, and CSP headers. CSP retains inline scripts for the
Next.js renderer, so it is defense in depth rather than a claim that all XSS is impossible.

## Deployment

- Set a random SESSION_SECRET of at least 32 characters and HTTPS APP_URL. Keep Supabase
  service-role credentials on the API host. Enable Google's provider and exact callback URLs.
- PostgreSQL is mandatory in production. Startup fails if migrations or the database fail;
  production cannot silently fall back to shared process memory. Migration 2 adds session
  and encrypted credential tables. The development file fallback is for a single API process.
- Keep the database and API origin private behind the web proxy where possible. Terminate
  HTTPS at a trusted proxy that replaces forwarded-address headers. Apply shared gateway
  rate limits for multiple replicas; in-process limits are not a distributed quota.
- Existing global PATs and GitHub App installations are not proof of user authorization.
  Private repository access requires a user's own GitHub token until verified installation
  linking is implemented. The CLI's local-checkout workflow remains separate.
- The web middleware delegates session verification to the API and fails closed if that
  service is unavailable. Only the landing page, login page, and static sample are public.

## Verification scope

Automated tests cover Google PKCE callback validation, unsafe redirects, retired login
methods, expired/tampered sessions, logout replay, two-user repository/graph/job isolation,
forged tenant headers, CSRF, encrypted credential isolation, and filesystem boundaries.
A temporary two-account PostgreSQL check verifies database-backed list/object isolation
and logout revocation; its records are removed afterward. The browser checks cover login,
the canvas position, and the borderless FAQ.

The real Google account consent/callback was not completed because browser access to
accounts.google.com was declined. Tests exercise the callback with mocked Supabase token
responses. A successful dependency audit reports known advisories only; it is not a claim
of a complete penetration test or that the application has no unknown vulnerabilities.


GitHub repository connection uses the App installation flow followed by OAuth with state and PKCE. Signed HttpOnly state binds callbacks to the current Google session, workspace, repository and branch. An installation ID alone is never trusted: GitHub's user/installation repository intersection is checked before linking and again before credential minting. Installation tokens are limited by `repository_ids` and explicit permissions; user read access cannot gain bot writes. Manual PAT endpoints return 410 and shared environment tokens are ignored. OAuth access and refresh credentials are AES-GCM encrypted per workspace, held server-side, and refreshed without exposing them to the browser. Installation or user revocation fails closed on subsequent GitHub operations. Automatic reviews are gated in manual, polling, webhook, and execution paths. App connection refuses broader declared repository permissions than Contents read, Pull requests write, Issues write and Metadata read.

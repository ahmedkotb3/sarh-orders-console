# SARH Orders Console

A deliberately small full-stack order operations console. React + TypeScript/Vite, Express, Prisma, and PostgreSQL. It focuses on server-enforced idempotent creation, correct large-list querying, and backend authorization rather than UI polish.

## Requirements

- Node.js 20+
- PostgreSQL 14+ running locally
- npm 10+ (npm workspaces)

## Run locally

1. Create a local database, for example:

   ```sql
   CREATE DATABASE sarh_orders;
   ```

2. Copy `server/.env.example` to `server/.env` (the root `.env.example` is also provided for reference) and set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters. Prisma and the server run from the `server/` workspace, so the workspace-local env file is loaded automatically.
3. Install and initialize:

   ```bash
   npm install
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

4. Open `http://localhost:5173`. API is at `http://localhost:4000`.

The seed script creates 50,000 orders, 1–5 line items per order, one admin, and one agent. It is deterministic enough for repeatable local development; re-running it clears and recreates demo data.

### Demo accounts

- Admin: `admin@sarh.local` / `AdminPass123!`
- Agent: `agent@sarh.local` / `AgentPass123!`

These are local-only seeded credentials. Never reuse them outside this exercise.

## Commands

```bash
npm run db:generate   # Prisma Client
npm run db:migrate    # create/apply local schema migration
npm run db:seed       # 50,000 orders + demo users
npm test              # API/idempotency integration tests (requires PostgreSQL)
npm run build         # TypeScript and production frontend build
```

The integration tests use `DATABASE_URL` and create real database records. Run them against a dedicated local test database, not production.

## R1: list performance and correctness

- `GET /api/orders` supports `q`, `status`, `sortBy=createdAt|amount`, `sortOrder=asc|desc`, `page`, and `pageSize`.
- The server caps `pageSize` at 100 and returns only one page; it never sends all 50,000 orders to the browser.
- PostgreSQL indexes cover `(status, createdAt, id)`, `(status, amount, id)`, `(createdAt, id)`, and `(amount, id)`. Customer name/email use `pg_trgm` GIN indexes for substring search. The migrations enable `pg_trgm` and restore both trigram indexes after the legacy cleanup migration.
- Frontend filter changes abort the prior fetch and use a monotonically increasing request sequence. The sequence guard prevents stale responses from committing even if cancellation arrives too late.
- Results are associated with their exact filter/sort/page query, so rows from the prior query are hidden immediately while a changed query is loading.
- Offset pagination is intentionally retained for simplicity at 50k. At multi-million scale, switch to keyset/cursor pagination, especially for deep pages.

## R2: server-side duplicate prevention

The client creates one UUID idempotency key per submission and saves the exact payload and key in `sessionStorage` before sending; an unconfirmed submission is restored after reload and its fields stay locked until retry resolves it. The server stores the key in a unique database column and in a separate durable ledger, transactionally with the order and its line items. PostgreSQL's unique constraints are the concurrency authority: concurrent requests using the same key cannot create two orders. A duplicate request returns the original order. Reusing a key with a different normalized payload returns `409 Conflict`. Ledger entries survive order deletion, so retrying a deleted order's key returns `410 Gone` rather than recreating it.

At most one order is committed for a given key while its idempotency ledger entry is retained. Clearing browser session storage and resubmitting with a fresh key is a different operation: without a business identity rule, the server cannot infer that two different keys describe one real-world order. Keys are globally scoped and retained indefinitely in this demo; production should define tenant/user scoping, abuse controls, canonicalization, and explicit ledger retention.

### Parallel proof

With the app configured and migrated:

```bash
npm run test -w server -- --run src/idempotency.test.ts
```

The test sends two concurrent create requests with the same key and verifies that exactly one database order exists. It also checks that both responses resolve to the same order id, rejects payload changes for a reused key, and confirms that deleting an order does not release its key. This is an integration test against PostgreSQL, not a mocked unit test.

## Code review: authentication middleware

Problems found and fixes:

1. **Hard-coded JWT secret** — moved to `JWT_SECRET` environment configuration and fail-fast validation.
2. **`jwt.decode()` trusts unsigned claims** — replaced with `jwt.verify()` and explicit algorithm, issuer, audience, and expiration validation.
3. **Query-string token fallback** — removed; tokens are accepted only from the `Authorization: Bearer` header to reduce exposure through logs, browser history, and referrers.
4. **Admin authorization only in React** — added backend `requireRole("admin")`; UI visibility is not a security boundary.
5. **Plaintext password lookup** — passwords are stored as bcrypt hashes and verified with `bcrypt.compare`.
6. **No token lifetime / claim discipline** — tokens expire after 15 minutes and the subject is reloaded from the database so a stale or forged role claim cannot grant privileges.
7. **No robust request validation** — Zod validates login and order input; unknown or malformed values are rejected.
8. **Uncaught route/database errors** — centralized error middleware returns safe messages without exposing SQL details.
9. **No throttling on login** — this exercise does not implement persistent rate limiting; production should add rate limiting and monitoring at the API edge.

### Token storage (2–3 sentences)

This demo stores the access token in `sessionStorage`, not in a URL or long-lived `localStorage`, so it survives a page refresh in the same tab but is scoped to that tab session. It does **not** prevent XSS from reading the token while the page is running, nor does it protect against a compromised device; closing the tab ends the session storage lifetime. A production alternative is a short-lived access token in a Secure, HttpOnly, SameSite cookie with appropriate CSRF defenses, depending on the deployment and threat model.

## Product question: “Delete all cancelled orders”

I would ask what operational problem the button solves, whether cancelled orders have legal/audit retention requirements, who may use it, and whether “all” includes historical orders across tenants. If she cannot answer, I would not ship a bulk hard-delete: propose a preview/count, explicit date/status scope, permission check, audit log, and reversible archive/export first. Then confirm retention and recovery expectations before any permanent deletion.

## What I skipped and why

- No optional slow stats endpoint or optimistic create; the mandatory R1/R2/security paths have priority.
- No bulk-delete endpoint; the prompt asks for product judgment, not implementation.
- No refresh-token flow, MFA, persistent login throttling, or production secrets manager; this is a local exercise, and these require deployment-specific policy.
- The list uses offset pagination at this dataset size. The scale memo describes moving to keyset pagination and operational hardening.
- UI styling is intentionally minimal; correctness and reviewer reproducibility matter more than visual polish.

## Evidence to capture

1. List showing the seeded orders and status/search controls.
2. Change the status filter quickly three times; show that only the final filter's result is rendered.
3. Run the parallel idempotency test and capture the passing output.

Keep commit history meaningful (schema, seed, API, UI, tests/docs) rather than submitting a single opaque generated commit.

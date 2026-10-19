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

2. Copy `server/.env.example` to `server/.env` (the root `.env.example` is also provided for reference), set `DATABASE_URL`, and generate a random `JWT_SECRET` of at least 32 characters (for example, `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`). The server rejects the blank or known example placeholder. Prisma and the server run from the `server/` workspace, so the workspace-local env file is loaded automatically.
3. Install and initialize:

   ```bash
   npm install
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

4. Open `http://localhost:5173`. API is at `http://localhost:4000`.

The seed script creates 50,000 orders, 1–5 line items per order, one admin, and one agent. It also creates matching idempotency-ledger entries. It is deterministic enough for repeatable local development; re-running it clears and recreates demo data, including the ledger.

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

1. **Hard-coded JWT secret** — the secret now comes from `JWT_SECRET`; startup fails if it is missing or shorter than 32 characters.
2. **`jwt.decode()` trusts unsigned claims** — tokens are verified with HS256 and the configured issuer and audience. Required subject, role, and expiration claims are checked.
3. **No token expiration** — access tokens expire after 15 minutes.
4. **Query-string token fallback** — removed; only `Authorization: Bearer` is accepted, avoiding token exposure through URLs, logs, browser history, and referrers.
5. **Authorization only in the React UI** — destructive order deletion now requires the `admin` role on the server; hiding a button is not an authorization boundary.
6. **Plaintext password comparison/storage** — user passwords are stored as bcrypt hashes and checked with `bcrypt.compare`.
7. **Trusting the role in token claims** — middleware reloads the user and current role from the database for each authenticated request, so an old role claim cannot preserve revoked access.
8. **Malformed login/order inputs accepted without validation** — Zod schemas validate these payloads before database operations.
9. **Authentication failures mixed with server failures** — invalid tokens return `401`, while database lookup errors reach the centralized error handler instead of being mislabeled as bad credentials.
10. **Known example secret passed the length check** — the placeholder has been removed from `.env.example` and is explicitly rejected if retained in an existing `.env`.

The seed creates both `admin@sarh.local` and `agent@sarh.local` accounts with bcrypt-hashed passwords.

### Token storage (2–3 sentences)

This demo stores the access token in `sessionStorage`, which persists across refreshes in the same tab and is cleared when that tab session ends. Because the app sends it explicitly in an Authorization header rather than having the browser attach it automatically, this reduces CSRF risk, but it does not protect against XSS, which can read the token.

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

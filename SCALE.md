# SCALE.md — from 50,000 to 5 million orders

## Change

**Database and query shape.** Keep PostgreSQL as the source of truth, but move the list API from offset pagination to keyset pagination using a stable compound cursor (for example `(createdAt, id)`). Sorting by amount needs its own cursor tuple and deterministic tie-breaker. Preserve bounded page sizes and add `EXPLAIN (ANALYZE, BUFFERS)` checks for the actual workload before adding indexes blindly. Substring search with `pg_trgm` may remain useful, but I would measure write amplification and query plans; if search becomes a major workload, I would evaluate a dedicated search index only after establishing latency and freshness requirements.

**Multi-country usage.** Put the API and database in a deliberate regional topology based on data residency and latency requirements. I would not casually deploy active-active writes to two countries: order creation and idempotency require a clear consistency boundary. Start with one authoritative write region, regional application instances where safe, and a documented failover plan. Measure p95/p99 latency, error rate, connection pool saturation, slow queries, and replica lag.

**Reliability and security.** Add request correlation IDs, structured logs with PII redaction, metrics, alerts, login rate limits, MFA/SSO integration, and a secret manager. Define idempotency-key retention and tenant scoping. Add an audit trail for sensitive operations and an explicit order retention policy. Use least-privilege database credentials and tested backups/restore drills. Introduce a connection pooler if concurrent traffic and connection counts justify it.

## Keep

- Database-enforced uniqueness and transactional creation; never move the duplicate guarantee into the browser.
- Server-side authorization and schema validation.
- Latest-request-wins semantics in the client.
- Explicit indexes tied to measured query patterns, bounded API responses, and a reproducible seed/test setup.
- A small separation between route handlers, validation, and persistence logic; three developers do not need a microservice for every domain concept.

## Refuse to build (without evidence and safeguards)

I would refuse a one-click, irreversible “delete all cancelled orders” action without a confirmed retention policy, scoped preview, authorization, audit trail, and recovery plan. I would also refuse cross-region multi-master writes just to reduce a few milliseconds without a conflict/consistency design. I would not add a search cluster, event bus, or microservices solely because the row count reached five million; the workload, operational ownership, and measured bottleneck must justify each new failure mode.

## Team of three

Agree on API contracts and migration ownership early. Keep CI checks for typecheck/build, integration tests against PostgreSQL, and the parallel idempotency proof. Use small reviewable commits and a short runbook so one developer can support the system without tribal knowledge.

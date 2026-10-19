# DECISIONS.md

## 1. R2 — Idempotency at the database boundary

**Decision:** A logical submission gets one UUID key; the browser persists its exact payload and key in `sessionStorage`, restores it after reload, and retries with the same key.  
The API validates and normalizes input, then transactionally writes the order, its items, and a permanent idempotency-ledger row protected by database uniqueness.  
Same-key/same-payload retries return the original order; same-key/different-payload requests return `409`, and keys remain reserved even after order deletion.  
The additive migration backfills existing orders, and the seed script rebuilds ledger rows with seeded orders so deletion/reseed cannot release their keys.  
**Alternative:** disable the submit button and deduplicate in process memory; rejected because retries, reloads, process restarts, and multiple API instances bypass that protection.  
**Limits:** the guarantee is per key; a fresh key can represent a duplicate real-world purchase, and clearing browser storage can lose the retry key; keys are global and retained indefinitely here, so production needs scoping and retention rules.  
**Proof:** the parallel integration test asserts one order row, with payload-conflict and post-delete checks.

## 2. R1 — Offset pagination now, cursor pagination at scale

**Decision:** Use server-side offset pagination, capped at 100 rows, with deterministic sorting and indexes for status/date/amount.  
Customer name/email substring search uses PostgreSQL `pg_trgm` indexes; the API never returns the full table.  
**Alternative:** fetch every row and virtualize it in the browser; rejected because that still transfers and stores the full dataset.  
Offset pagination is easy to reason about at 50,000 rows and supports predictable page navigation.  
Deep offsets cost more and concurrent inserts can shift page membership, so this is not the final design at multi-million scale.  
At that scale I would adopt keyset pagination and validate index choices with representative `EXPLAIN (ANALYZE, BUFFERS)` plans.

## 3. State and request race handling

**Decision:** Keep query and page state local to the React screen, abort obsolete requests, and guard commits with a monotonically increasing request id.  
Cancellation is a resource optimization, not the correctness proof: a response may race with abort or already be complete.  
The sequence guard ensures only the newest request can update the list, loading state, or error state.  
**Alternative:** add Redux Toolkit Query or a global server-state cache; rejected because this console has one primary resource and no shared-cache requirement.  
If multiple screens need shared cached data or invalidation, I would reassess TanStack Query or RTK Query.  

## AI use

I used an AI assistant to compare idempotency approaches, challenge request-race edge cases, and review the index strategy. I implemented and validated the choices in this repository and can explain the transaction, uniqueness constraints, and request sequence guard.

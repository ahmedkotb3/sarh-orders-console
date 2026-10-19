# DECISIONS.md

## 1. R2 — Idempotency at the database boundary

**Decision:** Each logical create submission gets a UUID idempotency key. The browser saves the exact payload and key in `sessionStorage` before sending, restores an unconfirmed submission after reload, and locks its fields after an ambiguous outcome so a retry cannot accidentally get a new key. A synchronous submit guard also suppresses duplicate event handling. The API validates the payload, hashes its normalized form, and transactionally inserts the order, line items, and a durable idempotency-ledger row. Both the order key and ledger key have database uniqueness constraints; the database, not the UI or process memory, arbitrates concurrent requests.

For the same key and normalized payload, the API returns the existing order. Reusing the key with different content returns `409 Conflict`. The ledger is deliberately not related to the order by a cascading foreign key: deleting an order cannot release its key. A retry for a deleted order returns `410 Gone` instead of silently recreating it. Existing order keys are backfilled into the ledger by migration.

**Alternative considered:** Disable the submit button and deduplicate requests in an in-memory map. **Why rejected:** UI guards do not cover network retries, reloads, multiple tabs, process restarts, or concurrent API instances; in-memory state is neither shared nor durable.

**Guarantee and limits:** For a key, at most one order can be committed, including concurrent requests and requests after order deletion. The browser retains the key and payload across reloads in the same tab session, but users or browsers can clear session storage; an HTTP retry must carry the original key. The API cannot infer that two different keys represent the same real-world purchase, so a client that discards the key and submits again with a new one can create a second order. Keys are globally scoped and the ledger is retained indefinitely in this demo; production must choose tenant/user scoping, abuse controls, and a deliberate ledger retention policy. Deleting ledger entries would end the guarantee for those keys.

**Proof:** `server/src/idempotency.test.ts` fires two identical create requests concurrently with one key and asserts both responses identify the same order and exactly one row exists. It also verifies payload-conflict rejection and that a deleted order's key remains reserved.

AI use: I used an AI assistant to help outline options and review edge cases; I inspected and adapted the implementation and can explain the transaction and unique constraints.

## 2. R1 — Offset pagination now, cursor pagination at scale

**Decision:** Use bounded server-side offset pagination (maximum 100 rows), explicit sorting, and database indexes for the required filters.  
**Alternative considered:** Fetch every order and virtualize the table in the browser.  
**Why rejected:** Virtualization reduces DOM work but still transfers and stores the entire dataset, wastes bandwidth, and delays first results.  
Offset pagination is straightforward for 50,000 seeded rows and gives reviewers predictable page navigation.  
The API never returns the full table; name/email substring search uses `pg_trgm`, while status/date/amount have B-tree indexes.  
Deep offsets become expensive and page membership can shift during concurrent inserts; at millions of rows I would move to keyset pagination.  
AI use: I asked an AI assistant to challenge the query/index strategy; I would verify plans with `EXPLAIN (ANALYZE, BUFFERS)` on representative data before production.

## 3. State and request race handling

**Decision:** Keep the current query state and displayed page in local React state, cancel obsolete requests with `AbortController`, and guard commits with a monotonically increasing request id.  
**Alternative considered:** Add Redux Toolkit Query or a shared global client cache.  
**Why rejected:** This screen has one primary server resource and no demonstrated cross-route cache invalidation requirement; another state layer adds setup without improving the key correctness guarantee.  
Abort is a resource optimization, not the correctness proof: cancellation can race with a response or a transport may already have completed.  
The sequence guard ensures only the latest request may update the visible list or loading/error state.  
If the app grows to multiple screens with shared cached resources, I would reconsider TanStack Query or RTK Query.  
AI use: I used an AI assistant for adversarial race-condition scenarios, then implemented both cancellation and a sequence guard rather than relying on abort alone.

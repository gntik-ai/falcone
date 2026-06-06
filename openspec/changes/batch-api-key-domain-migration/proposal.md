## Why

`services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs::main:9-37` issues a single unbounded `SELECT * FROM api_keys` with no `WHERE` clause, no `LIMIT`, and no cursor or keyset pagination. The entire `api_keys` table across all tenants is loaded into application memory in one shot. Already-classified rows (`privilege_domain IS NOT NULL`) are discarded after transfer, wasting memory and I/O proportional to table size. Additionally, the update path at `main:25` issues one `UPDATE` round-trip per unclassified row, producing N sequential network calls for the initial migration run. This is a reliability and performance defect — not a tenant-isolation defect, since the migration intentionally visits all tenants' keys — but the combined unbounded SELECT and per-row UPDATEs create a memory and latency cliff that scales linearly with table size (source finding: bug-018).

## What Changes

- Add `WHERE privilege_domain IS NULL` to the SELECT so only unclassified rows are fetched, eliminating the in-application discard of already-classified rows (`services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs::main:13`).
- Replace the single global SELECT with a keyset-paginated batch loop: `WHERE privilege_domain IS NULL AND id > $lastId ORDER BY id ASC LIMIT $batchSize`. The batch size is configurable via the `APIKEY_DOMAIN_MIGRATION_BATCH_SIZE` environment variable (default 500) so memory use is bounded regardless of table size.
- Replace the per-row UPDATE round-trips (currently at `main:25`) with a multi-row UPDATE per batch, preserving the `AND privilege_domain IS NULL` idempotency guard.
- All correctness invariants are preserved: global scope (all tenants), idempotency on rerun, event emission via `services/provisioning-orchestrator/src/events/privilege-domain-events.mjs::buildAssignedEvent` for `pending_classification` rows.

## Capabilities

### New Capabilities

- `iam-admin`: Bounded-memory, keyset-paginated API-key privilege-domain migration that eliminates the full-table-in-memory SELECT and per-row UPDATE round-trips, while preserving idempotency and event emission correctness.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the iam-admin capability spec -->

## Impact

- **Primary fix target:** `services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs::main:13,17-20,25` — replace unbounded SELECT + per-row UPDATE with filtered keyset-paginated batch loop with batched UPDATE.
- **Read-only reference:** `services/provisioning-orchestrator/src/events/privilege-domain-events.mjs::TOPICS`, `::buildAssignedEvent:16` — event emission must remain intact for `pending_classification` rows.
- **Breaking:** No. Final classification outcome and per-pending-row event emission are preserved; only internal execution strategy changes.
- Black-box suite: six scenarios (A–F) covering: only unclassified rows processed, bounded batch size, idempotency on rerun, all rows eventually classified, event emission preserved, configurable batch size.

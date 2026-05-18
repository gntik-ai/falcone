## Why

Three smells in the async-operation retry/idempotency layer of `services/provisioning-orchestrator/` make recovery flows fragile and the audit chain incomplete. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B3.4** (`async-operation-transition.mjs:14-30`) — `failure_code_mappings` is loaded into a module-scoped cache that is never invalidated. A hot edit of the mappings table (or a deploy that updates it but does not restart all pods) leaves stale classifications in flight for hours.
- **B3.5** (`idempotency-key-repo.mjs:20-34`) — TOCTOU between `findActive(expires_at > NOW())` and `insertOrFind(expires_at <= NOW())`. A request landing exactly at expiry sees an active record that the insert has already replaced; idempotency briefly violates.
- **B3.6** (`async-operation-orphan-sweep.mjs:31-44`) — orphan-recovery transitions operations to `failed` with code `ASYNC_OPERATION_RECOVERED` but does not insert a `retry_attempts` row. The audit chain loses the system-recovery event, so post-incident review cannot reconstruct which operations were recovered by which sweep.

## What Changes

- Add a TTL to the `failure_code_mappings` cache (default 60 seconds) plus an explicit `invalidate()` triggered by an `mappings_updated` event.
- Atomic upsert in `idempotency-key-repo` using `INSERT … ON CONFLICT (key) DO NOTHING RETURNING *` so the find/insert is a single statement.
- Insert a synthetic `retry_attempts` row with `source='orphan_sweep'` for each operation recovered by `async-operation-orphan-sweep` so the audit chain is complete.

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: tightens failure-classification cache freshness, idempotency-key TOCTOU window, and the audit chain for orphan-sweep recovery.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs`, `services/provisioning-orchestrator/src/repositories/idempotency-key-repo.mjs`, `services/provisioning-orchestrator/src/actions/async-operation-orphan-sweep.mjs`, `services/provisioning-orchestrator/src/repositories/retry-attempts-repo.mjs`.
- Migrations: no schema change (the `retry_attempts.source` column is assumed enum-extendable; if not, add `'orphan_sweep'` to the CHECK).
- Breaking changes: none — internal hardening.
- Out of scope: state-machine guard for retry-override (B3.1), retry_attempts ordering on retry race (B3.2), manual-intervention republish (B3.3) — all covered by `fix-c1-async-operations`.

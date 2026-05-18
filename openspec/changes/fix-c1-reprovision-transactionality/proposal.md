## Why

Reprovision in `services/provisioning-orchestrator/` is the highest-impact apply path in the platform — it mutates Keycloak, Postgres, Mongo, Kafka, OpenWhisk, and object storage in one operation. Its current implementation lacks transactional discipline and downgrades critical validation. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B4.1** (`reprovision.mjs:208-262`) — appliers run sequentially with no overall transaction. A failure in domain N leaves domains 1..N-1 applied; the audit row reads `partial` but the only "rollback" is that audit row. The platform persists a half-reprovisioned tenant.
- **B4.2** (`reprovision.mjs:327, :256-261`) — lock release and `failLock` swallow Postgres failures. On a database outage during release the lock survives to its 120s TTL; within that window a concurrent reprovision can interleave with the half-finished first apply.
- **B4.3** (`validate.mjs:105-109`) — schema-checksum mismatch is logged and ignored; the validate endpoint still returns success with `schema_checksum_match=false`. There is no strict mode for callers (e.g., reprovision itself) that must refuse on mismatch.
- **G19** — the migrate pipeline tolerates any same-major version but has no migration functions to chain because `schemas/migrations/` is empty.

Together these mean any reprovision failure can leave the platform in an unrecoverable, partially-applied state, and validation cannot catch the artifact drift that would prevent it.

## What Changes

- Introduce a compensation registry per applier: each applier MUST publish an `undo()` closure that the orchestrator invokes in reverse order on failure of any subsequent domain. Track outcomes in `config_reprovision_audit_log` with per-domain `applied|rolled_back|rollback_failed`.
- Replace the swallow-and-warn lock-release paths with explicit error propagation; on release failure, escalate to a fence (`lock_state='broken'`) so subsequent attempts wait the full TTL instead of racing.
- Add a `strict` flag to `validate.mjs` (default `true` when called from `reprovision`); on `strict=true` a checksum mismatch returns `result='invalid'`.
- Add a no-op `v1.0.0 -> v1.0.0` migration entry so the chain-validator has a non-empty registry and any future schema bumps will fail loudly until a migration is supplied (G19).

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: tightens reprovision transactionality, lock-release error handling, validation strict mode, and migration registry hygiene.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/reprovision.mjs`, `services/provisioning-orchestrator/src/actions/validate.mjs`, all files under `services/provisioning-orchestrator/src/appliers/`, `services/provisioning-orchestrator/src/schemas/migrations/`.
- Migrations: no SQL migration (audit-log columns may be added in a follow-up); applier API change is internal.
- Breaking changes: applier authors must implement `undo()` or opt into the orchestrator's default "fail closed" behaviour; `tenant-config-validate` callers that relied on success with `schema_checksum_match=false` must set `strict=false` explicitly.
- Out of scope: identifier-map substring collision (B4.4), admin-token caching (B4.5), safe-url bare-internal-http (B4.6), `_ident` control-character handling (B4.7) — all covered by `harden-c1-reprovision-applier-safety`.

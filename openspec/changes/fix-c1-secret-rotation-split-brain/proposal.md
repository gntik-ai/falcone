## Why

Secret rotation in `services/provisioning-orchestrator/` writes and deletes vault material outside the database transaction boundary, exposes a sentinel value to concurrent readers, has an incomplete forbidden-key check, and loses events on offset commit. Each is independently confirmed; together they produce a vault/DB split-brain that compromises the secrets pipeline. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B5.1** (`secret-rotation-initiate.mjs:79, 87`) — vault write happens before/outside the DB transaction. If vault succeeds and DB commit fails, the vault version is orphaned — secret data exists in the vault that no row references.
- **B5.2** (`secret-rotation-expiry-sweep.mjs:24`) — vault delete is called after DB commit with no rollback. If vault delete fails, the DB row reads `expired` but the vault still holds the secret.
- **B5.3** (`secret-rotation-initiate.mjs:50, 81`) — `vault_version` is inserted as `-1` and updated to the real id only after the vault write succeeds. A concurrent reader between insert and update sees the `-1` sentinel.
- **B5.4** (`secret-version-state.mjs:7, 33`) — `ensureNoSecretMaterial` is a whitelist regex over `value|data|password|token|key|secret`; obvious aliases like `secret_value`, `api_key`, `client_secret` slip past and can be persisted in `secret_metadata`.
- **B5.5** — privilege-domain, function-privilege, and scope-enforcement event recorders (each `~:39-50`) call `commitOffsets` even when the row insert failed. Audit events are silently dropped while the consumer reports clean.

## What Changes

- Rewrite `secret-rotation-initiate` so the DB row is inserted first with `vault_version=NULL` and `state='pending'`, vault is written second, and a final transactional `UPDATE` sets `vault_version=real_id, state='active'`; on vault failure the pending row is deleted in a clean compensating txn.
- Rewrite `secret-rotation-expiry-sweep` to use a `RETURNING` pattern: DB transitions the row to `expiring`, vault deletes, then a second transaction commits `expired`. A failed vault delete leaves the row `expiring` so the next sweep retries.
- Stop returning rows with `vault_version=-1`: secret read paths MUST treat a NULL or sentinel `vault_version` as "not yet visible".
- Replace `ensureNoSecretMaterial` with an explicit denylist plus an allow-only-typed-fields schema check on `secret_metadata` writes; reject any field whose name matches `*_value|*_secret|*_token|*_password|*_key` after normalisation.
- In all three Kafka recorders, only `commitOffsets` after the DB insert returns success; on failure log + retry the message.

## Capabilities

### Modified Capabilities

- `secret-management`: tightens vault/DB transactionality for rotation initiate and expiry, removes the sentinel-visibility window, hardens the no-secret-material check, and fixes offset-commit-after-failure in the Kafka recorders.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs`, `services/provisioning-orchestrator/src/actions/secret-rotation-expiry-sweep.mjs`, `services/provisioning-orchestrator/src/models/secret-version-state.mjs`, the three event recorders (`privilege-domain-event-recorder.mjs`, `function-privilege-denial-recorder.mjs`, `scope-enforcement-event-recorder.mjs`).
- Migrations: yes — add `vault_version NULLABLE`, `state CHECK ('pending','active','grace','expiring','expired','revoked')` if not already constrained.
- Breaking changes: callers that read `vault_version=-1` will now see `NULL`; consumers must filter `state IN ('active','grace')` when fetching active material.
- Out of scope: last-admin guard race (B5.6), credential-rotation idempotency (B5.7), function-privilege workspace-null (B5.8), cursor tuple collision (B5.9) — covered by `harden-c1-secret-rotation-audit`.

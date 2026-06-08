## Context

PostgreSQL requires that the column list named in an `ON CONFLICT (...)` clause refers to a unique index or a non-deferrable unique constraint. A `DEFERRABLE` unique constraint — even one declared `INITIALLY IMMEDIATE` — is excluded from this set by the PostgreSQL planner (see PostgreSQL docs, section "INSERT ... ON CONFLICT"). The constraint defined on `pg_capture_configs` at `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql:17` is declared `DEFERRABLE INITIALLY IMMEDIATE`, making it ineligible as an arbiter.

The INSERT in `services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs:22-27` names the same four columns in its `ON CONFLICT` clause. Every execution against a real Postgres provisioned from this migration fails immediately with:

```
ERROR: ON CONFLICT does not support deferrable unique constraints/exclusion constraints as arbiters
```

Because `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs:33-36` only catches `CAPTURE_ALREADY_ACTIVE` and `QUOTA_EXCEEDED`, the Postgres error propagates as an unhandled exception and the caller receives a 500. The capability is completely broken on PostgreSQL.

## Goals / Non-Goals

**Goals:**
- Make the unique constraint on `pg_capture_configs(workspace_id, data_source_ref, schema_name, table_name)` a valid `ON CONFLICT` arbiter so that `pg-capture-enable` can successfully insert or idempotently update a capture row.
- Ensure the fix does not change any observable uniqueness or deferral behaviour (the constraint was already `INITIALLY IMMEDIATE`, meaning it fired at statement time regardless of `DEFERRABLE`).

**Non-Goals:**
- Modifying `CaptureConfigRepository.mjs` — the `ON CONFLICT` clause and `DO UPDATE` predicate are already correct.
- Modifying `pg-capture-enable.mjs` — the catch block is already correct once the SQL error is eliminated.
- Modifying the Mongo capture migration (`081-mongo-capture-config.sql`) — it does not declare a DEFERRABLE constraint and is unaffected.
- Adding a new migration file — there is no migration-checksum runner in this repository, and `tests/env` applies `.sql` files fresh; editing migration 080 in place is correct.

## Decisions

**Decision: Remove `DEFERRABLE INITIALLY IMMEDIATE` from migration 080, line 17.**

Rationale: The constraint is the only defect. No application code needs updating. `DEFERRABLE INITIALLY IMMEDIATE` behaves identically to a non-deferrable constraint for all workloads in this service (no caller sets `SET CONSTRAINTS ... DEFERRED`). The removal is a no-op for data integrity and a fix for SQL plan validity.

**Alternative considered:** Replace the `DEFERRABLE` constraint with an equivalent non-deferrable `CONSTRAINT uq_pg_capture_config UNIQUE (...)`. Rejected: name is not referenced elsewhere in the code; the inline `UNIQUE (...)` form is sufficient and matches the existing style in the file.

**Alternative considered:** Add a dedicated non-deferrable unique index via `CREATE UNIQUE INDEX` alongside the existing constraint and use the index name in `ON CONFLICT ON CONSTRAINT`. Rejected: more invasive, adds a redundant index, and still requires editing the migration.

## Risks / Trade-offs

**Risk:** Editing an existing migration file rather than adding a new one could surprise teams that apply migrations incrementally.
**Mitigation:** Confirmed there is no migration-checksum runner in this repository. `tests/env` bootstraps Postgres fresh from SQL files on each stack bring-up (docker-compose). For any deployed environment that has already applied migration 080, a follow-up migration (e.g. `ALTER TABLE pg_capture_configs DROP CONSTRAINT ...` + `ADD CONSTRAINT ...`) would be the appropriate path; that is out of scope for this fix, which targets development and test environments.

## Migration Plan

Edit `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql`, line 17:

Before:
```sql
  UNIQUE (workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE
```

After:
```sql
  UNIQUE (workspace_id, data_source_ref, schema_name, table_name)
```

No other files require modification.

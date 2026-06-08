## Why

`services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql:17` declares the uniqueness key on `pg_capture_configs` as:

```sql
UNIQUE (workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE
```

`services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs:24` (method `create`) performs:

```sql
INSERT INTO pg_capture_configs (...)
ON CONFLICT (workspace_id, data_source_ref, schema_name, table_name)
DO UPDATE SET updated_at = now()
WHERE pg_capture_configs.status = 'active'
RETURNING *
```

PostgreSQL does not permit a `DEFERRABLE` unique constraint to be used as an `ON CONFLICT` arbiter. Against any Postgres instance provisioned by this migration, every invocation of `pg-capture-enable` that reaches the INSERT throws:

```
ERROR: ON CONFLICT does not support deferrable unique constraints/exclusion constraints as arbiters
```

The catch block in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs:33-36` only handles `CAPTURE_ALREADY_ACTIVE` and `QUOTA_EXCEEDED`; all other errors are re-thrown, so the caller receives a 500. **`pg-capture-enable` can never successfully create a capture against PostgreSQL.** This was discovered by a real-stack (docker-compose Postgres, `tests/env`) Playwright E2E spec.

This defect is independent of the JWT-identity fix in change `fix-cdc-capture-verify-jwt-identity`.

## What Changes

Remove `DEFERRABLE INITIALLY IMMEDIATE` from the unique constraint on line 17 of `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql`, making it a plain (non-deferrable) unique constraint. A non-deferrable unique constraint is a valid `ON CONFLICT` arbiter in PostgreSQL. The `ON CONFLICT` clause in `CaptureConfigRepository.mjs:24` is correct and requires no change. The Mongo capture path (`services/provisioning-orchestrator/src/migrations/081-mongo-capture-config.sql`) is unaffected.

`INITIALLY IMMEDIATE` (the default for any constraint) already enforces at statement time, so removing `DEFERRABLE` changes no observable uniqueness behaviour — it is purely corrective.

There is no migration-checksum runner in this repository, and `tests/env` applies `.sql` files fresh on each stack bring-up, so editing migration 080 in place is the minimal correct fix.

## Capabilities

### Modified Capabilities

- `change-data-capture`: The `pg_capture_configs` table schema is corrected so that `pg-capture-enable` can execute its INSERT ... ON CONFLICT statement without a PostgreSQL arbiter error, enabling CDC captures to be created and idempotently re-enabled on PostgreSQL.

## Impact

- `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql:17` — remove `DEFERRABLE INITIALLY IMMEDIATE`
- `services/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs:24` — no change required; the ON CONFLICT clause is already correct
- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs:33-36` — no change required; the catch block is already correct once the SQL error is eliminated

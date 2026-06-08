## 1. Add Failing Real-Stack E2E Spec

- [x] 1.1 Create `tests/e2e/specs/issues/fix-pg-capture-insert-conflict-arbiter.spec.ts` modelling the `tests/env` Postgres pattern used by `tests/e2e/specs/issues/validate-reprovision-postgres-ddl.spec.ts`. The spec must:
  - Provision a fixture workspace and data source reference.
  - Invoke `pg-capture-enable` with a valid `data_source_ref` and `table_name` and assert the response is HTTP 201 (not 500).
  - Invoke `pg-capture-enable` a second time for the same `(workspace_id, data_source_ref, schema_name, table_name)` and assert the response is NOT HTTP 500 (idempotent ON CONFLICT path).
- [x] 1.2 Run the E2E spec against the current schema and confirm it FAILS (red) with the Postgres arbiter error.

## 2. Apply the Fix

- [x] 2.1 In `services/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql`, line 17, change:
  ```sql
    UNIQUE (workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE
  ```
  to:
  ```sql
    UNIQUE (workspace_id, data_source_ref, schema_name, table_name)
  ```
  No other files require modification.

## 3. Verify

- [x] 3.1 Re-run `tests/e2e/specs/issues/fix-pg-capture-insert-conflict-arbiter.spec.ts` against a fresh `tests/env` Postgres stack and confirm both scenarios pass (green).
- [x] 3.2 Run `bash tests/blackbox/run.sh` and confirm all 135 tests remain green.
- [x] 3.3 Run the E2E spec for `fix-cdc-capture-verify-jwt-identity` (all 4 scenarios) and confirm it also passes — that change's E2E was previously unable to reach the INSERT due to this arbiter defect.

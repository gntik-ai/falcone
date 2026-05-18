## Why

The OpenAPI spec history table has a schema constraint that mathematically
prevents storing more than two versions per workspace. From
`openspec/audit/cap-j1-openapi-sdk-builder.md`:

- **B1** (`services/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql:11`)
  — the constraint `UNIQUE (workspace_id, is_current) DEFERRABLE INITIALLY
  DEFERRED` treats `(workspace_id, FALSE)` as a unique tuple. The first
  regeneration succeeds (one `FALSE`, one `TRUE`); the third regeneration
  must flip the prior `TRUE` to `FALSE`, which produces two `FALSE` rows and
  violates the constraint at COMMIT. The deferred mode allows the violation
  mid-transaction but the check at COMMIT fails. **The repo cannot maintain
  spec history.**
- **G10** (G-S3.1) — same constraint flagged as `CRITICAL`; `getSpecHistory`
  always returns ≤ 2 rows regardless of the requested limit.

## What Changes

- New migration `089-workspace-openapi-versions-history.sql` that:
  1. Drops the broken `UNIQUE (workspace_id, is_current)` constraint.
  2. Replaces it with a partial unique index:
     `CREATE UNIQUE INDEX workspace_openapi_versions_current_uq ON
     workspace_openapi_versions (workspace_id) WHERE is_current = TRUE`.
  3. Adds a `CHECK (is_current OR is_current IS FALSE)` no-op guard so the
     column stays NOT NULL (existing schema already has NN).
- Update `services/openapi-sdk-service/src/spec-version-repo.mjs` to rely on
  the partial-index semantics; no code change is strictly required because
  the transaction in `insertNewSpec` (`:27-47`) already does the UPDATE-
  then-INSERT in one transaction.
- Add a contract test that performs three successive `insertNewSpec` calls
  in separate transactions and asserts `getSpecHistory` returns three rows.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: OpenAPI spec history persists every
  generation; the schema enforces single-current via a partial unique index.

## Impact

- Affected code: new
  `services/openapi-sdk-service/migrations/089-workspace-openapi-versions-history.sql`,
  no required runtime changes; the test for `getSpecHistory` may be added
  under `tests/integration/`.
- Migrations: yes, drops one constraint and adds one partial unique index.
  Pre-flight asserts no workspace currently has two `is_current = TRUE`
  rows; aborts if found.
- Breaking changes: none for callers; previously-broken third-and-onward
  regenerations now succeed.
- Out of scope: history retention / archival of old spec rows — addressed
  if/when storage becomes a concern.

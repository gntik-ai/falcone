## Why

The archived `add-vector-search` change (design decision D7) deferred two concrete gaps that leave
operators exposed to a silent, runtime failure mode:

1. **No pre-flight in the provisioning path.** When a `database_per_tenant` tenant requests the
   `vector` Postgres extension, `postgres-applier.mjs::_createResource()` (case `'extensions'`)
   issues `CREATE EXTENSION IF NOT EXISTS "vector"` unconditionally. If the target Postgres image
   does not ship pgvector's control files (e.g. the default `bitnami/postgresql:17.2.0`), the
   statement fails with a cryptic `ERROR: could not open extension control file` at runtime —
   after the provisioning record has already been written. The applier already holds a live `query`
   function against the target DB; `pg_available_extensions` is available and cheap to query. A
   pre-flight check before `CREATE EXTENSION` converts a confusing runtime error into a clear,
   actionable configuration validation error surfaced at provisioning time.

2. **Comment-only note in the chart.** `charts/in-falcone/values.yaml` lines 1698-1704 contain a
   `NOTE (add-vector-search)` comment explaining the image gap, but expose no machine-readable
   value an operator can override. Replacing that comment with a real, documented chart value gives
   operators a named override (e.g. `postgresql.dedicatedTenantImage`) and makes the operator
   contract explicit without changing the default deployment behavior.

Both gaps are high-priority: the first is a fail-open provisioning defect for a placement-restricted
feature; the second is the only operator-visible instrument for fixing it.

## What Changes

- **`postgres-applier.mjs`** gains a `_checkExtensionAvailable(name, query)` helper. Inside
  `_processResource` for `resourceType === 'extensions'`, before calling `_createResource`, the
  applier runs `SELECT 1 FROM pg_available_extensions WHERE name = $1`. If no row is returned,
  it returns an `'error'` result with an actionable message naming the extension and, for `vector`
  specifically, directing the operator to configure a pgvector-capable image for the dedicated-DB
  tenant Postgres instance. `CREATE EXTENSION` is not issued.
- In dry-run mode, the same pre-flight runs and its result is reported as a configuration
  validation error (`'error'` action — the implementation reuses the live action vocabulary
  rather than introducing a separate `'would_error'`, consistent with how `_validateAll` already
  reports validation errors regardless of `dryRun`), so operators can detect the problem without
  attempting any DDL.
- **`charts/in-falcone/values.yaml`** gains a documented `postgresql.dedicatedTenantImage` key
  (sub-fields `repository`, `tag`) beneath the existing `postgresql.image` block, replacing the
  current comment-only `NOTE (add-vector-search)`. The key documents the recommended
  pgvector-capable image (`pgvector/pgvector`, `pg17`) as an operator-level override and is
  cross-referenced from the `dpf_01regulateddedicated` profile comment. The default deployment
  (bitnami) is unchanged; the value is a named operator contract, not a runtime-templated image.
- **`openspec/specs/data-services/spec.md`** receives a MODIFIED delta on the existing
  "pgvector extension enablement is gated on database_per_tenant placement" requirement (its
  exact header is preserved; the body adds the `pg_available_extensions` pre-flight) plus an
  ADDED requirement for the documented chart value.
- **`charts/in-falcone/values.schema.json`** is updated so `postgresql.dedicatedTenantImage` is a
  schema-enforced key (the `postgresql` property becomes an `allOf` of the shared `component`
  definition + an explicit `dedicatedTenantImage` referencing `#/definitions/image`).

## Capabilities

### New Capabilities

### Modified Capabilities

- `data-services`: Extends the existing pgvector extension enablement requirement with a
  `pg_available_extensions` instance-capability pre-flight, dry-run reporting, and a documented
  chart value for the dedicated-DB tenant Postgres image.

## Impact

- `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` — new exported
  `_checkExtensionAvailable` helper + `_unavailableExtensionMessage`; modified `_processResource`
  extension branch (pre-flight before `_createResource`).
- `charts/in-falcone/values.yaml` — new `postgresql.dedicatedTenantImage` key; updated comment +
  cross-reference on the `dpf_01regulateddedicated` profile.
- `charts/in-falcone/values.schema.json` — `postgresql` becomes `allOf` (component + explicit
  schema-enforced `dedicatedTenantImage` → `#/definitions/image`).
- `openspec/specs/data-services/spec.md` — MODIFIED requirement (pre-flight) + ADDED requirement
  (chart value).
- Tests: new real-stack tests in `tests/env/executor/postgres-extension-preflight.test.mjs`
  (executor slice already runs on `pgvector/pgvector:pg16`); new unit test for the pure helper
  (`postgres-applier.preflight.test.mjs`) + extended applier reprovision tests.

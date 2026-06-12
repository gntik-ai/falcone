## Context

The provisioning orchestrator's `postgres-applier.mjs` reconciles Postgres metadata resources
(schemas, tables, views, extensions, grants) for a tenant. The extension reconcile path
(`_processResource`, case `'extensions'`, lines 316-319) checks whether the extension is already
installed via `SELECT extname, extversion FROM pg_extension WHERE extname = $1`, then calls
`_createResource` which issues `CREATE EXTENSION IF NOT EXISTS "<name>"` (line 367).

This path has no availability check. If the target Postgres instance's image does not ship the
extension's control file (e.g. `vector.control` for pgvector), the `CREATE EXTENSION` statement
fails with `ERROR: could not open extension control file`. This error surfaces as an unhandled
exception caught by the outer `try/catch` in `apply()` (lines 217-230), producing an opaque
`action: 'error'` result with the raw Postgres message — no guidance on how to fix the
deployment.

The request-level gate in
`services/adapters/src/postgresql-governance-admin.mjs::POSTGRES_EXTENSION_CATALOG` (lines 16-41)
already restricts the `vector` extension to `placementModes: ['database_per_tenant']`. That gate
is a catalog-level policy check before any SQL is generated. The pre-flight introduced here is a
complementary, instance-capability check that happens inside the applier, after a live DB
connection is available.

The real-stack executor slice (see memory note `executor-realtime-engine.md` and PR #347) already
runs tests against a `pgvector/pgvector:pg16` image. That infrastructure is the right harness for
real-stack tests of the pre-flight.

The chart currently documents the image gap only as a comment (`charts/in-falcone/values.yaml`,
lines 1698-1704: `NOTE (add-vector-search)`). No machine-readable value exists for operators to
override. The `dpf_01regulateddedicated` profile (`values.yaml`, lines 750-776) references
`pvc_01pgdedicated` as a provider capability but does not name an image; dedicated-DB instances
are operator-provisioned, not chart-templated StatefulSets.

## Goals / Non-Goals

**Goals:**

- Add a `_checkExtensionAvailable(name, query)` helper to `postgres-applier.mjs` that queries
  `SELECT 1 FROM pg_available_extensions WHERE name = $1` and returns a boolean.
- Invoke the helper inside `_processResource` for `resourceType === 'extensions'` before any
  call to `_createResource`, failing closed if the extension is unavailable.
- Produce an actionable error message: for `vector`, name the extension and instruct the operator
  to configure a `pgvector/pgvector:pgNN` (or equivalent) image for the dedicated-DB tenant.
- Honor `dryRun`: a dry-run pass that encounters an unavailable extension SHALL report the
  configuration error and NOT issue DDL — the pre-flight runs regardless of `dryRun`.
- Replace the comment-only `NOTE (add-vector-search)` in `charts/in-falcone/values.yaml` with a
  real `postgresql.dedicatedTenantImage` key, default `pgvector/pgvector:pg17`, with an inline
  comment explaining the operator contract.
- Write real-stack tests (tests/env) and a unit test for the pure helper.

**Non-Goals:**

- Automatic image substitution: the chart value is an operator guide, not a rendered template
  switch. Dedicated-DB instances are not StatefulSets spawned per-tenant by the chart.
- Extending the pre-flight to non-extension resource types.
- Adding the pre-flight to the `teardown` path (DROP EXTENSION does not depend on image content).
- Changing the default `postgresql.image` (bitnami/postgresql:17.2.0) — that is the shared
  cluster image, not the dedicated-tenant image.

## Decisions

### D1: Query pg_available_extensions rather than catching the CREATE EXTENSION error

**Decision**: Run `SELECT 1 FROM pg_available_extensions WHERE name = $1` before `CREATE
EXTENSION`, not a try/catch on the `CREATE EXTENSION` itself.

**Rationale**: Catching the error is possible but yields these problems: (a) the raw Postgres
error message is opaque to operators; (b) `CREATE EXTENSION IF NOT EXISTS` does not error if the
extension is already present, so a catch path would require distinguishing "already installed"
from "image lacks control file" by parsing error codes — fragile; (c) a failed `CREATE EXTENSION`
may leave a partial transaction state depending on the connection mode. The
`pg_available_extensions` catalog view is cheap (one system-catalog row per extension whose
control file is present on disk), always available without elevated privileges, and its absence is
unambiguous: the image does not ship the extension.

**Alternative considered**: `pg_available_extension_versions` (more columns, same semantics for
the presence check). Rejected in favor of `pg_available_extensions` for brevity; either view
returns zero rows when the extension is absent.

### D2: Pre-flight runs in both live and dry-run modes

**Decision**: The `_checkExtensionAvailable` query executes regardless of `dryRun`.

**Rationale**: The purpose of a dry-run is to surface what would happen, including configuration
errors, before committing any DDL. Silently skipping the pre-flight in dry-run mode would give
operators a false "would_create" result, hiding the configuration problem until a live run. The
pre-flight is a read-only catalog query; it is safe to run in dry-run mode.

The result action for an unavailable extension in dry-run is `'error'` (same as live mode). The
`_resolveStatus` logic already handles a mix of errors and other counts; dry-run status is driven
by the presence of errors in the results, not by the `dryRun` flag for this case.

### D3: Placement-awareness is already enforced upstream; the pre-flight is instance-capability only

**Decision**: The pre-flight in `postgres-applier.mjs` does NOT re-check placement mode. It only
checks instance capability via `pg_available_extensions`.

**Rationale**: The placement-mode gate (`POSTGRES_EXTENSION_CATALOG::placementModes`) is enforced
at the API/adapter layer before any provisioning call. By the time `postgres-applier.mjs` runs,
the placement is already validated. Adding a second placement check in the applier would duplicate
logic and create a maintenance coupling. The instance-capability check is orthogonal and
complementary: it answers "does this specific Postgres instance support the extension?" not "is
this extension allowed for this placement mode?".

### D4: Chart value is an operator contract, not a runtime-templated image

**Decision**: `postgresql.dedicatedTenantImage` in `values.yaml` is a documented key with a
recommended default, not wired into any chart template or Helm hook that would automatically
substitute it for dedicated-DB StatefulSets.

**Rationale**: Dedicated-DB instances in `dpf_01regulateddedicated` (values.yaml lines 750-776)
are operator-provisioned external Postgres instances, not per-tenant StatefulSets rendered by the
in-falcone chart. The chart has no template logic to spin up per-tenant StatefulSets for
`database_per_tenant` tenants. Introducing such logic is beyond the scope of this change and
could interfere with the operator's own provisioning automation. The value's purpose is to give
operators a named, greppable anchor in the chart they already manage, with a clear default and
explanation, so they know which image to use when provisioning dedicated-DB tenant instances.

### D5: Test strategy — real-stack tests/env on the pgvector image

**Decision**: Real-stack tests in `tests/env/` cover both the success path (extension available,
created) and the failure path (extension absent, error returned, no DDL issued). The executor
real-stack slice already uses `pgvector/pgvector:pg16` (#347); tests for this change can be wired
into the same compose profile or a dedicated extension-preflight test group.

**Rationale**: The pre-flight is a live DB query. Unit-testing the `_checkExtensionAvailable`
helper in isolation (with a mock query function) covers the pure logic; real-stack tests verify
the actual `pg_available_extensions` behavior against the two relevant images (pgvector image for
the success path; a plain Postgres image or a fake extension name for the failure path). In-memory
store unit tests cannot catch SQL bugs here — the bug class being fixed is precisely a missing
real-DB interaction.

## Risks / Trade-offs

- **Performance**: One additional catalog query per extension provisioning call. This is
  negligible (system catalog, indexed, sub-millisecond) and is a one-time provisioning cost, not
  a per-request cost.
- **pg_available_extensions race**: If an extension's control file is added to the image between
  the pre-flight query and `CREATE EXTENSION`, the pre-flight would have returned false but the
  extension is now installable. This is not a real concern in practice (images are immutable in
  production) and the worst outcome is a false negative on the first attempt (operator re-runs
  provisioning after updating the image).
- **Chart value semantics**: The `postgresql.dedicatedTenantImage` key has no chart template
  consumer in v1. Operators must manually apply it to their own provisioning tooling. This is
  documented explicitly in the inline comment.
- **Dry-run error semantics**: Reporting an `'error'` action in dry-run mode (rather than
  `'would_error'`) means the dry-run `status` field will be `'error'`. Callers that treat
  dry-run results as purely informational need to handle `status: 'error'` from a dry-run. This
  is consistent with the existing behavior for validation errors in `_validateAll` (lines 188-205),
  which also return `status: 'error'` regardless of `dryRun`.

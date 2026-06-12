## MODIFIED Requirements

### Requirement: pgvector extension enablement is gated on database_per_tenant placement

The system SHALL enforce that the `vector` extension (already present in
`POSTGRES_EXTENSION_CATALOG` at
`services/adapters/src/postgresql-governance-admin.mjs` lines 36-41 with
`placementModes: ['database_per_tenant']`) can only be enabled for workspaces whose
data plane uses `database_per_tenant` placement, and SHALL propagate the placement
check through the `validatePostgresGovernanceRequest` path so that the existing
`authorizedEntry.placementModes` guard rejects the request before any SQL is sent.

In addition to the API-layer placement gate above, the system SHALL query
`pg_available_extensions` on the target Postgres instance before issuing
`CREATE EXTENSION` for any extension requested via the provisioning path
(`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs::_processResource`, case
`'extensions'`). The system SHALL NOT issue `CREATE EXTENSION` when the extension is absent from
`pg_available_extensions`. Instead, the system SHALL emit a configuration validation error result
(action `'error'`) that names the extension. For the `vector` extension specifically, the error
message SHALL instruct the operator to provision a pgvector-capable Postgres image (e.g.
`pgvector/pgvector:pgNN`) for the dedicated-DB tenant instance, because the default
`bitnami/postgresql:17.2.0` image referenced in `charts/in-falcone/values.yaml` does not bundle
the pgvector control files.

The pre-flight check is a `SELECT 1 FROM pg_available_extensions WHERE name = $1` query executed
via the same injected `query` function already used by `_processResource` for existence checks
(`SELECT extname, extversion FROM pg_extension WHERE extname = $1`). This query is cheap (catalog
scan on a small system table), does not mutate state, and resolves early — before any
`_createResource` call — so no partial-apply state can accumulate. The placement gate rejects
requests at the API layer for wrong placement modes; the pre-flight gate rejects requests at the
provisioning layer when the instance's image lacks the extension's control files. The pre-flight is
skipped when the extension is already installed (its presence in `pg_extension` proves the image
ships it), so already-provisioned tenants see no behaviour change.

#### Scenario: Extension enabled for dedicated-DB workspace passes validation

- **WHEN** a governance request to enable the `vector` extension is submitted with a
  profile carrying `placementMode: "database_per_tenant"`
- **THEN** `validatePostgresGovernanceRequest` returns `ok: true` and
  `buildPostgresGovernanceSqlPlan` emits
  `CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public"`

#### Scenario: Extension enablement for schema-per-tenant workspace is rejected by the validator

- **WHEN** a governance request to enable the `vector` extension is submitted with a
  profile carrying `placementMode: "schema_per_tenant"`
- **THEN** `validatePostgresGovernanceRequest` returns `ok: false` with a violation
  message identifying the placement mode incompatibility, and no SQL plan is produced

#### Scenario: Extension not present in pg_available_extensions is rejected without CREATE EXTENSION

- **WHEN** `_processResource` is asked to provision an extension whose name is absent from the
  target instance's `pg_available_extensions` catalog (i.e. `SELECT 1 FROM
  pg_available_extensions WHERE name = $1` returns zero rows)
- **THEN** the provisioning path SHALL return an `action: 'error'` result for that resource,
  SHALL NOT call `_createResource` for that extension, and SHALL NOT issue `CREATE EXTENSION IF
  NOT EXISTS` to the database

#### Scenario: Vector extension unavailability error names the extension and instructs on image

- **WHEN** `_processResource` is asked to provision the `vector` extension and
  `pg_available_extensions` does not contain `vector`
- **THEN** the error message SHALL include the string `vector`, SHALL reference the need for a
  pgvector-capable Postgres image (e.g. `pgvector/pgvector:pgNN`), and SHALL NOT contain a raw
  Postgres error or stack trace

#### Scenario: Available extension is still created normally

- **WHEN** `_processResource` is asked to provision an extension whose name IS present in
  `pg_available_extensions` (i.e. the query returns at least one row) and the extension is not
  yet installed
- **THEN** the provisioning path SHALL proceed to call `_createResource` and issue
  `CREATE EXTENSION IF NOT EXISTS "<name>"` exactly as before, returning `action: 'created'`

#### Scenario: Dry-run reports the would-be configuration error without issuing DDL

- **WHEN** `apply` is invoked with `dryRun: true` and the extension is absent from
  `pg_available_extensions`
- **THEN** the provisioning path SHALL return an `action: 'error'` result naming the extension and
  the image remedy, and SHALL NOT issue `CREATE EXTENSION IF NOT EXISTS` to the database, so that
  operators can detect the configuration problem in a dry-run pass before any DDL is attempted

## ADDED Requirements

### Requirement: Chart exposes a documented dedicated-DB tenant Postgres image value replacing the comment-only note

The Helm chart (`charts/in-falcone/values.yaml`) SHALL expose a dedicated, documented key for the
pgvector-capable Postgres image recommended for `database_per_tenant` tenants
(`postgresql.dedicatedTenantImage.repository` and `postgresql.dedicatedTenantImage.tag`) in place of
the current comment-only `NOTE (add-vector-search)`. The new key SHALL carry a meaningful default
(`repository: pgvector/pgvector`, `tag: pg17`) and an inline comment explaining that this value is
an operator contract for dedicated-DB tenant instances and does NOT affect the shared-instance
default (`postgresql.image`). The `postgresql.image` default (`bitnami/postgresql:17.2.0`) SHALL
remain unchanged. The chart's strict `values.schema.json` SHALL accept and enforce the key (it
references the shared `image` definition: a malformed `dedicatedTenantImage` is rejected).

This value is an operator configuration contract, not a runtime-templated image: dedicated DBs in
the `dpf_01regulateddedicated` profile are operator-provisioned instances, not per-tenant
StatefulSets rendered by the chart template. The chart value exists so that operators have a
named, greppable override point and a clear record of the recommended image, not to drive an
automatic image substitution.

#### Scenario: Operator overrides dedicatedTenantImage to supply a pgvector-capable image

- **WHEN** an operator sets `postgresql.dedicatedTenantImage.repository` and
  `postgresql.dedicatedTenantImage.tag` in their values override (e.g. to a custom
  Bitnami-compatible image with pgvector built in)
- **THEN** the Helm chart renders without error, the override is visible in the rendered values,
  and the shared-instance `postgresql.image` is not affected

#### Scenario: Default dedicated tenant image value is documented in the chart

- **WHEN** the chart is rendered with no overrides to `postgresql.dedicatedTenantImage`
- **THEN** the key is present in the rendered values with `repository: pgvector/pgvector` and
  `tag: pg17`, and the adjacent comment cross-references the `dpf_01regulateddedicated` profile
  and explains that this value is an operator guide, not an automatically applied image

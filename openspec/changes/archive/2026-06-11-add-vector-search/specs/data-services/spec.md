## ADDED Requirements

### Requirement: pgvector extension enablement is gated on database_per_tenant placement

The system SHALL enforce that the `vector` extension (already present in
`POSTGRES_EXTENSION_CATALOG` at
`services/adapters/src/postgresql-governance-admin.mjs` lines 36-41 with
`placementModes: ['database_per_tenant']`) can only be enabled for workspaces whose
data plane uses `database_per_tenant` placement, and SHALL propagate the placement
check through the `validatePostgresGovernanceRequest` path so that the existing
`authorizedEntry.placementModes` guard rejects the request before any SQL is sent.

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

#### Scenario: Dedicated-DB tenant database uses a pgvector-capable image

- **WHEN** a dedicated-DB tenant database is provisioned or the vector extension is
  first enabled
- **THEN** the database image used for that tenant's Postgres instance MUST include the
  pgvector extension (the default `bitnami/postgresql:17.2.0` image referenced in
  `charts/in-falcone/values.yaml` line 1698-1699 does NOT bundle pgvector; the operator
  MUST configure a pgvector-capable image for dedicated databases)
- **THEN** the provisioning path emits a configuration validation error if the resolved
  image does not advertise pgvector support

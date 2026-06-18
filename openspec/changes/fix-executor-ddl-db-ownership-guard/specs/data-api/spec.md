# data-api — spec delta for fix-executor-ddl-db-ownership-guard

## ADDED Requirements

### Requirement: Executor DDL is confined to the caller's own dedicated database

DDL execution SHALL fail closed (403 `DDL_TARGET_DB_FORBIDDEN`) when the requesting
workspace has no dedicated database provisioned (i.e. the connection would fall back
to the shared/platform database `in_falcone`). The dispatch cross-tenant ownership
check SHALL also apply to routes that target a workspace's resources without a
`/workspaces/` path segment (the DDL routes), using the credential's workspace, so a
caller cannot run DDL on a database owned by another tenant. The executor SHALL set
`GATEWAY_SHARED_SECRET` so client-supplied identity headers are honored only when
accompanied by the matching gateway trust signal.

#### Scenario: DDL on the platform/unprovisioned database is rejected

- **WHEN** a caller issues DDL whose workspace resolves to the shared platform
  database (e.g. an unprovisioned workspace id, including via a forged trust header)
- **THEN** the request is rejected with 403 `DDL_TARGET_DB_FORBIDDEN` and no statement
  runs on `in_falcone`.

#### Scenario: DDL targeting another tenant's workspace is rejected

- **WHEN** a caller issues DDL with a credential/workspace owned by a different tenant
- **THEN** the request is rejected with 403 `CROSS_TENANT_VIOLATION` before any
  connection is made.

#### Scenario: DDL on the caller's own provisioned workspace is unaffected

- **WHEN** the caller issues DDL against its own workspace's dedicated database
- **THEN** the ownership and dedicated-database guards pass and DDL proceeds as before.

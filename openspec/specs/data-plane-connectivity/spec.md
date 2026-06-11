# data-plane-connectivity Specification

## Purpose
TBD - created by archiving change add-workspace-db-connection-registry. Update Purpose after archive.
## Requirements
### Requirement: Workspace-scoped database connection resolution

The system SHALL resolve a workspace ID to its provisioned database DSN before
opening any Postgres connection, so that every data query targets the correct
per-workspace database and no connection is opened against an unknown or
unprovisioned workspace.

#### Scenario: Data query for a known workspace executes against the workspace database

- **WHEN** the executor calls `acquire(workspaceId, {tenantId, workspaceId}, fn)`
  for a workspace whose DSN is registered in the connection registry
- **THEN** `fn` executes against a connection to that workspace's database with
  `app.tenant_id` and `app.workspace_id` set via `set_config` inside the
  wrapping transaction, and no connection to any other workspace's database is
  used

#### Scenario: Unknown workspace fails closed before opening any connection

- **WHEN** the executor calls `acquire(workspaceId, ...)` for a workspace ID
  that has no entry in the connection registry
- **THEN** the call rejects with error code `WORKSPACE_DSN_UNKNOWN` and no
  Postgres connection is opened or borrowed from any pool

### Requirement: Per-workspace pool isolation

The system SHALL maintain separate connection pools for distinct workspace
databases, so that a connection established for workspace A is never reused
to serve a query for workspace B.

#### Scenario: Connections to different workspaces are isolated

- **WHEN** two concurrent data queries are issued for workspace A and workspace B
  where A and B resolve to different database DSNs
- **THEN** each query executes on a connection from its own pool and neither
  pool lends connections to the other workspace

#### Scenario: Cross-workspace connection reuse is prevented

- **WHEN** workspace A's pool has an idle connection and a query arrives for
  workspace B (different DSN)
- **THEN** the registry opens a connection from workspace B's pool and workspace
  A's idle connection is not used for workspace B's query

### Requirement: RLS context is set per transaction and never leaks across borrowers

The system SHALL set `app.tenant_id` and `app.workspace_id` via
`SET LOCAL` (transaction-scoped `set_config`) at the start of every
tenant-scoped data transaction, so that RLS policies enforced by
`control.current_tenant_id()` and `control.current_workspace_id()` see the
correct values and pooled connections returned to the pool carry no residual
context from a previous borrower.

#### Scenario: RLS context is set for a tenant-scoped data query

- **WHEN** `acquire(workspaceId, {tenantId: 'T1', workspaceId: 'W1'}, fn)` is
  called and `fn` executes a SELECT against an RLS-protected table
- **THEN** `set_config('app.tenant_id', 'T1', true)` and
  `set_config('app.workspace_id', 'W1', true)` are issued inside the
  transaction before `fn` runs, and the transaction is committed or rolled back
  before the connection is returned to the pool

#### Scenario: RLS context from one borrower does not leak to the next

- **WHEN** borrower 1 completes its transaction for tenant T1 and the connection
  is returned to the pool, and borrower 2 then acquires the same connection for
  tenant T2
- **THEN** borrower 2's `set_config` calls overwrite any residual T1 context,
  and the RLS policies evaluate to T2's values for borrower 2's queries

### Requirement: Migration and admin operations use a separate superuser path

The system SHALL provide a distinct `acquireMigration(workspaceId, fn)` entry
point that supplies a superuser or `platform_migrator`-role connection, so that
DDL, migrations, and cross-tenant sweep operations can run without RLS and
without requiring the caller to bypass the application connection pool.

#### Scenario: Migration path connects with the migrator credential

- **WHEN** the migration runner calls `acquireMigration(workspaceId, fn)`
- **THEN** `fn` executes on a connection authenticated as `platform_migrator`
  (or the configured superuser credential), RLS is not set, and the connection
  is not drawn from the application-role pool used by `acquire()`


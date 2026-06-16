## ADDED Requirements

### Requirement: Postgres data-plane connections MUST be scoped per workspace

The system SHALL resolve each Postgres data-plane connection to the requesting workspace's own database (or schema with enforced RLS) and SHALL NOT route tenant data through the shared `in_falcone` control-plane metadata database.

#### Scenario: Tenant data does not flow through the control-plane database

- **WHEN** a tenant issues a data API query against its workspace
- **THEN** the system connects to that workspace's provisioned database (or RLS-enforced schema) and never to `in_falcone`

### Requirement: User tables MUST enforce row-level tenant isolation

The system SHALL apply `FORCE ROW LEVEL SECURITY` with `tenant_id`/`workspace_id` policies (or per-workspace database separation) to user tables so that a tenant credential cannot read or modify another tenant's rows, and SHALL revoke broad `falcone_service` grants on control-plane tables.

#### Scenario: Tenant B cannot read or modify Tenant A's table

- **WHEN** Tenant B's credential issues a read, insert, or delete against Tenant A's table
- **THEN** the system denies the operation (no A rows returned, no A rows mutated or deleted)

#### Scenario: Control-plane tables are not readable by the shared service role

- **WHEN** the `falcone_service` role attempts `SELECT` on a control-plane table such as `public.workspace_api_keys`
- **THEN** the database denies the read

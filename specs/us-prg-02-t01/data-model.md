# Data Model: PostgreSQL Tenant Isolation Governance

## Overview

This task does not create runtime database tables. It defines the minimum metadata inventory that future PostgreSQL implementation tasks must manage to keep tenant placement auditable and reversible.

## Entities

### 1. TenantPlacement

**Purpose**: Records how a tenant is physically placed in PostgreSQL.

**Key attributes**
- `tenant_id`
- `placement_mode` (`shared_schema` | `dedicated_database`)
- `placement_reason` (default, regulatory, scale, noisy_neighbor, incident_response, other)
- `lifecycle_state` (requested, active, migrating, suspended, retired)
- `effective_at`
- `changed_by`
- `change_ticket_ref`

**Notes**
- This is the authoritative policy record for deciding how the data plane resolves a tenant.
- Every placement change must be auditable.

### 2. TenantDatabaseBinding

**Purpose**: Maps a tenant to the concrete PostgreSQL location that serves it.

**Key attributes**
- `tenant_id`
- `cluster_id`
- `database_name`
- `schema_name`
- `connection_profile`
- `is_primary`
- `last_validated_at`

**Notes**
- Shared tenants resolve to the same database with distinct schema names.
- Dedicated tenants resolve to a tenant-specific database and may still use an internal tenant schema for consistency.

### 3. SchemaLifecycleRecord

**Purpose**: Tracks provisioning and retirement events for tenant schemas/databases.

**Key attributes**
- `tenant_id`
- `target_kind` (`schema` | `database`)
- `target_name`
- `action` (create, grant, migrate, verify, archive, drop)
- `status`
- `executed_at`
- `executed_by`
- `evidence_ref`

### 4. MigrationLedger

**Purpose**: Proves what DDL version each placement target has applied.

**Key attributes**
- `tenant_id` or `scope` (`shared`, `tenant:<id>`, `database:<name>`)
- `migration_id`
- `migration_class` (`shared_control_plane`, `tenant_schema`, `dedicated_database`)
- `applied_at`
- `applied_by`
- `rollback_reference`
- `checksum`

**Notes**
- Shared metadata migrations and tenant-schema migrations need separate tracking.
- Rollback references matter because hybrid placement can require two-step reversions.

### 5. PrivilegeInventory

**Purpose**: Documents which PostgreSQL roles can do what.

**Key attributes**
- `role_name`
- `role_class` (`runtime`, `migrator`, `provisioner`, `audit_readonly`, `break_glass`)
- `allowed_scopes`
- `ddl_allowed`
- `rls_bypass_allowed`
- `rotation_owner`
- `review_frequency`

**Notes**
- Runtime roles should never own schemas or perform DDL.
- Break-glass roles must be exceptional and separately audited.

### 6. RlsPolicyInventory

**Purpose**: Captures where RLS is required and how tenant context is enforced.

**Key attributes**
- `table_fqn`
- `contains_tenant_scoped_data`
- `policy_name`
- `context_source` (session setting, security definer function, other approved mechanism)
- `review_status`
- `last_reviewed_at`

### 7. IsolationVerificationScenario

**Purpose**: Stores or references repeatable test cases for tenant isolation.

**Key attributes**
- `scenario_id`
- `placement_mode`
- `test_type` (positive, negative, migration, rollback, privilege)
- `expected_result`
- `evidence_location`

## Relationships

- One `TenantPlacement` has one or more `TenantDatabaseBinding` records over time.
- One `TenantPlacement` produces many `SchemaLifecycleRecord` entries.
- One `TenantDatabaseBinding` is validated by many `MigrationLedger` and `IsolationVerificationScenario` entries.
- One `PrivilegeInventory` role can affect many `RlsPolicyInventory` and lifecycle records.

## Non-Goals

- Defining final SQL table names for the control plane.
- Designing MongoDB or object-storage metadata.
- Defining the PostgreSQL Data API contract.

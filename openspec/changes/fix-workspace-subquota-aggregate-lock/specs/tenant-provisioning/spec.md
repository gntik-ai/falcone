## ADDED Requirements

### Requirement: Workspace sub-quota allocation MUST enforce the tenant effective limit against the database

The system SHALL, when setting a workspace sub-quota for a tenant quota dimension, compute the sum of the tenant's other workspaces' allocations for that dimension via a query that is valid on PostgreSQL (it MUST NOT combine `FOR UPDATE` with an aggregate function), and SHALL reject — with HTTP 422 — any allocation that would drive the tenant's total allocation for that dimension above the tenant's effective limit. A bounded-limit dimension MUST be enforceable on the real database, not only against an in-memory test store.

#### Scenario: Setting a sub-quota within the tenant limit succeeds on PostgreSQL

- **WHEN** a tenant owner sets a workspace sub-quota for a dimension whose allocation (plus the tenant's other workspace allocations for that dimension) does not exceed the tenant's effective limit
- **THEN** the system persists the allocation and returns HTTP 201 (new) or HTTP 200 (updated), and does NOT raise a database error from combining `FOR UPDATE` with an aggregate

#### Scenario: Setting a sub-quota above the tenant limit is rejected

- **WHEN** a tenant owner sets a workspace sub-quota whose value would drive the tenant's total allocation for that dimension above the tenant's effective limit
- **THEN** the system returns HTTP 422 (`SUB_QUOTA_EXCEEDS_TENANT_LIMIT`) and does not persist the allocation

#### Scenario: Concurrent sub-quota writes are serialized by a row lock

- **WHEN** the sub-quota total for a dimension is computed during an allocation
- **THEN** the sibling sub-quota rows for that tenant and dimension are locked (`FOR UPDATE` on a non-aggregate subquery) so concurrent allocations cannot collectively exceed the tenant effective limit

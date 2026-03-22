# PostgreSQL Tenant Isolation Verification Matrix

This directory defines the minimum verification scenarios that future PostgreSQL implementation tasks must automate or execute when changing tenant placement, grants, RLS policies, or migrations.

## Scope

The matrix covers both placement modes defined by ADR 0002:

- `shared_schema`
- `dedicated_database`

## Required scenarios

| ID | Placement | Type | Scenario | Expected result |
|----|-----------|------|----------|-----------------|
| PG-ISO-001 | shared_schema | positive | Tenant A runtime reads tenant A data from its own schema | access allowed |
| PG-ISO-002 | shared_schema | negative | Tenant A runtime attempts to read tenant B schema objects | access denied |
| PG-ISO-003 | shared_schema | negative | Tenant A runtime queries shared tenant-scoped control table with Tenant B context missing or mismatched | zero rows or denied by RLS |
| PG-ISO-004 | shared_schema | privilege | Runtime role attempts DDL in control or tenant schema | denied |
| PG-ISO-005 | shared_schema | migration | Tenant-schema migration runs fully qualified against the intended schema only | only target schema changes |
| PG-ISO-006 | shared_schema | rollback | Failed migration restores previous schema state and re-validates isolation | rollback evidence recorded |
| PG-ISO-007 | dedicated_database | positive | Dedicated tenant runtime accesses its own database objects | access allowed |
| PG-ISO-008 | dedicated_database | negative | Tenant connection resolver points to the wrong database | verification fails before serving traffic |
| PG-ISO-009 | dedicated_database | privilege | Runtime role attempts database-level DDL | denied |
| PG-ISO-010 | hybrid | promotion | Tenant promotion from shared schema to dedicated database preserves logical contract and isolation | metadata updated, old placement retired after validation |

## Evidence expectations

Every future automated or manual run should capture:

- placement mode tested
- tenant identifiers involved
- role used
- statements or migration identifiers executed
- expected versus actual result
- timestamp and operator/automation reference

## Review triggers

Re-run this matrix whenever a change affects:

- placement metadata resolution
- grants or default privileges
- RLS policy functions or policies
- tenant schema naming or lifecycle rules
- migration tooling or rollback behavior

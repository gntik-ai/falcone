# fix-governance-schema-bootstrap

## Change type
bugfix

## Capability
control-plane-runtime

## Priority
P1

## Why
`GET /v1/capability-catalog` → 500 (`boolean_capability_catalog` missing); `POST /tenants/{id}/plan` → 500 (`tenant_plan_change_history` missing); `GET .../scope-enforcement/audit` → 500 (`scope_enforcement_denials` missing); `quota_dimension_catalog` empty.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: the three endpoints 500 with PostgreSQL 42P01; the dimension catalog returns 0 rows so limits can't be defined.

GitHub issue #555 (epic #541). Evidence: `audit/live-campaign/evidence/26-lifecycle-governance.md`.

## What Changes
Ensure the control-plane schema bootstrap creates+seeds the full governance schema (or the bootstrap Job runs the governance migrations) so all provisioning-orchestrator actions resolve — kind control-plane schema + product migrations.

## Impact
The four endpoints return 200; a limit can be defined against a seeded dimension.

Dependencies: Depends on D1 (bootstrap).

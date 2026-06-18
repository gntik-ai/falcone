# add-audit-write-and-scope-enforcement-store

## Change type
enhancement

## Capability
audit

## Priority
P2

## Why
audit-records empty after real actions; no correlation entries; `scope-enforcement/audit` 500.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: created users/workspaces then queried audit → 0 entries; scope-enforcement audit → 500 (missing table).

GitHub issue #557 (epic #541). Evidence: `audit/live-campaign/evidence/26-lifecycle-governance.md`.

## What Changes
Deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are recorded with correlation ids — kind + product.

## Impact
An action appears in audit-records with its correlation id.

# fix-workspace-quota-enforcement

## Change type
bugfix

## Capability
tenant-provisioning

## Priority
P1

## Why
Created 4 workspaces under `max_workspaces=3` → all 201. The create path has no quota gate (enforcement is wired only for flows/mcp/observability).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: `POST /v1/tenants/{id}/workspaces` succeeds past the tenant's workspace limit.

GitHub issue #556 (epic #541). Evidence: `audit/live-campaign/evidence/26-lifecycle-governance.md`.

## What Changes
Gate workspace creation on the tenant's resolved workspace-count entitlement; 4xx on breach — kind `b-handlers.mjs::createWorkspace` + product workspace command.

## Impact
Creating past the limit → 402/409 quota error; live probe.

Dependencies: Depends on C1 (dimension catalog).

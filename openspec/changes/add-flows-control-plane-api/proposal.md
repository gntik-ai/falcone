## Why

Falcone has no flow authoring or execution surface: tenants cannot create, publish, or run Temporal-backed workflows through the platform API, so the entire Temporal-based workflow engine (epic #355) is unreachable. This change adds the tenant-facing `flows` API family to the control-plane, closing the gap between Temporal infrastructure (#356) and the console (#366, #367).

## What Changes

- New `flow-executor.mjs` in `apps/control-plane/src/runtime/` holding the sole Temporal client connection; injected into `createControlPlaneServer` and wired into `buildRoutes()` alongside existing executors (`main.mjs`).
- New route family `flows` under `/v1/flows/workspaces/{workspaceId}/…` covering flow CRUD (draft head), validate (422 with node-scoped error codes), publish (immutable versions), version list/get, and execution lifecycle (start, list, get-detail, cancel, retry, signal).
- New Postgres tables `flow_definitions` (draft head) and `flow_versions` (immutable published versions) with `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` per the `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql` pattern; `falcone_app` role granted DML.
- New entries in `services/internal-contracts/src/public-route-catalog.json` for every flows route; regenerated artifacts via `scripts/generate-public-api-artifacts.mjs`.
- Workflow IDs namespaced `{tenantId}:{workspaceId}:{flowId}:{runUuid}` server-side; never accepted from clients.
- Identity sourced exclusively from `resolveIdentity` (`apps/control-plane/src/runtime/server.mjs::resolveIdentity`); tenant context never read from request bodies.
- Version pinning: starting an execution pins to a named version; subsequent publishes (v2, v3…) do not alter in-flight runs.
- Temporal visibility search attributes (`tenantId`, `workspaceId`, `flowId`, `flowVersion`, `status`, time range) used for execution list queries.

## Capabilities

### New Capabilities

- `workflows`: Tenant-facing flow authoring (CRUD, validate, publish, versioning) and execution control (start, list, detail, cancel, retry, signal) via the `flows` API family; Postgres-backed definitions/versions with RLS; Temporal mediation through `flow-executor.mjs`.

### Modified Capabilities

- `control-plane-runtime`: `buildRoutes()` and `createControlPlaneServer` are extended to accept and wire a `flowExecutor`; `main.mjs` instantiates it.

## Impact

- **Code**: `apps/control-plane/src/runtime/` (new `flow-executor.mjs`, modified `server.mjs`, `main.mjs`).
- **Schema**: new migration files for `flow_definitions` + `flow_versions` tables with RLS (location TBD in change tasks, consistent with `services/scheduling-engine/migrations/` pattern).
- **Contracts**: `services/internal-contracts/src/public-route-catalog.json` gains ~22 new route entries; downstream generated artifacts regenerated.
- **Dependencies**: Temporal client package (already provisioned by #356); no new runtime deps for the control-plane container.
- **Siblings (out of scope here)**: trigger registration (#365), SSE execution streaming (#366), quotas/audit (#362), DSL interpreter worker (#359).

## ADDED Requirements

### Requirement: Service SHALL accept and wire executor dependencies including the flows executor

The system SHALL extend `createControlPlaneServer` (`apps/control-plane/src/runtime/server.mjs::createControlPlaneServer`) to accept a `flowExecutor` parameter alongside the existing executor dependencies (`mongoExecutor`, `eventsExecutor`, `functionsExecutor`, `realtimeExecutor`, `pgRealtimeExecutor`, `embeddingExecutor`, `mappingStore`), and `buildRoutes` SHALL register the flows route family when a `flowExecutor` is provided. `main.mjs` SHALL instantiate `flow-executor.mjs` and pass it to `createControlPlaneServer`. When no `flowExecutor` is provided, flows routes MUST NOT be registered and any request to a flows path MUST fall through to the existing 404 / upstream-proxy path unchanged.

#### Scenario: Server starts and registers flows routes when flowExecutor is injected
- **WHEN** `main.mjs` instantiates `flow-executor.mjs` and passes it as `flowExecutor` to `createControlPlaneServer`
- **THEN** `buildRoutes` includes the `flows` family route tuples and a `GET /healthz` probe on the running server still returns HTTP 200

#### Scenario: Server omits flows routes when flowExecutor is absent
- **WHEN** `createControlPlaneServer` is called without a `flowExecutor` parameter (or with `undefined`)
- **THEN** `GET /v1/flows/workspaces/{workspaceId}/flows` returns HTTP 404 (or is proxied upstream if `controlPlaneUpstream` is set), and no flows route tuple appears in the route table

#### Scenario: Existing executor routes are unaffected by the addition of flowExecutor
- **WHEN** `createControlPlaneServer` is initialised with a `flowExecutor` alongside existing executors
- **THEN** all previously registered routes (postgres-data, DDL, mongo, events, functions, realtime, embedding) continue to match and respond correctly

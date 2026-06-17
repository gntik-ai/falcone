Tracking issue: gntik-ai/falcone#489

## Why

Data-plane handlers take `workspaceId`/`databaseName`/`bucketId` from the **URL path** and never assert that it matches the authenticated credential (`identity.workspaceId === path.workspaceId`). A correctly scoped Tenant-B credential therefore operates on Tenant-A resources.

Live proof with B's own service key on A's path: events — listed A's topics and published into `evt.<A_ws>.…`; functions — invoked A's function. (Evidence: `tests/live-audit/evidence/06-functions-events.md`, `tests/live-audit/evidence/15-gateway-and-executor-authz.md`.) The Postgres breach is A2 combined with A3.

## What Changes

- Centralize an authorization check that the path `workspaceId`/`databaseName`/`bucketId` resolves to the credential's tenant/workspace before any handler runs.
- Reject with HTTP 403 when the path resource does not belong to the authenticated credential.
- Apply the check uniformly across postgres, mongo, events, functions, realtime, and api-keys handlers.

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-isolation`: Every data-plane operation is bound to the authenticated credential's workspace, not the caller-supplied URL path.

## Impact

- Executor data-plane handlers (postgres, mongo, events, functions, realtime, api-keys).
- A1 (`fix-gateway-authn-and-strip-tenant-headers`) provides defense in depth at the edge; this is the in-process enforcement.

## Why

The web console ships `/console/workspaces/{workspaceId}/realtime`, and `ConsoleRealtimePage`
loads `GET /v1/workspaces/{workspaceId}/realtime` before rendering the snippets panel. The kind
control-plane runtime did not register that route, so every workspace opened the page into the
error-only branch with `404 NO_ROUTE`.

This is a backend route-wiring bug with a frontend-visible symptom. The production frontend already
expects the correct metadata shape, so the fix serves that shape from the kind control-plane instead
of changing the console contract.

## What Changes

- Add the kind control-plane route `GET /v1/workspaces/{workspaceId}/realtime`.
- Add a local realtime handler that:
  - resolves the workspace by path id;
  - scopes tenant callers to their verified tenant, returning `404 WORKSPACE_NOT_FOUND` for
    missing or foreign workspaces;
  - returns `WorkspaceRealtimeResponse` shape:
    `{ workspaceId, realtimeEndpointUrl, features: { realtime }, dataSources }`;
  - returns `200` with `dataSources: []` and `features.realtime: false` for an owned workspace with
    no available realtime channels.
- Update route-map metadata used by the kind deployment.
- Add unit and web-console tests for the issue's success scenario.
- Add a reference note for the route's ownership and response contract.

## Capabilities

### Added Capabilities

- `realtime`: the workspace realtime config route exists for the shipped console page and returns
  tenant-scoped realtime metadata instead of falling through to `404 NO_ROUTE`.

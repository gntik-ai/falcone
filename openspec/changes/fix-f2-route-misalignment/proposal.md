## Why

Four pieces of route metadata are wrong or misleading and will mis-route
traffic or confuse operators. From
`openspec/audit/cap-f2-realtime-subscriptions-transport.md`:

- **B6** (`apps/control-plane/openapi/families/websockets.openapi.json:684`)
  — `x-owning-service: event_gateway` is incorrect. The F1 audit
  established that `services/event-gateway/src/` has no HTTP server;
  whatever runs the WebSocket session contract is the realtime-gateway.
- **B7** (`charts/in-falcone/values.yaml:1177, 1193`) — routes 2014 and
  2015 declare URIs under `/v1/realtime/workspaces/.../mongo-captures/*`
  and `/v1/realtime/tenants/.../mongo-captures/summary/*` but these are
  CRUD admin endpoints with no `enableWebsocket: true` and no realtime
  semantics. The `/v1/realtime/` prefix is misleading.
- **B8** (`charts/realtime-gateway/values.yaml:13-14, 17-18`) — JWKS
  and introspection URLs default to `https://keycloak.example/...`. No
  overlay changes them; an operator who installs the chart without
  per-environment overrides sees immediate JWT verification failures.
- **G5** — same `x-owning-service` mis-attribution.
- **G7** — same routes-2014/2015 URL misnaming.

## What Changes

- Correct
  `apps/control-plane/openapi/families/websockets.openapi.json:684`
  from `x-owning-service: event_gateway` to
  `x-owning-service: realtime_gateway`; propagate the change to any
  downstream contract generator that reads the tag.
- Rename routes 2014 and 2015 in `charts/in-falcone/values.yaml` to
  `/v1/mongo-captures/workspaces/{workspaceId}/*` and
  `/v1/mongo-captures/tenants/{tenantId}/summary/*` so the URL prefix
  matches the family.
- Remove the `https://keycloak.example/...` defaults from
  `charts/realtime-gateway/values.yaml`; require the overlay to set
  `apisix.jwtAuth.jwksUri` and `keycloak.introspectionUrl` explicitly
  and fail `helm template` if either is empty.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: contract ownership metadata reflects source
  reality; mongo-captures routes drop the misleading realtime prefix;
  Keycloak defaults are no longer install-time foot-guns.

## Impact

- **Affected code**:
  `apps/control-plane/openapi/families/websockets.openapi.json`,
  `charts/in-falcone/values.yaml` (routes 2014/2015),
  `charts/realtime-gateway/values.yaml`.
- **Migration**: clients that called the old `/v1/realtime/.../mongo-captures/*`
  URLs must migrate to `/v1/mongo-captures/...`. Provide an APISIX
  rewrite/redirect for one release.
- **Breaking changes**: contract generators that key on
  `x-owning-service` will see the change; downstream catalogues should
  be regenerated.
- **Out of scope**: keycloak realm bootstrap (B1 audit territory),
  resilience tuning of pod settings (`harden-f2-pod-resilience`).

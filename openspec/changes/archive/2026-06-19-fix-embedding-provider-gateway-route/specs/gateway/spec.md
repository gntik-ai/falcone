# gateway — spec delta for fix-embedding-provider-gateway-route

## ADDED Requirements

### Requirement: BYOK embedding-provider config is reachable through the gateway

The system SHALL define an APISIX route (`2003-embedding`, priority 337) that matches the URI
pattern `^/v1/workspaces/[^/]+/embedding-provider` and forwards requests to the executor
(`falcone-cp-executor`), at a priority higher than the generic `/v1/workspaces/*` route (`2003`,
priority 237) which targets the kind control-plane. Without this dedicated route, `PUT`, `GET`, and
`DELETE` requests to `/v1/workspaces/{id}/embedding-provider` fall through to the kind
control-plane (which has no embedding handler) and return `404 {"code":"NO_ROUTE"}`.

The route SHALL apply the same security model as route `2003-keys` (#488): strip client-supplied
identity headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-actor-roles`) and inject
the `x-gateway-auth` shared-secret header so the executor can verify the request was forwarded by
the authenticated gateway.

The executor's `GET /v1/workspaces/{id}/embedding-provider` handler SHALL read the provider record
scoped by the verified identity's `tenantId` (from `c.identity.tenantId`, never from the request
body or URL) and SHALL return the stored record — which carries only a `secretRef` — or `404
EMBEDDING_PROVIDER_NOT_FOUND` when no provider has been configured for the workspace.

#### Scenario: PUT then GET round-trip reaches the executor and returns secretRef only

- **WHEN** a workspace owner calls `PUT /v1/workspaces/{id}/embedding-provider` with an embedding
  provider config (including an API key), and then calls `GET /v1/workspaces/{id}/embedding-provider`
  on the same workspace through the APISIX gateway
- **THEN** both requests are forwarded to the executor (not the kind control-plane), the PUT returns
  `200`, and the GET returns `200` with the stored provider record containing a `secretRef` field
  and no plaintext `apiKey` or `secret` field

#### Scenario: GET on an unconfigured workspace returns 404 EMBEDDING_PROVIDER_NOT_FOUND

- **WHEN** a workspace owner calls `GET /v1/workspaces/{id}/embedding-provider` for a workspace
  that has no embedding provider configured
- **THEN** the executor returns `404` with `{"code":"EMBEDDING_PROVIDER_NOT_FOUND"}` and the
  response does not contain any credential material

#### Scenario: Route 2003-embedding is present in the APISIX config and targets the executor

- **WHEN** the APISIX configuration is inspected
- **THEN** a route with `vars` matching `^/v1/workspaces/[^/]+/embedding-provider` at priority 337
  is present, its upstream resolves to `falcone-cp-executor`, and `proxy-rewrite` strips
  client-supplied identity headers and injects `x-gateway-auth`

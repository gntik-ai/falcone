# fix-embedding-provider-gateway-route

## Change type
bugfix

## Capability
gateway

## Priority
P2

## Why
The only BYOK configuration surface — `PUT/GET/DELETE /v1/workspaces/{id}/embedding-provider` — returned
`404 {"code":"NO_ROUTE"}` for every caller, making the per-workspace embedding-provider config
unreachable through the public gateway.

**Root cause (code-verified).** The handler is registered in the EXECUTOR:
`apps/control-plane/src/runtime/server.mjs:273` declares the regex
`'^/v1/workspaces/([^/]+)/embedding-provider'` and wires PUT (`runEmbeddingProvider(..., 'set', ...)`),
GET (`runEmbeddingProvider(..., 'get', ...)`), and DELETE at lines 401–406. However, APISIX route `2003`
(`deploy/kind/apisix/apisix.yaml`) matched `/v1/workspaces/*` at priority 237 and forwarded to
`falcone-cp-executor` only for the api-keys subpath (route `2003-keys`, priority 337). All other
`/v1/workspaces/*` traffic fell through to the generic `/v1/*` catch-all (route `5000`, priority 50),
which forwards to the **kind control-plane** — a separate process with no embedding handler — and that
process returned `404 {"code":"NO_ROUTE"}`. GitHub issue #635.

## What Changes
- `deploy/kind/apisix/apisix.yaml`: add route `2003-embedding` (priority 337, `vars` regex
  `^/v1/workspaces/[^/]+/embedding-provider`) that forwards to `falcone-cp-executor`, mirroring
  route `2003-keys` exactly including the `proxy-rewrite` plugin that strips client-supplied
  identity headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-actor-roles`) and injects
  the `x-gateway-auth` shared-secret header so the executor trusts the gateway-forwarded request
  (security model established by #488).
- `apps/control-plane/src/runtime/server.mjs`: add the `GET` handler at line 403–404
  (`runEmbeddingProvider(embeddingExecutor, 'get', { workspaceId: w, tenantId: c.identity.tenantId }, 200)`)
  which reads the stored provider record scoped by the verified identity's `tenantId` and returns
  the record (carrying only a `secretRef`, never the plaintext key), or `404 EMBEDDING_PROVIDER_NOT_FOUND`
  when no provider has been configured for the workspace.

## Impact
- `PUT /v1/workspaces/{id}/embedding-provider` and `GET /v1/workspaces/{id}/embedding-provider` now
  reach the executor and return the expected responses instead of `404 NO_ROUTE`.
- The GET response exposes only the stored `secretRef`; the plaintext API key is never persisted by
  `deployProvider` and therefore cannot be returned.
- Tenant isolation is preserved: the store read is keyed by `(tenant_id, workspace_id)` where
  `tenant_id` comes from the verified identity, not the request body or URL.
- No change to any other route, authentication model, or data-plane contract.
- Affected specs: `gateway`.

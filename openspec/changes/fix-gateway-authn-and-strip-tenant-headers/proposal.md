Tracking issue: gntik-ai/falcone#488

## Why

The live standalone APISIX gateway (`falcone-apisix-standalone`, public via `api.dev.in-falcone.example.com`) carries only `cors` + `proxy-rewrite` plugins — no auth plugin and no rule that strips client-supplied `x-tenant-id`/`x-workspace-id` headers. The executor's `resolveIdentity` falls back to `identityFromHeaders` (trusting `x-tenant-id`/`x-workspace-id`) when no JWT/API-key is presented, so the gateway is an open door.

Live proof: `POST http://<apisix>/v1/workspaces/<A_ws>/api-keys` with header `x-tenant-id: <A_tenant>` and **no Authorization** returned **201** and minted a real service key for Tenant A; `GET …/api-keys` with the same header returned 200 (A's keys). Without the header it returned 401. Any party that can reach the gateway can impersonate any tenant by setting one header, with no credentials. (Evidence: `tests/live-audit/evidence/15-gateway-and-executor-authz.md`.)

## What Changes

- Wire the intended `openid-connect`/JWT verification and `key-auth` plugins on the public APISIX data-plane routes.
- Have the gateway **strip inbound `x-tenant-id`/`x-workspace-id`/`x-auth-subject` headers** from client requests and inject them only from the verified token.
- Remove the executor's header-trust fallback (or gate it to a mutually-authenticated in-cluster network) so spoofed tenant headers cannot establish identity.

## Capabilities

### New Capabilities

### Modified Capabilities

- `gateway`: The public gateway authenticates every data-plane request and strips client-supplied tenant-context headers, injecting tenant context only from the verified credential.

## Impact

- `falcone-apisix-standalone` route/plugin configuration (gateway edge).
- Executor `resolveIdentity` / `identityFromHeaders` (`server.mjs`) header-trust fallback.
- Depends on A2 (`fix-executor-enforce-credential-workspace`) for defense in depth.
- Scope note: the bypass affects the **data-plane** routes (the executor catch-all); the management plane (`/v1/tenants`, …) already requires auth.

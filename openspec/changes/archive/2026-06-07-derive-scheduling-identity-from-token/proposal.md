## Why

`services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity:15-22` derives `tenantId`, `workspaceId`, and `actorId` with `??` fallbacks to attacker-controlled request fields when `params.jwt` is absent:

```js
tenantId: params.jwt?.tenantId ?? params.tenantId,
workspaceId: params.jwt?.workspaceId ?? params.workspaceId,
actorId: params.jwt?.sub ?? params.actorId ?? 'system',
```

`main:55-57` calls `parseIdentity` immediately, and `identity` is the sole source of tenant/workspace context for every operation in the file — 12+ endpoints including `GET/POST /v1/scheduling/jobs`, `PATCH /v1/scheduling/config`, `DELETE /v1/scheduling/jobs/:id`. `deploy/apisix/routes/scheduling.yaml:10-14` configures `openid-connect: bearer_only: true`, which validates the JWT but does NOT inject verified claims as `params.jwt`. If claim-forwarding is not configured, `params.jwt` is undefined for every invocation and the entire identity is derived from attacker-controlled fields, enabling cross-tenant CRUD across all scheduling endpoints (source finding `bug-015`).

## What Changes

- `parseIdentity` SHALL read `tenantId`, `workspaceId`, and `actorId` exclusively from `params.jwt`; all `?? params.tenantId`, `?? params.workspaceId`, and `?? params.actorId` fallbacks are removed.
- If `params.jwt` is absent, or if `params.jwt.tenantId` or `params.jwt.workspaceId` are absent or empty, the action returns HTTP 401 / `UNAUTHENTICATED` before any operation.
- `params.tenantId`, `params.workspaceId`, `params.actorId` are treated as untrusted and ignored.
- The fix is a single site: `scheduling-management.mjs::parseIdentity:15-22`; all 12+ downstream query sites benefit automatically.

## Capabilities

### New Capabilities

- `scheduling`: Token-only identity derivation for all scheduling endpoints, ensuring that `tenantId` and `workspaceId` are always sourced from verified JWT claims and can never be overridden by attacker-supplied request fields.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the scheduling capability spec -->

## Impact

- `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity:15-22` — sole fix site (remove fallbacks; add 401 guard on missing/empty `params.jwt` claims)
- All 12+ downstream query sites in the same file receive a correctly-sourced `identity` automatically
- `deploy/apisix/routes/scheduling.yaml:10-14` — verify `openid-connect` plugin is configured to inject verified claims as `params.jwt`
- Requests that currently succeed by supplying `tenantId`/`workspaceId` in body/query without a token will now receive HTTP 401

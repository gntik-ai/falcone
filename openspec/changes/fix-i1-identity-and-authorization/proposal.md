## Why

The scheduling-engine trusts caller-supplied identity fields whenever the
gateway fails to attach a JWT, and ships with no scope/role authorization at
all. From `openspec/audit/cap-i1-scheduling-engine.md`:

- **B2** (`services/scheduling-engine/actions/scheduling-management.mjs:15-22`) —
  identity is parsed as `jwt.tenantId ?? params.tenantId`,
  `jwt.workspaceId ?? params.workspaceId`. A misconfigured gateway lets the
  caller set their own tenant/workspace via request params.
- **B9** (`scheduling-management.mjs:19`) — `actorId` defaults to `'system'`
  when both JWT and explicit `actorId` are absent; every audit row records
  `'system'` for unauthenticated callers, polluting forensics.
- **G1, G2** (same file:line) — same upstream-trust pattern flagged as a gap;
  `actorId: 'system'` fallback flagged separately.
- **G3** (cross-cutting) — no scope/role authorization; any caller with the
  right tenant/workspace identity is admin-capable.

## What Changes

- Require a verified JWT context on every scheduling-management handler;
  remove the `?? params.tenantId` and `?? params.workspaceId` fallbacks at
  `scheduling-management.mjs:15-22`. Missing or unverified JWT MUST return
  `401 UNAUTHENTICATED`.
- Remove the `?? 'system'` default at `:19`; missing `actor.sub` MUST return
  `401 UNAUTHENTICATED`. A caller-supplied `params.actorId` MUST NOT be honoured.
- Introduce a scope check: scheduling-write operations (POST/PATCH/DELETE/pause/
  resume) MUST require `scheduling:write`; read operations MUST require
  `scheduling:read`. Missing scope MUST return `403 FORBIDDEN`.

## Capabilities

### Modified Capabilities

- `functions-runtime`: identity is sourced exclusively from a verified JWT;
  scope-based authorization gates every scheduling endpoint.

## Impact

- Affected code: `services/scheduling-engine/actions/scheduling-management.mjs`,
  `services/scheduling-engine/actions/scheduling-trigger.mjs`,
  `services/scheduling-engine/actions/scheduling-job-runner.mjs`.
- Migrations: none.
- Breaking changes: any caller relying on `params.tenantId` or
  `params.workspaceId` to set identity now receives `401`; deployments lacking
  JWT verification at the gateway must be fixed before this change rolls out.
- Coordination: gateway team must confirm JWT verification is enabled on the
  `/v1/scheduling/*` routes before merging.

## Why

`services/realtime-gateway/src/actions/validate-subscription-auth.mjs:34-37` contains an early-return bypass block that, when `REALTIME_AUTH_ENABLED=false`, immediately returns `{ allowed: true, subscriptionContext: {} }` — an unconditional allow with an empty, tenant-less context object. Every security guard in the normal path is skipped: JWT signature verification (`validateTokenFn` at line 43), scope/workspace access check (`checkScopesFn` at line 59), filter validation (line 86), complexity limits (line 87), quota enforcement (`countActiveSubscriptions` at line 114), and all audit-event publication (lines 46, 62, 93, 117, 137). The empty `subscriptionContext` carries no `tenantId`, `workspaceId`, `actorIdentity`, `channelType`, or `filterSpec`, so downstream consumers silently treat the subscription as tenant-less, potentially routing events across all tenants' streams. The default is secure (`services/realtime-gateway/src/config/env.mjs:20` sets `DEFAULTS.REALTIME_AUTH_ENABLED = 'true'`), but a single env-var override silently removes the entire realtime tenant-isolation boundary (source finding: bug-019).

## What Changes

- Add a startup-time assertion in `services/realtime-gateway/src/config/env.mjs:68-72`: if `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=production`, `loadEnv` SHALL throw a configuration error before any WebSocket/SSE listener opens.
- Remove or strictly gate the blanket bypass at `services/realtime-gateway/src/actions/validate-subscription-auth.mjs:34-37`. If a dev bypass is retained it MUST be gated to `NODE_ENV !== 'production'` AND MUST supply a non-empty dev-tenant `subscriptionContext` (never an empty object).
- The normal auth path (when `REALTIME_AUTH_ENABLED=true`) MUST remain entirely unmodified.

## Capabilities

### New Capabilities

- `realtime`: Fail-closed behavior for the `REALTIME_AUTH_ENABLED` feature flag, ensuring that disabling realtime auth in production either refuses service startup or rejects every subscription with a non-empty `subscriptionContext`, so the realtime tenant-isolation boundary cannot be silently bypassed.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the realtime capability spec -->

## Impact

- `services/realtime-gateway/src/actions/validate-subscription-auth.mjs:34-37` — remove or gate the blanket bypass block.
- `services/realtime-gateway/src/config/env.mjs:20,68-72,90` — add startup-time production guard that throws when `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=production`.
- **Breaking (intentional):** a deployment that had `REALTIME_AUTH_ENABLED=false` in production will now fail to start instead of silently bypassing all auth. Deployments using the default (`REALTIME_AUTH_ENABLED=true`) are completely unaffected.
- Black-box suite: four scenarios (A–D) covering: production startup rejection, dev-mode non-empty context, bypass block fully removed from production path, normal auth path unmodified.

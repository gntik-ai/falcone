## Why

All eight CDC capture actions (`pg-capture-enable`, `pg-capture-disable`, `pg-capture-list`, `pg-capture-tenant-summary`, and their `mongo-*` counterparts) derive `tenant_id` and `workspace_id` by base64url-decoding the raw Bearer token payload with no signature verification, no issuer/audience check, and no expiry check — an attacker can forge any `tenant_id` in an unsigned token and enable, disable, or enumerate CDC captures for any victim tenant.

## What Changes

- Replace `decodeAuth` (raw base64url decode of JWT payload) in all eight capture actions with identity sourced from trusted gateway-injected headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`), mirroring the pattern in `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`.
- Remove the `decodeAuth` helper from all eight files.
- Any request missing the expected gateway headers is rejected with `401 UNAUTHORIZED` — **no behaviour change for requests that pass through the APISIX gateway**.
- No API surface change; no new fields added or removed.

## Capabilities

### New Capabilities

- `change-data-capture`: Capture-action identity is sourced from gateway-trusted headers only; unsigned or forged JWT payloads can no longer set tenant scope.

### Modified Capabilities

## Impact

- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs::decodeAuth` (lines 8-11, 14-20)
- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs::decodeAuth`
- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs::decodeAuth`
- `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs::decodeAuth`
- `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs::decodeAuth`
- `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-disable.mjs::decodeAuth`
- `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-list.mjs::decodeAuth`
- `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-tenant-summary.mjs::decodeAuth`
- Reference fix pattern: `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`
- Gateway config evidence: `services/gateway-config/base/public-api-routing.yaml:211-218`

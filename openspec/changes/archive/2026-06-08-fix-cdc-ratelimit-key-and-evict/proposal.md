## Why

`KafkaChangePublisher._allow` in `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs` keys its rate-limit sliding-window `Map` by `workspaceId` alone (`this.windows.set(workspaceId, ...)`). Because the map is never evicted, every workspace that ever routes through a long-lived CDC bridge process adds a permanent entry — one per workspace seen — causing unbounded memory growth over the lifetime of the process. Additionally, because workspace ids are ULID-scoped globally rather than guaranteed unique across tenant boundaries by construction, keying without the `tenantId` dimension is a structural aliasing risk: if two workspaces across different tenants shared the same id (collision or intentional reuse) their rate-limit windows would merge, allowing one tenant to borrow rate budget from another.

## What Changes

- Change the rate-limit window map key from `workspaceId` to the composite `${tenantId}:${workspaceId}`, requiring `tenantId` to be passed into `_allow` from `publish` (where `captureConfig.tenant_id` is already available).
- Add an eviction step inside `_allow`: after updating the counter, delete any entry whose `windowStart` is older than the window duration (1 second) and whose count has been reset — keeping the map bounded to currently-active windows only.
- Update `publish` to call `this._allow(captureConfig.tenant_id, captureConfig.workspace_id)` with both dimensions.

## Capabilities

### New Capabilities

- `change-data-capture`: Rate-limit windows are keyed by the composite tenant+workspace identity and idle entries are evicted, bounding map growth and eliminating cross-tenant counter aliasing.

### Modified Capabilities

## Impact

- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow` (line 34) — key changed to composite; eviction added
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::publish` (line 36) — caller updated to pass `captureConfig.tenant_id` to `_allow`

## 1. Add Failing Black-Box Tests

- [ ] 1.1 Add test `bbx-cdc-ratelimit-key-isolation` to `tests/blackbox/` that instantiates `KafkaChangePublisher` with a low `maxEventsPerSecond`, publishes events for two different `tenantId` values that share the same `workspaceId`, and asserts that rate consumption in one tenant does not affect the allowance of the other
- [ ] 1.2 Add test `bbx-cdc-ratelimit-eviction` that publishes a burst of events for one composite key, waits for the window to expire, and then verifies that the rate-limit map entry for that key is absent (map size does not grow permanently)
- [ ] 1.3 Confirm both tests fail (red) against the current unpatched code before proceeding

## 2. Implement the Fix

- [ ] 2.1 Update `_allow` signature from `_allow(workspaceId)` to `_allow(tenantId, workspaceId)` in `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs`
- [ ] 2.2 Replace the map key from `workspaceId` to the composite template literal `` `${tenantId}:${workspaceId}` `` in all `this.windows.get` / `this.windows.set` calls inside `_allow`
- [ ] 2.3 Add eviction logic in `_allow`: after updating the current entry, iterate over `this.windows` entries and delete any whose `windowStart` is older than the window duration (1000 ms) — keeping only currently-active windows
- [ ] 2.4 Update the `publish` method call site: change `this._allow(captureConfig.workspace_id)` to `this._allow(captureConfig.tenant_id, captureConfig.workspace_id)`

## 3. Verify

- [ ] 3.1 Confirm `bbx-cdc-ratelimit-key-isolation` now passes (green)
- [ ] 3.2 Confirm `bbx-cdc-ratelimit-eviction` now passes (green)
- [ ] 3.3 Run `bash tests/blackbox/run.sh`

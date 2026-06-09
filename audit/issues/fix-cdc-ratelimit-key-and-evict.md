# CDC publisher per-workspace rate-limit map is unbounded and keyed without tenant

| Field | Value |
|---|---|
| Change ID | `fix-cdc-ratelimit-key-and-evict` |
| Capability | `change-data-capture` |
| Type | bug |
| Priority | P2 |
| OpenSpec change | `openspec/changes/fix-cdc-ratelimit-key-and-evict/` |

## Why

`KafkaChangePublisher._allow` keys its rate-limit sliding-window `Map` by `workspaceId` alone and never evicts entries. Over the lifetime of a long-lived CDC bridge process this causes unbounded memory growth — one permanent map entry per distinct workspace ever seen. Additionally, keying without `tenantId` is a structural aliasing risk: if two workspaces across different tenants share the same id, their rate-limit windows merge, allowing one tenant to consume rate budget belonging to another.

Code location: `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow` (line 34) — `this.windows.set(workspaceId, ...)`. The composite key `tenantId:workspaceId` used everywhere else in the file (e.g. `deriveTopic`) is absent here.

## What Changes

- Change the map key from `workspaceId` to `${tenantId}:${workspaceId}`.
- Add per-call eviction: delete entries whose `windowStart` is older than the window duration (1 second) and whose window has already been reset, keeping the map bounded to currently-active windows.
- Update the `publish` call site to pass `captureConfig.tenant_id` alongside `captureConfig.workspace_id` to `_allow`.

## Spec delta (EARS)

From `openspec/changes/fix-cdc-ratelimit-key-and-evict/specs/change-data-capture/spec.md`:

**The system SHALL** key each per-workspace rate-limit sliding window by the composite identifier `${tenantId}:${workspaceId}` so that workspaces belonging to different tenants are always tracked in separate, independent counters.

**The system SHALL** remove a rate-limit window entry from the in-process map when the entry's `windowStart` is more than one window duration in the past and no new event has been observed in that window.

**The system SHALL** update the `_allow(tenantId, workspaceId)` signature to require `tenantId` and SHALL NOT accept calls with `workspaceId` alone.

Key scenarios:
- Rate windows for same workspace id under different tenants are isolated (cross-tenant counter aliasing blocked).
- Idle window entries are removed after the window expires (map bounded).
- Active window entries are not prematurely evicted (correctness preserved).
- `publish` passes both tenant and workspace to the rate-limit check.

## Tasks

From `openspec/changes/fix-cdc-ratelimit-key-and-evict/tasks.md`:

- [ ] 1.1 Add test `bbx-cdc-ratelimit-key-isolation` — assert rate consumption in one tenant does not affect another tenant sharing the same workspace id
- [ ] 1.2 Add test `bbx-cdc-ratelimit-eviction` — assert map entry is absent after window expiry
- [ ] 1.3 Confirm both tests fail (red) against current code
- [ ] 2.1 Update `_allow` signature to `_allow(tenantId, workspaceId)`
- [ ] 2.2 Replace map key with composite `` `${tenantId}:${workspaceId}` ``
- [ ] 2.3 Add eviction logic in `_allow` — delete entries older than the window duration
- [ ] 2.4 Update `publish` call site to pass both `captureConfig.tenant_id` and `captureConfig.workspace_id`
- [ ] 3.1 Confirm `bbx-cdc-ratelimit-key-isolation` passes (green)
- [ ] 3.2 Confirm `bbx-cdc-ratelimit-eviction` passes (green)
- [ ] 3.3 Run `bash tests/blackbox/run.sh`

## Acceptance criteria

- `bbx-cdc-ratelimit-key-isolation`: two workspaces with identical `workspaceId` but different `tenantId` have fully independent rate-limit counters.
- `bbx-cdc-ratelimit-eviction`: the `this.windows` map size does not grow monotonically across distinct workspaces; idle entries are absent after one window duration.
- `bash tests/blackbox/run.sh` passes green.
- No change to the Kafka topic schema, event format, or metrics label set.

## Code evidence

- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow` — line 34: `this.windows.set(workspaceId, current)` keyed by `workspaceId` only; no eviction
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::publish` — line 36: `this._allow(captureConfig.workspace_id)` single-arg call
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` — lines 26-29: dual-dimension `${tenantId}.${workspaceId}.pg-changes` pattern already established in the same file, not replicated in `_allow`
- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs` constructor — line 32: `this.windows = new Map()` with no size bound or TTL

## Resolution (OpenSpec)

```
/opsx:apply fix-cdc-ratelimit-key-and-evict
/opsx:verify fix-cdc-ratelimit-key-and-evict
bash tests/blackbox/run.sh
/opsx:archive fix-cdc-ratelimit-key-and-evict
```

Shorthand: `/fix-bug fix-cdc-ratelimit-key-and-evict`

Optional real-stack validation: `/e2e-issue fix-cdc-ratelimit-key-and-evict`

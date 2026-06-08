## Context

`KafkaChangePublisher._allow(workspaceId)` maintains a sliding-window counter map (`this.windows`) that is keyed by `workspaceId` alone and has no eviction logic. The map is an instance field of a long-lived object and grows one entry per distinct `workspaceId` ever processed — an unbounded resource. Because `publish` already receives the full `captureConfig` (which carries both `tenant_id` and `workspace_id`), the composite key is available with zero additional I/O. The `deriveTopic` function in the same file already uses both dimensions (`tenantId.workspaceId.pg-changes`), demonstrating the established namespacing pattern.

## Goals / Non-Goals

**Goals:**
- Bound the rate-limit window map to currently-active windows; prevent monotonic growth.
- Key windows by composite `tenantId:workspaceId` to eliminate cross-tenant aliasing.
- Align `_allow` signature with the dual-dimension identity available in `publish`.

**Non-Goals:**
- Changing the rate-limit algorithm (sliding 1-second window with `maxEventsPerSecond` ceiling).
- Introducing a new external store (Redis, DB) for distributed rate limiting.
- Modifying `publish`'s external API or the Kafka topic schema.

## Decisions

**Decision: Evict on every `_allow` call, not on a background timer.**
Rationale: The simplest, zero-dependency approach. On each `_allow` invocation, after updating the current entry, scan for and delete any entry older than one window duration. In the common case (few active workspaces), this is O(active workspaces) — negligible. A background timer would add concurrency concerns.

**Alternative considered:** Use a `WeakMap` or `LRU` cache with a size cap. Rejected: `WeakMap` keys must be objects (not strings); an LRU cap would arbitrarily evict hot workspaces. Expiry-based eviction is semantically correct.

## Risks / Trade-offs

**Risk:** On-every-call eviction scan is O(map size) — potentially slow if the map is large before the fix ships.
**Mitigation:** After the fix, the map size is bounded by active windows (workspaces with events in the last second), which is orders of magnitude smaller than the historical count. The one-time cost of the initial large-map scan is acceptable.

**Risk:** Composite key changes the map-key format — any code that reads `this.windows` by `workspaceId` alone will miss entries.
**Mitigation:** `this.windows` is a private implementation detail (`_allow` is by convention private). No external code reads the map directly. The change is local to `KafkaChangePublisher`.

## Migration Plan

No schema changes, no API changes, no configuration changes. The fix is a targeted in-place edit of `KafkaChangePublisher._allow` and the call site in `publish`. Existing metrics labels (`workspace_id`) are unchanged. No data migration required.

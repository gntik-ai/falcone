## Why

Multiple secondary validation paths in the event-gateway pass values
through without checking the invariants their callers assume, opening
tenant-isolation and operator-visibility gaps. From
`openspec/audit/cap-f1-event-gateway.md`:

- **B5** (`services/event-gateway/src/kafka-integrations.mjs:160-168`) —
  bridge `sourceWorkspaceId`/`sourceTenantId` are validated against the
  caller's context, but the target topic's ownership is taken on faith.
  A bridge can be defined that pushes events from workspace A's source
  into workspace B's topic if the topic resolver hands back an opaque
  reference.
- **B6** (`services/event-gateway/src/runtime.mjs:579-580`) —
  `cursorStart` is validated against `EVENT_GATEWAY_REPLAY_MODES`, but
  that set includes `from_timestamp` and `window` which are
  replay-window descriptors, not cursor positions. A subscription with
  `cursorStart: 'from_timestamp'` and no timestamp passes validation.
- **B8** (`services/event-gateway/src/runtime.mjs:450-452`) — partition
  validation is guarded by `if (topic.partitionCount && …)`. If
  `partitionCount` is `0`/`undefined`/missing, the explicit partition
  value is not bounds-checked at all; `Number.MAX_SAFE_INTEGER` is
  accepted.
- **B12** (`services/event-gateway/src/kafka-integrations.mjs:441-465`) —
  dashboard Prometheus query strings interpolate `workspace_id` into
  hand-written PromQL with no cross-check against the metric names
  declared in `EVENT_GATEWAY_REQUIRED_METRICS`. A metric rename
  silently breaks every dashboard widget.
- **G11** (cross-cutting) — there is no test that asserts the dashboard
  queries reference declared metrics.

## What Changes

- Add a target-topic ownership check inside
  `validateEventBridgeDefinition`: assert
  `topic.workspaceId === context.workspaceId` and
  `topic.tenantId === context.tenantId`.
- Split `EVENT_GATEWAY_CURSOR_START_MODES` (`latest`, `earliest`,
  `last_event_id`) from `EVENT_GATEWAY_REPLAY_MODES`; require
  `cursorStart` to use the cursor set, and require a paired
  `replay.fromTimestamp`/`replay.window` when the replay set is used.
- Replace the `topic.partitionCount &&` short-circuit with an
  affirmative requirement: a topic without a known `partitionCount` MUST
  reject explicit-partition publishes.
- Build dashboard widget queries from a metric-name registry exported by
  `runtime.mjs`; fail the dashboard builder if any referenced metric is
  not in `EVENT_GATEWAY_REQUIRED_METRICS`.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: tenant-isolation on bridges, semantic
  separation of cursor vs. replay modes, partition-bounds enforcement,
  and metric-name verification for dashboards.

## Impact

- **Affected code**: `services/event-gateway/src/runtime.mjs`
  (cursor/replay split, partition guard),
  `services/event-gateway/src/kafka-integrations.mjs` (bridge
  ownership, dashboard registry).
- **Migration**: none.
- **Breaking changes**: subscriptions that previously passed
  `cursorStart: 'from_timestamp'` without a paired timestamp will be
  rejected. Bridges currently defined across tenant boundaries (likely
  none in production, but possible) will be rejected.
- **Out of scope**: dead-letter-topic guard for
  `failurePolicy === 'dead_letter_only'` (tracked separately under
  `fix-f1-*` if it materialises).

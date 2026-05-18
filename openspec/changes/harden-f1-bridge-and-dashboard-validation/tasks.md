## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to
      `tests/unit/event-kafka-integrations.test.mjs` that calls
      `validateEventBridgeDefinition` with a `context.workspaceId =
      'ws-A'` and a `topic.workspaceId = 'ws-B'`; assert the call
      rejects with a tenant-isolation violation.
- [ ] 1.2 [test] Add a case to `tests/unit/event-gateway-runtime.test.mjs`
      that submits `cursorStart: 'from_timestamp'` without
      `replay.fromTimestamp` and asserts the call rejects with a
      cursor/replay violation.
- [ ] 1.3 [test] Add a case that submits an explicit `partition: 999`
      against a topic whose `partitionCount` is `undefined`; assert the
      call rejects rather than silently accepting (B8).
- [ ] 1.4 [test] Add a case to `tests/unit/event-kafka-integrations.test.mjs`
      that calls `buildWorkspaceEventDashboard` with the metric-name
      registry stubbed to omit
      `in_falcone_event_gateway_publish_total`; assert the builder
      throws rather than emitting a broken PromQL widget.

## 2. Implementation

- [ ] 2.1 [fix] Extend
      `services/event-gateway/src/kafka-integrations.mjs:160-168` to
      assert target topic ownership equals the caller's
      tenant/workspace; add the violation code
      `bridge_target_owned_by_other_workspace`.
- [ ] 2.2 [fix] Add `EVENT_GATEWAY_CURSOR_START_MODES` (cursor-only set)
      to `services/event-gateway/src/runtime.mjs`; update the validation
      at `:579-580` to use it; require a paired
      `replay.fromTimestamp` when the replay set is used.
- [ ] 2.3 [fix] Replace the `if (topic.partitionCount && …)` short-circuit
      at `:450-452` with an explicit requirement that
      `partitionCount > 0` is present whenever an explicit partition is
      requested; reject otherwise.
- [ ] 2.4 [fix] Export a metric-name registry from
      `services/event-gateway/src/runtime.mjs` derived from
      `EVENT_GATEWAY_REQUIRED_METRICS`; have
      `buildWorkspaceEventDashboard`
      (`kafka-integrations.mjs:441-465`) reference the registry and
      throw on any unknown metric name.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:unit -- event-gateway-runtime
      event-kafka-integrations` and `openspec validate
      harden-f1-bridge-and-dashboard-validation --strict`; both green
      before merge.

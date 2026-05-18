## Why

The event-gateway plan-tier resolver is fail-open: every unknown or malformed
`planId` silently downgrades to `'starter'`, which dictates every downstream
quota. From `openspec/audit/cap-f1-event-gateway.md`:

- **B1** (`services/event-gateway/src/runtime.mjs:138-147`) — `derivePlanTier`
  uses a case-insensitive substring match. `'pln_freebie'` (unknown) returns
  `'starter'` with no log, no violation, no operator-visible signal.
- **B7** (`services/event-gateway/src/runtime.mjs:138-147`) — same routine: a
  typo (`'pln_growht'`) yields `'starter'` instead of `'growth'`. The
  substring matcher also matches `'enterprise'` anywhere inside an arbitrary
  string, so a crafted id can spoof a tier upward as easily as it can be
  downgraded.
- **B13** (`services/event-gateway/src/runtime.mjs:138-147` + per-tier
  `acks` map) — unknown plans land on starter, whose profile only permits
  implicit ACK. A mis-tagged enterprise tenant loses explicit-ACK semantics
  with no recovery path.

## What Changes

- Replace the substring match with an exact match against a registered
  plan-tier table loaded from configuration, and require every `planId`
  reaching the gateway to be present in that table.
- Fail closed on unknown plans: throw a typed
  `EventGatewayUnknownPlanError` that propagates a `403`-equivalent
  violation rather than silently degrading.
- Emit an audit event (`console.event_gateway.plan_resolution_failed`) on
  every unknown-plan rejection so provisioning drift is observable.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: plan-tier resolution becomes deterministic and
  fail-closed for the event-gateway publish/subscribe path.

## Impact

- **Affected code**: `services/event-gateway/src/runtime.mjs` (resolver +
  profile selection), `services/event-gateway/src/contract-boundary.mjs`
  (register table export), `apps/control-plane/src/events-admin.mjs`
  (surface the new error class).
- **Migration**: none — plan ids are not persisted by the gateway. The
  upstream provisioning-orchestrator already writes the canonical plan ids.
- **Breaking changes**: tenants whose `planId` was previously matched by
  substring but is not in the registered table will now be rejected. This
  is the intended behaviour — those tenants were being silently
  mis-tiered. Surface in PR description for ops to backfill the table.
- **Out of scope**: per-plan capability flags (covered by C1 work).

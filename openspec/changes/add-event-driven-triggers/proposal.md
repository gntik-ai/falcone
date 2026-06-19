# add-event-driven-triggers

## Change type
enhancement

## Capability
events

## Priority
P2

## Why
Kafka->function trigger is not deployed (404); event->flow is blocked by the missing trigger schema (see C3).

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: event->function trigger 404 on GW+EXEC; event->flow trigger registration 502 (missing tables).

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/13-storage-events-functions.md`.

## What Changes
Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow.

## Status (SUPERSEDED for event→flow; function-trigger DEFERRED — corrected scope, 2026-06-19)
Split after verifying against current code:

- **event → flow: already delivered.** The platform-event trigger consumer is wired by the archived
  `add-event-trigger-integration` (#564): `main.mjs::bootFlowTriggers()` (called in the boot
  ensureSchema chain) → `flow-trigger-registry.mjs::wireFlowTriggers()` starts a tenant-scoped KafkaJS
  consumer over the union of registered physical topics and calls `flowExecutor.startTriggeredExecution`
  on a matching event. The re-run's only blocker was the missing `flow_trigger_registrations` /
  `flow_trigger_secrets` tables, fixed by `fix-flow-trigger-schema` (#592, already landed in the P1
  batch). Coverage: `tests/blackbox/event-trigger-integration.test.mjs`, `tests/blackbox/flows-triggers.test.mjs`,
  `tests/env/flows-triggers/trigger-lifecycle.test.mjs`. So "publishing an event starts a workflow
  E2E" is satisfied (to be confirmed on the re-stood-up clean-HEAD cluster).
- **event → function (direct): genuinely unwired, DEFERRED.** The catalog documents
  `createFunctionKafkaTrigger` (`POST /v1/functions/actions/{resourceId}/kafka-triggers`,
  public-route-catalog.json) but it is not deployed. A direct Kafka→Knative-function binding is a
  substantial net-new consumer + handler (separate from the flow trigger plane) — a "big feature"
  per the current triage, not a low-risk fix. In the flow-centric model the event→function effect is
  already achievable via a platform-event-triggered flow whose task invokes the function.

**Decision:** close GitHub issue #610 as superseded-for-event→flow (#564 + #592); track the direct
`createFunctionKafkaTrigger` binding as a separate deferred feature. No code change here.

## Impact
Publishing an event starts a workflow end-to-end (delivered via #564 + #592); direct event→function
binding deferred.

Dependencies: Depends on C3 (fix-flow-trigger-schema #592, landed).

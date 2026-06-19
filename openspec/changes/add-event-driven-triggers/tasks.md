# Tasks — add-event-driven-triggers

## Status: SUPERSEDED for event→flow (#564 + #592); event→function DEFERRED
- [x] Verified the platform-event → flow trigger consumer is wired (`main.mjs::bootFlowTriggers` → `flow-trigger-registry.mjs::wireFlowTriggers`, KafkaJS consumer → `startTriggeredExecution`) by the archived `add-event-trigger-integration` (#564); the missing trigger tables were fixed by `fix-flow-trigger-schema` (#592, landed). Coverage already exists: `tests/blackbox/event-trigger-integration.test.mjs`, `tests/env/flows-triggers/trigger-lifecycle.test.mjs`.
- [x] Confirmed the only genuine residual is the documented-but-unwired `createFunctionKafkaTrigger` (direct event→function binding) — a substantial net-new consumer, tracked as a separate deferred feature.
- [x] Recorded the corrected scope in `proposal.md`; close GitHub issue #610 as superseded-for-event→flow.
- [ ] Live: publish a matching event on the re-stood-up clean-HEAD cluster → a bound flow execution starts (event→flow E2E).

## Archive
- [ ] Withdraw/cancel this change for the event→flow part (covered by #564 + #592); file the direct event→function binding (`createFunctionKafkaTrigger`) as its own feature if/when prioritized.

# Tasks — fix-flow-trigger-schema

## Reproduce (test-first)
- [x] `tests/blackbox/flow-trigger-schema-bootstrap.test.mjs` — fails on old code: the boot ensureSchema chain never invoked the trigger store's `ensureSchema()`, so the tables were absent at publish time.

## Implement (kind runtime AND shippable product as applicable)
- [x] `apps/control-plane/src/runtime/main.mjs`: create a single `triggerStore` on the metadata pool and run `triggerStore.ensureSchema()` in the boot chain (when flows are enabled); reuse it in `bootFlowTriggers`. (The CREATE TABLE statements for `flow_trigger_registrations` / `flow_trigger_secrets` already live in `flow-trigger-registry.mjs`; they were simply never executed.)

## Verify
- [x] `node --test tests/blackbox/flow-trigger-schema-bootstrap.test.mjs` green; flows-triggers / -catalog / event-trigger-integration unaffected.
- [x] Acceptance: publishing a flow with a platform-event/webhook trigger no longer 502s on a missing relation; the event→flow / webhook path is wired.

## Archive
- [ ] `openspec validate fix-flow-trigger-schema --strict`; `/opsx:archive fix-flow-trigger-schema` after merge.

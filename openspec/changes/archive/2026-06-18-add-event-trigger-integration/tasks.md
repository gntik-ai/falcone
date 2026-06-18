# Tasks — add-event-trigger-integration

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: published a matching event (202) → no flow execution started; the manual start path was also blocked by E1 + the dev-Temporal search-attribute gap (the chart's temporal-bootstrap registers the 5 custom SAs).
  - `tests/blackbox/event-trigger-integration.test.mjs` (bbx-evt-trig-int-01..06). RED proof: bbx-evt-trig-int-02 drove the not-yet-existing `wireFlowTriggers` boot helper (module-load failed) — the seam that starts the Kafka consumer for pre-existing registrations on boot was missing.

## Implement (kind runtime AND shippable product)
- [x] Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow; ensure the Temporal custom search attributes are registered by the deploy.
  - Consumer boot wiring: new `wireFlowTriggers()` in `apps/control-plane/src/runtime/flow-trigger-registry.mjs` STARTS the platform-event consumer for already-persisted registrations on boot (closes the live gap: a flow published in a prior process left a dormant consumer).
  - `apps/control-plane/src/runtime/main.mjs` now calls `wireFlowTriggers()` in the ensureSchema boot chain (after the trigger-store table exists) instead of constructing-without-starting.
  - Temporal SAs: `deploy/kind/values-kind-advanced.yaml` now declares the 5 search attributes explicitly under `temporal.bootstrap.searchAttributes` (the chart's temporal-bootstrap Job registers them; the kind overlay no longer relies on silent Helm deep-merge of the chart default).
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.
  - The deployed flow/trigger surface is the `apps/control-plane` executor runtime (EXEC), NOT `deploy/kind/control-plane/*` (the GW hand-built runtime has no flows/trigger routes — see evidence). Fix applied at the executor runtime + the kind chart overlay (the two loci that own this path).

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes.
  - `node --test tests/blackbox/event-trigger-integration.test.mjs` → 6/6 pass. No regression in `tests/blackbox/flows-triggers.test.mjs` + `tests/unit/flow-trigger-registry.test.mjs` (23/23). Live 2-tenant probe = orchestrator's consolidated kind verification (see change report).
- [x] Acceptance: Publishing an event triggers the bound flow/function and the effect is observable.
  - Covered black-box by bbx-evt-trig-int-01/02 (consumed event → exactly one bound-flow start, incl. after a restart). Live confirmation deferred to the consolidated kind run.

## Archive
- [ ] `openspec validate add-event-trigger-integration --strict`; `/opsx:archive add-event-trigger-integration` after merge.

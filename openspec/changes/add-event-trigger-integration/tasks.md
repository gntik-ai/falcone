# Tasks — add-event-trigger-integration

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: published a matching event (202) → no flow execution started; the manual start path was also blocked by E1 + the dev-Temporal search-attribute gap (the chart's temporal-bootstrap registers the 5 custom SAs).

## Implement (kind runtime AND shippable product)
- [ ] Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow; ensure the Temporal custom search attributes are registered by the deploy.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Publishing an event triggers the bound flow/function and the effect is observable.

## Archive
- [ ] `openspec validate add-event-trigger-integration --strict`; `/opsx:archive add-event-trigger-integration` after merge.

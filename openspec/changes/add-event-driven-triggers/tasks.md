# Tasks — add-event-driven-triggers

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: event->function trigger 404 on GW+EXEC; event->flow trigger registration 502 (missing tables).

## Implement (kind runtime AND shippable product as applicable)
- [ ] Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Publishing an event invokes a function and/or starts a workflow end-to-end.

## Archive
- [ ] `openspec validate add-event-driven-triggers --strict`; `/opsx:archive add-event-driven-triggers` after merge.

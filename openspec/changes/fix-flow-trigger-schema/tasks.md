# Tasks — fix-flow-trigger-schema

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: flow publish with `kind:webhook`/platform-event trigger -> 502; executor logs the missing relation.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Add the trigger tables to the governance migration set.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Event/webhook trigger registration succeeds; an event->flow path runs end-to-end.

## Archive
- [ ] `openspec validate fix-flow-trigger-schema --strict`; `/opsx:archive fix-flow-trigger-schema` after merge.

# Tasks — fix-mongo-indexes-missing-collection

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: indexes on a missing collection → 500.

## Implement (kind runtime AND shippable product)
- [ ] Return 404 for a missing collection — kind `mongo-handlers.mjs` + product handler.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: 404 not 500.

## Archive
- [ ] `openspec validate fix-mongo-indexes-missing-collection --strict`; `/opsx:archive fix-mongo-indexes-missing-collection` after merge.

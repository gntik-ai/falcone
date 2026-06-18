# Tasks — fix-pg-insert-request-contract

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: insert `{row:{.

## Implement (kind runtime AND shippable product)
- [ ] Align the handler with the contract (or vice-versa) + a contract test — `apps/control-plane` executor + OpenAPI.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The documented body inserts a row.

## Archive
- [ ] `openspec validate fix-pg-insert-request-contract --strict`; `/opsx:archive fix-pg-insert-request-contract` after merge.

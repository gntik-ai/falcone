# Tasks — fix-flows-worker-pg-env-and-search-attrs

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: flow create->publish->execute reaches a terminal Temporal state, but `db.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Inject the PG env into the worker; run a search-attribute bootstrap step on deploy.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A flow's `db.query` activity returns rows; flow execution does not 500 on a missing search attribute.

## Archive
- [ ] `openspec validate fix-flows-worker-pg-env-and-search-attrs --strict`; `/opsx:archive fix-flows-worker-pg-env-and-search-attrs` after merge.

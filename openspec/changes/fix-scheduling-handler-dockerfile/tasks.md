# Tasks — fix-scheduling-handler-dockerfile

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: any `/v1/scheduling/*` request crashes 500 before business logic; the .

## Implement (kind runtime AND shippable product as applicable)
- [ ] Add the COPY for the scheduling handler (and a startup check that every route-map handler resolves).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: `/v1/scheduling/*` returns business responses; the image build fails if a route-map handler is missing.

## Archive
- [ ] `openspec validate fix-scheduling-handler-dockerfile --strict`; `/opsx:archive fix-scheduling-handler-dockerfile` after merge.

# Tasks — fix-iam-route-wiring

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: `GET /v1/iam/realms/{id}/users/{userId}`, `GET/DELETE .

## Implement (kind runtime AND shippable product as applicable)
- [ ] Register the handlers (or remove them from the catalog).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Catalogued IAM routes resolve to their handlers.

## Archive
- [ ] `openspec validate fix-iam-route-wiring --strict`; `/opsx:archive fix-iam-route-wiring` after merge.

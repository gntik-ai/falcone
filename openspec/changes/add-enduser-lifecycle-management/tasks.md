# Tasks — add-enduser-lifecycle-management

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: `DELETE /v1/iam/realms/{realm}/users/{id}` and status PATCH → 404 NO_ROUTE.

## Implement (kind runtime AND shippable product)
- [ ] Implement the disable/delete (and status) end-user routes scoped to the owner's realm — kind `b-handlers.mjs` (iam) + product IAM service.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Owner disables then deletes an app end-user; the user can no longer authenticate.

## Archive
- [ ] `openspec validate add-enduser-lifecycle-management --strict`; `/opsx:archive add-enduser-lifecycle-management` after merge.

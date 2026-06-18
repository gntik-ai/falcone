# Tasks — fix-console-operator-shell

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: as `acme-ops` (tenant_owner), my-plan/plans/tenants -> 403; `/v1/console/session` -> 404.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Drive operator pages from operator-authorized routes (own-scope) or hide them by role; remove/implement `/v1/console/session`.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An operator logs in and sees their own tenant/plan/workspaces; no dead session route.

## Archive
- [ ] `openspec validate fix-console-operator-shell --strict`; `/opsx:archive fix-console-operator-shell` after merge.

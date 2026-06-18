# Tasks — fix-mongo-browse-tenant-scope

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: `acme-ops` JWT → `GET .

## Implement (kind runtime AND shippable product)
- [ ] Scope the control-plane mongo handlers by the caller's tenant (filter by `tenantId`, restrict listable names to the caller's workspaces) or route document reads through the scoped executor — kind `mongo-handlers.mjs` + product handler.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Cross-tenant document read/list → empty/403; own data intact; live 2-tenant probe.

## Archive
- [ ] `openspec validate fix-mongo-browse-tenant-scope --strict`; `/opsx:archive fix-mongo-browse-tenant-scope` after merge.

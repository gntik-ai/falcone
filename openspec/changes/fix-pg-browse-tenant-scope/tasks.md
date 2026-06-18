# Tasks — fix-pg-browse-tenant-scope

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: `acme-ops` → `GET /v1/postgres/databases` shows globex DBs + `in_falcone` (23 internal tables); `.

## Implement (kind runtime AND shippable product)
- [ ] Restrict the database list to `workspace_databases` rows owned by the caller's tenant; reject browse on non-owned DBs; never expose `in_falcone` — kind `pg-handlers.mjs` + product handler.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: acme sees only acme's DBs; globex/internal DBs hidden; live probe.

## Archive
- [ ] `openspec validate fix-pg-browse-tenant-scope --strict`; `/opsx:archive fix-pg-browse-tenant-scope` after merge.

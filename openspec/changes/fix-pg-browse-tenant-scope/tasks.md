# Tasks — fix-pg-browse-tenant-scope

## Reproduce (test-first)
- [x] Failing black-box test reproduces the leak: `tests/blackbox/pg-browse-tenant-scope.test.mjs` (bbx-551-01..05). RED on the pre-fix handlers (database list returned every tenant's `wsdb_*` + `in_falcone`; by-name browse had no ownership guard so it proceeded into the DB), GREEN after.

## Implement (kind runtime AND shippable product)
- [x] Restrict the database list to `workspace_databases` rows owned by the caller's tenant; reject browse on non-owned DBs; never expose `in_falcone` — `deploy/kind/control-plane/pg-handlers.mjs`: `pgListDatabases` now filters by `callerTenantScope`; a shared `assertDbScope(ctx)` guard (reusing the P0 `tenant-scope.mjs` `canManageTenant`) fronts all 8 by-name browse handlers (schemas/tables/columns/indexes/policies/security/views/matviews) and 404s cross-tenant/system DBs with no existence leak. Platform callers (superadmin/internal) keep full-cluster visibility.
- [x] DUAL-LOCUS determination: the shippable product's Postgres surface is already tenant-scoped — `apps/control-plane/src/runtime/server.mjs` routes Postgres data/DDL through `executePostgresData({ workspaceId, identity, … })` (the executor enforces ownership, same as the P0 finding). The unscoped **cluster-wide metadata list + raw-db-name browse is a kind-only console-browser reimplementation**, so (like the four P0 fixes) the fix is confined to `deploy/kind/control-plane/*`. No product handler exposes the leaky list.

## Verify
- [x] `node --test tests/blackbox/pg-browse-tenant-scope.test.mjs` → 5/5 green. (Full suite + CI quality subset in the batch barrier.)
- [ ] Acceptance (live): acme sees only acme's DBs; globex/internal DBs hidden — folded into the consolidated live RED→GREEN verification on kind.

## Archive
- [ ] `openspec validate fix-pg-browse-tenant-scope --strict`; archive in the batch (after the combined commit closing the issue).

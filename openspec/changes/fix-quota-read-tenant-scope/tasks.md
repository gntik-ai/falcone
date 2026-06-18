# Tasks — fix-quota-read-tenant-scope

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: `acme-ops` → `GET /v1/tenants/{globex}/quota/effective-limits|audit` → 200 (no 403).

## Implement (kind runtime AND shippable product)
- [ ] Add the own-tenant guard used by `/plan/*` to the quota read routes (kind + product).
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Cross-tenant quota reads → 403.

## Archive
- [ ] `openspec validate fix-quota-read-tenant-scope --strict`; `/opsx:archive fix-quota-read-tenant-scope` after merge.

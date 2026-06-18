# Tasks — fix-metrics-tenant-authorization

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: `acme-ops` → `GET /v1/metrics/workspaces/{globex-ws}/series` → 200 with globex's `http_requests_per_second` series; quotas/overview/usage/audit-records for globex → 200; a non-existent id → 200.

## Implement (kind runtime AND shippable product)
- [ ] Apply the own-tenant guard used by `/plan/*` (tenant_owner→own only, superadmin→any) to ALL metrics routes, in the kind `metrics-handlers.mjs` and the product metrics handler.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Cross-tenant metrics → 403; own → 200; live probe.

## Archive
- [ ] `openspec validate fix-metrics-tenant-authorization --strict`; `/opsx:archive fix-metrics-tenant-authorization` after merge.

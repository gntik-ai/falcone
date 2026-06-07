## 1. Ownership resolution

- [x] 1.1 Reorder `main` in `secret-rotation-consumer-status.mjs` so that `getActiveVersion(db, secretPath)` is the first repository call, before `listConsumers` and `listPendingPropagations`

## 2. Authorization binding

- [x] 2.1 Rewrite `allowed()` (`secret-rotation-consumer-status.mjs::allowed:3-5`) to accept `auth`, `secretPath`, and the resolved `activeVersion`; for tenant-scoped callers, assert `activeVersion.tenant_id === auth.tenantId`
- [x] 2.2 Return 403/404 when the ownership assertion fails or when `activeVersion` is null/undefined for a tenant-scoped caller
- [x] 2.3 Exempt platform-scoped callers (e.g. `superadmin`, `platform-operator`) from the ownership assertion, following the pattern in `privilege-domain-assign.mjs::isAuthorized:8-11`
- [x] 2.4 Ensure `listConsumers` and `listPendingPropagations` are only called after a passing ownership assertion

## 3. Verification

- [x] 3.1 Add black-box test `bbx-sec-consumer-status-cross-tenant-01`: tenant A caller requests consumer status for tenant B's `secretPath` — expect 403/404
- [x] 3.2 Add black-box test: same-tenant caller reads their own consumer status — expect 200 with data
- [x] 3.3 Add black-box test: platform-scoped caller reads any tenant's consumer status — expect 200 with data
- [x] 3.4 Add black-box test: `secretPath` with no active version returns 403/404 for tenant-scoped caller
- [x] 3.5 Run `bash tests/blackbox/run.sh`

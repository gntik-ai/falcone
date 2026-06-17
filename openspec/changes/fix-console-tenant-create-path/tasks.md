## 1. Failing black-box test

- [x] 1.1 Add a test asserting the console "new tenant" wizard targets `POST /v1/tenants` (not `/v1/admin/tenants`). — `apps/web-console/src/components/console/wizards/CreateTenantWizard.test.tsx` now asserts `submitWizardRequest('/v1/tenants', { method:'POST', ... })`; RED before the fix (it asserted `/v1/admin/tenants`). The test mocks `submitWizardRequest`/session so it runs independently of the known-broken console-context baseline.

## 2. Fix the console target

- [x] 2.1 Repoint the wizard from `/v1/admin/tenants` to `POST /v1/tenants`. — `CreateTenantWizard.tsx:46`. (The other console admin calls — `/v1/admin/tenants/{id}/config/export|validate|migrate|reprovision|...` — are NOT broken: they are wired in the runtime route map, so only the tenant-creation path needed repointing.)

## 3. Verify

- [x] 3.1 Re-run the wizard test — confirms the wizard targets the real route. — `npx vitest run CreateTenantWizard.test.tsx` → 3/3 pass. Console test baseline (broken on main) is unaffected: this test doesn't depend on the failing console-context bootstrap.
- [x] 3.2 Run `bash tests/blackbox/run.sh` — no backend regressions (console-only change).

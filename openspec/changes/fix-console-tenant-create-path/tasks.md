## 1. Failing black-box test

- [ ] 1.1 Add a black-box/E2E test that drives the console "new tenant" wizard and asserts the resulting request targets `POST /v1/tenants` (not `/v1/admin/tenants`) and creates the tenant. Confirm RED (404 today).

## 2. Fix the console target

- [ ] 2.1 Repoint the wizard's `submitWizardRequest` call and related admin calls from `/v1/admin/tenants` to the real `POST /v1/tenants` route.

## 3. Verify

- [ ] 3.1 Re-run the wizard test — confirm tenant creation from the console succeeds.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.

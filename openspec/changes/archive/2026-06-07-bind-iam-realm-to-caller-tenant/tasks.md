## 1. Extend validateIamAdminRequest with tenantId

- [ ] 1.1 Add a `tenantId` parameter to the signature of `validateIamAdminRequest` in `services/adapters/src/keycloak-admin.mjs:285-323`
- [ ] 1.2 For non-platform-scoped requests (`context.scope !== 'platform'`), add the assertion `context.realmId === tenantId` inside `validateIamAdminRequest`; return HTTP 403 (no Keycloak call) on mismatch

## 2. Propagate tenantId from buildIamAdminAdapterCall

- [ ] 2.1 In `services/adapters/src/keycloak-admin.mjs::buildIamAdminAdapterCall:489`, pass `tenantId` as an argument to `validateIamAdminRequest` (currently omitted)

## 3. Platform-scope exemption

- [ ] 3.1 Confirm that the `context.scope === 'platform'` branch skips the `realmId === tenantId` assertion so that platform-scoped callers retain unrestricted realm access

## 4. Verification

- [ ] 4.1 Add black-box test `bbx-iam-cross-realm-01`: tenant A caller targets tenant B's `realmId` — expect HTTP 403, no Keycloak mutation
- [ ] 4.2 Add black-box test: same-tenant IAM admin operation succeeds (200/204)
- [ ] 4.3 Add black-box test: platform-scoped caller operates on any tenant's realm — expect success
- [ ] 4.4 Run `bash tests/blackbox/run.sh`

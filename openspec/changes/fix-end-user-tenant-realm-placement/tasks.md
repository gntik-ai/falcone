## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: `POST /v1/auth/signups {tenantId: T}` then assert the user exists in T's `iam_realm` (not `in-falcone-platform`) and carries `tenant_id`/`workspace_id` attributes. Confirm RED.
- [ ] 1.2 Add an assertion that the platform realm contains no signup-created end-users.

## 2. Fix signup realm routing

- [ ] 2.1 Route the self-service signup handler to the tenant's `iam_realm`, mirroring `createTenantUser`.
- [ ] 2.2 Stamp `tenant_id`/`workspace_id` attributes on the created user via the `tenant-context` scope mapping.

## 3. Verify

- [ ] 3.1 Re-run the black-box test — confirm the signup lands in T's realm with tenant claims and the platform realm stays free of end-users.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.

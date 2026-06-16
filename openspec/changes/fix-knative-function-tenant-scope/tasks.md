## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: an authenticated principal of Tenant B invokes/gets/reads activations of Tenant A's function by `resourceId`, asserting HTTP 404/403. Confirm RED.
- [ ] 1.2 Add a positive black-box test: a principal accessing its own tenant's function succeeds.

## 2. Fix function scoping

- [ ] 2.1 Add a `tenant_id` predicate to `getFnAction` and related function lookup queries.
- [ ] 2.2 Add an ownership check on the invoke, get, and activations routes that rejects cross-tenant `resourceId` access with 404/403.

## 3. Verify

- [ ] 3.1 Re-run the cross-tenant black-box test — confirm 404/403.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.

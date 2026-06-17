## 1. Failing black-box test

- [x] 1.1 Add a black-box test: an authenticated principal of Tenant B invokes/gets/reads activations of Tenant A's function by `resourceId`, asserting HTTP 404. Confirmed RED (7 failing, 2 passing before fix). Test at `tests/blackbox/knative-function-tenant-scope.test.mjs` (bbx-fn-scope-01..07).
- [x] 1.2 Add a positive black-box test: a principal accessing its own tenant's function succeeds (bbx-fn-scope-08); superadmin cross-tenant access still works (bbx-fn-scope-09).

## 2. Fix function scoping

- [x] 2.1 Add a `tenant_id` predicate to `getFnAction` (`deploy/kind/control-plane/tenant-store.mjs`): new optional `tenantId` parameter; when non-null, SQL includes `AND tenant_id=$2`.
- [x] 2.2 Add `callerTenantId(identity)` helper in `deploy/kind/control-plane/fn-handlers.mjs`: returns `null` for superadmin/internal (cross-tenant bypass preserved), `identity.tenantId` otherwise. All resourceId-based handler lookups (`fnActionDetail`, `fnInvoke`, `fnActivations`, `fnActivation`, `fnActivationLogs`, `fnActivationResult`, `fnVersions`, `fnRollback`, `fnDeploy` PUT) now pass `callerTenantId(ctx.identity)` to `getFnAction`. Activation routes additionally verify the parent function's ownership after fetching by `activationId`.

## 3. Verify

- [x] 3.1 Re-run the cross-tenant black-box test — all 9 tests GREEN (01-07 cross-tenant reject, 08 own-tenant pass, 09 superadmin pass).
- [x] 3.2 Run `bash tests/blackbox/run.sh` — 609 pass, 0 fail. No regressions.

## 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-callercontext-trust` to `tests/blackbox/` that invokes `async-operation-query` with `callerContext: { actor: { id: "x", type: "superadmin" }, tenantId: "ten_B" }` in the request body (without gateway-trusted headers) and asserts the response is NOT 200 with tenant B's operations
- [ ] 1.2 Confirm the test fails (red) against the current unpatched code before proceeding

## 2. Implement the Fix

- [ ] 2.1 Add a `buildCallerContext(params)` factory in a shared helper (e.g., `services/provisioning-orchestrator/src/actions/caller-context.mjs`) that reads `x-tenant-id`, `x-auth-subject`, and `x-actor-type` exclusively from `params.__ow_headers`; return `null` when required headers are absent
- [ ] 2.2 Replace `getCallerContext(params)` with `buildCallerContext(params)` in `services/provisioning-orchestrator/src/actions/async-operation-query.mjs`; reject with `401 UNAUTHORIZED` when `buildCallerContext` returns `null`
- [ ] 2.3 Replace `getCallerContext(params)` with `buildCallerContext(params)` in `services/provisioning-orchestrator/src/actions/async-operation-create.mjs`; reject with `401 UNAUTHORIZED` when `buildCallerContext` returns `null`
- [ ] 2.4 Remove the now-unused `getCallerContext` helper from both action files
- [ ] 2.5 Update any in-repo internal callers that previously passed a `callerContext` body field to instead forward the gateway-trusted headers

## 3. Verify

- [ ] 3.1 Confirm `bbx-callercontext-trust` test now passes (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

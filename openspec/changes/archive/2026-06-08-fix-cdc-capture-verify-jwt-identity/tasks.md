## 1. Add Failing Black-Box Test

- [x] 1.1 Add test `bbx-cdc-forged-tenant` to `tests/blackbox/` that invokes `pg-capture-enable` with a forged unsigned JWT payload carrying `tenant_id: "ten_VICTIM"` and asserts the response is NOT a 201 scoped to the victim tenant
- [x] 1.2 Confirm the test fails (red) against the current unpatched code before proceeding

## 2. Implement the Fix

- [x] 2.1 Extract a shared `parseIdentity(params)` helper (or copy the scheduling-engine pattern) that reads `x-tenant-id`, `x-workspace-id`, `x-auth-subject` from `params.__ow_headers` and returns `null` when any required header is absent
- [x] 2.2 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs`
- [x] 2.3 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs`
- [x] 2.4 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs`
- [x] 2.5 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs`
- [x] 2.6 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs`
- [x] 2.7 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-disable.mjs`
- [x] 2.8 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-list.mjs`
- [x] 2.9 Replace `decodeAuth` usage with `parseIdentity` in `services/provisioning-orchestrator/src/actions/realtime/mongo-capture-tenant-summary.mjs`
- [x] 2.10 Delete or remove the `decodeAuth` local function from all eight files

## 3. Verify

- [x] 3.1 Confirm `bbx-cdc-forged-tenant` test now passes (green)
- [x] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

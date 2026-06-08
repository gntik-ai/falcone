## 1. Reproduce

- [x] 1.1 Write failing black-box test `bbx-config-forged-superadmin` in `tests/blackbox/` that invokes `tenant-config-migrate` with a self-crafted unsigned token carrying `realm_access.roles:["superadmin"]` and `scope:"platform:admin:config:export"` and asserts `statusCode === 401`
- [x] 1.2 Write a parallel failing test for `tenant-config-validate` with a forged `sre` role and assert `statusCode === 401`
- [x] 1.3 Confirm both tests fail (red) before any fix is applied
- [x] 1.4 Run `bash tests/blackbox/run.sh` and record the failure output

## 2. Audit gateway config

- [x] 2.1 Read `services/provisioning-orchestrator/src/actions/realtime/parse-identity.mjs` to determine the trusted-header pattern used for the realtime/CDC actions
- [x] 2.2 Trusted-header path chosen (mirrors parse-identity.mjs precedent)

## 3a. Fix via trusted gateway headers (preferred)

- [x] 3a.1 Created shared helper `services/provisioning-orchestrator/src/actions/tenant-config-identity.mjs` exporting `parseConfigIdentity(params)`
- [x] 3a.2 In each of the eight `tenant-config-*.mjs` files, removed the `extractAuth` function and replaced call with `parseConfigIdentity`
- [x] 3a.3 Actions return `{ statusCode: 401, body: { code: 'UNAUTHORIZED', error: 'Unauthorized: missing identity headers' } }` when headers absent
- [x] 3a.4 `actor_type` derived from trusted roles/scopes: superadmin → 'superadmin', sre → 'sre', admin scope present → 'service_account', else null → 403

## 4. Verify

- [x] 4.1 Run `bash tests/blackbox/run.sh`; all 158 tests pass (13 new, 0 regressions)
- [x] 4.2 Confirmed no existing `tenant-config-*` contract tests regress
- [x] 4.3 Integration test CA-08 fixture updated to inject proper `actor_type: null` auth object (semantically correct post-fix: tenant_owner with identity but no privilege → 403)

## 5. Archive

- [x] 5.1 Run `openspec validate fix-tenant-config-verify-role-claims --strict` — VALID
- [x] 5.2 Run `openspec archive fix-tenant-config-verify-role-claims`

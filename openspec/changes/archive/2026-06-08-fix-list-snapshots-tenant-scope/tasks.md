## 1. Failing black-box test

- [x] 1.1 Add tenant-scope reproduction tests to `services/backup-status/test/unit/operations/list-snapshots.action.test.ts` (vitest, not tests/blackbox — this is a TypeScript service; `node --test` cannot load .ts files). Scenarios: `:own` caller with tenantId=ten_A calling tenant_id=ten_B → 403; `:own` caller calling own tenant → 200; `:global` non-platform-operator calling foreign tenant → 403; platform operator with `:global` calling any tenant → 200.
- [x] 1.2 Reconciliation note: tasks 1.1/1.4/3.1/3.3 originally referenced `tests/blackbox/run.sh`. The reproduction is vitest (`cd services/backup-status && npx vitest run`). `bash tests/blackbox/run.sh` is still run at repo root to confirm no regressions elsewhere (it does not cover this TS file).
- [x] 1.3 Extended `list-snapshots.action.test.ts` with bbx-snapshots-scope-01 through -04. Confirmed RED before fix: 2 failures (scope-02: :own+own→200 got 403; scope-03: :global+non-platform-op→403 got 200).
- [x] 1.4 Run `cd services/backup-status && npx vitest run` — confirmed RED.

## 2. Fix action layer

- [x] 2.1 In `services/backup-status/src/api/backup-status.auth.ts`: added `actorType?: string` to `TokenClaims`; populated `actorType: payload.actor_type ?? payload.actorType` in both TEST_MODE and production (jwtVerify) branches.
- [x] 2.2 Mirrored the same `actorType` addition in the ESM sibling `services/backup-status/src/api/backup-status.auth.js` (both TEST_MODE and jwtVerify branches).
- [x] 2.3 In `services/backup-status/src/operations/list-snapshots.action.ts::main`: replaced the single `:global` check with dual `:own` / `:global` check mirroring `query-audit.action.ts:62-74`; added `:own` path enforcing `tenant_id === token.tenantId` (403 on mismatch); added `:global` platform-operator gate (`token.actorType !== 'platform_operator' && tenant_id !== token.tenantId` → 403).
- [x] 2.4 Updated pre-existing tests that used `:global` without `actorType` to set `actorType: 'platform_operator'` to preserve their intent (CA-05 in list-snapshots.action.test.ts; contract test in backup-operations-response.contract.test.ts) — these tests exercise the platform-operator happy path, not the IDOR scenario.

## 3. Verify

- [x] 3.1 Run `cd services/backup-status && npx vitest run test/unit/operations/list-snapshots.action.test.ts` → 7/7 GREEN.
- [x] 3.2 Full vitest run: 3 failed (all pre-existing, unrelated to this change) / 109 passed (105 baseline + 4 new). No regressions.
- [x] 3.3 `npm run typecheck` → clean (tsc --noEmit exits 0).
- [x] 3.4 `bash tests/blackbox/run.sh` → 145 pass, 0 fail (identical to baseline).

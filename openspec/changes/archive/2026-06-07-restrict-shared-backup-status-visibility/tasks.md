## 1. Design decision

- [x] 1.1 Choose Option A (platform-only scope gate) and record the rationale in `design.md`
- [x] 1.2 Define and document the permitted contents of shared-instance rows (what fields may be present for non-platform callers): none — non-platform callers receive zero cross-tenant shared rows

## 2. Platform-scope gate

- [x] 2.1 Add `hasPlatformScope` check in `services/backup-status/src/api/backup-status.action.ts::main` and mirror to `backup-status.action.js` — only callers holding `backup-status:read:shared-platform` set `includeShared: true` for the `getByTenant` path
- [x] 2.2 Ensure tenant-scoped callers holding `backup-status:read:technical` but not the platform scope receive `includeShared: false`; also add defensive post-fetch filter to drop cross-tenant shared rows for non-platform callers on the tenant-query path

## 3. Repository and serialization fix

- [x] 3.1 (Option A) Confirmed: no SQL change needed — the scope gate at the action layer prevents `includeShared=true` for non-platform callers; `getByTenant` SQL itself is unchanged
- [x] 3.2 (Option A) Defensive post-fetch filter added in `backup-status.action.ts` and `backup-status.action.js` before the existing `!hasTechnicalScope` filter

## 4. Verification

- [x] 4.1 Black-box test added (`tests/blackbox/backup-status-shared-row-isolation.test.mjs`): tenant-scoped caller with `backup-status:read:technical` does NOT receive T2-owned shared row (`shared-s3-bucket`) — test FAILED before fix, PASSES after
- [x] 4.2 Black-box test added: platform-privileged caller with `backup-status:read:shared-platform` still receives full shared-row data — PASSES before and after fix
- [x] 4.3 `bash tests/blackbox/run.sh` → 103/103 pass, 0 failures, no regressions

## 1. Design decision

- [ ] 1.1 Choose Option A (platform-only scope gate) or Option B (sanitize shared rows for non-platform callers) and record the rationale in `design.md`
- [ ] 1.2 Define and document the permitted contents of shared-instance rows (what fields may be present for non-platform callers)

## 2. Platform-scope gate

- [ ] 2.1 Add `hasPlatformScope` check in `services/backup-status/src/api/backup-status.action.ts::main:87-109` — only callers holding `backup-status:read:shared-platform` set `includeShared: true`
- [ ] 2.2 Ensure tenant-scoped callers holding `backup-status:read:technical` but not the platform scope receive `includeShared: false`

## 3. Repository and serialization fix

- [ ] 3.1 (Option A) Confirm no SQL change is needed — the scope gate at the action layer prevents `includeShared=true` for non-platform callers
- [ ] 3.2 (Option B) In `services/backup-status/src/api/backup-status.action.ts::serializeComponent:35-54`, suppress `tenant_id`, `detail`, and `adapter_metadata` from shared-instance entries when the caller is non-platform

## 4. Verification

- [ ] 4.1 Add black-box test: tenant-scoped caller with `backup-status:read:technical` does not receive another tenant's identifying data from shared rows (cross-tenant `is_shared_instance=true` rows absent or sanitized)
- [ ] 4.2 Add black-box test: platform-privileged caller with `backup-status:read:shared-platform` still receives full shared-row data
- [ ] 4.3 Run `bash tests/blackbox/run.sh` and confirm green

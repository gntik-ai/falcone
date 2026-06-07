## Why

`services/backup-status/src/db/repository.ts::getByTenant:119-135` has two branches keyed on `includeShared`. The `true` branch issues `OR is_shared_instance = TRUE` with no tenant filter, returning every platform-wide shared row to any caller whose token includes `backup-status:read:technical`. That scope is tenant-holdable — no code restricts it to platform-level callers. The result: a tenant whose token carries `backup-status:read:technical` receives all `is_shared_instance` rows across every tenant, including `tenant_id`, `detail`, and `adapter_metadata` fields (`services/backup-status/src/db/migrations/001_backup_status_snapshots.sql:5-23`). The serializer at `services/backup-status/src/api/backup-status.action.ts::serializeComponent:35-54` surfaces `instance_id` and `detail` when `includeTechnical` is true. This is a guardrail defect — the cross-tenant shared-row exposure may be intentional for SRE visibility, but lacks a formal platform-only gate (source findings: bug-017, iso-010).

## What Changes

- Introduce a dedicated platform-level privilege check before `includeShared` can be set to `true`: only callers holding a platform-scope (e.g. `backup-status:read:shared-platform`) may see cross-tenant shared rows. Tenant-scoped `backup-status:read:technical` callers receive only their own tenant's rows plus own-tenant shared rows, never all-platform shared rows.
- Alternatively (design choice), sanitize shared-instance rows returned to non-platform callers by suppressing `tenant_id` and per-tenant-identifying fields before serialization.
- At minimum, shared-instance rows returned to non-platform callers MUST NOT expose `tenant_id` or per-tenant-identifying content from other tenants.
- `services/backup-status/src/api/backup-status.action.ts::main:87-109` — add `hasPlatformScope` gate controlling `includeShared`.
- `services/backup-status/src/db/repository.ts::getByTenant:119-135` — primary SQL gap addressed by option chosen.
- `services/backup-status/src/api/backup-status.action.ts::serializeComponent:35-54` — suppress identifying fields for non-platform callers if Option B is chosen.

## Capabilities

### New Capabilities

- `backup-restore`: Tenant-scoped visibility guardrail for backup-status shared-instance rows, ensuring cross-tenant shared rows are accessible only to platform-privileged callers and never expose per-tenant-identifying data to ordinary tenant callers.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the backup-restore capability spec -->

## Impact

- `services/backup-status/src/db/repository.ts::getByTenant:119-135` — remove unguarded `OR is_shared_instance = TRUE` for non-platform callers.
- `services/backup-status/src/api/backup-status.action.ts::main:87-109` — add platform-scope check before setting `includeShared: true`.
- `services/backup-status/src/api/backup-status.action.ts::serializeComponent:35-54` — conditionally suppress `tenant_id`/`detail` for shared rows returned to non-platform callers.
- `services/backup-status/src/db/migrations/001_backup_status_snapshots.sql:5-23` — schema reference only; no schema change required.
- Black-box suite: new test confirming a tenant-scoped `read:technical` caller does not receive another tenant's identifying data from shared rows.
- Prerequisite: `verify-backup-status-jwt-signature` must land first — until JWT signature is verified, any caller can self-issue `backup-status:read:technical`.

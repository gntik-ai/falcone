# Design: restrict-shared-backup-status-visibility

## Decision: Option A — Platform-only scope gate

**Chosen:** Option A (platform-only scope gate with a tightly-scoped defensive post-fetch filter).

**Rationale:** The SQL query (`getByTenant` with `includeShared=true`) uses `OR is_shared_instance = TRUE` with no tenant constraint, so cross-tenant shared rows are returned at the DB layer whenever `includeShared=true`. Fixing this at the action layer (before the DB call) is safe, minimal, and does not require touching the repository SQL — the SQL remains correct for the legitimate platform path.

## Changes implemented

### 1. `backup-status.action.ts` (canonical TypeScript) and `backup-status.action.js` (ESM sibling)

**`hasPlatformScope` check added:**
```js
const hasPlatformScope = claims.scopes.includes('backup-status:read:shared-platform')
```

**`getByTenant` call changed:**
```js
// Before (bug):
snapshots = await getByTenant(requestedTenantId, { includeShared: hasTechnicalScope })

// After (fix):
snapshots = await getByTenant(requestedTenantId, { includeShared: hasPlatformScope })
```
This means `includeShared=true` is only sent to the DB when the caller holds `backup-status:read:shared-platform`. Tenant-scoped callers with `read:technical` but no platform scope get `includeShared=false` → `AND is_shared_instance = FALSE` SQL path → no cross-tenant rows possible.

**Defensive post-fetch filter (belt-and-suspenders, tenant-query path only):**
```js
if (requestedTenantId && !hasPlatformScope) {
  snapshots = snapshots.filter((s) => !s.isSharedInstance || s.tenantId === requestedTenantId)
}
```
Ensures that even if `includeShared=true` were somehow triggered on the tenant path without platform scope, any cross-tenant shared row is silently dropped before serialization. This filter runs BEFORE the existing `!hasTechnicalScope` filter.

**`getAll` (global path) is unchanged:**
```js
snapshots = await getAll({ includeShared: hasTechnicalScope })
```
The global path (no `requestedTenantId`) requires `backup-status:read:global` to reach — the spec scope is `getByTenant` only.

### 2. `repository.js` (new ESM sibling of `repository.ts`)

New file created at `services/backup-status/src/db/repository.js`. Mirrors the TypeScript logic as clean ESM (no TypeScript types). Needed by the black-box test and by `backup-status.action.js` at import time.

## Permitted contents of shared rows for non-platform callers

**None.** Non-platform callers receive zero cross-tenant shared rows. With Option A the gate is at the DB query level — `includeShared=false` means the `OR is_shared_instance = TRUE` branch is never triggered for non-platform callers querying by tenant. Own-tenant `is_shared_instance=true` rows (where `tenant_id = requestedTenantId`) are filtered out by the existing `!hasTechnicalScope` check when the caller also lacks `read:technical`.

The defensive post-fetch filter provides belt-and-suspenders: even if `includeShared=true` were triggered, rows where `is_shared_instance=true AND tenant_id != requestedTenantId` are dropped.

Platform callers (`backup-status:read:shared-platform`) may receive full shared-row data including `tenant_id`, `detail`, and `adapter_metadata` as today.

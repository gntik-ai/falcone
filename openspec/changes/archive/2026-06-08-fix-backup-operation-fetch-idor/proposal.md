## Why

`operations.repository.ts::findById` executes `SELECT * FROM backup_operations WHERE id = $1` with no `tenant_id` predicate, and `get-operation.action.ts::main` fetches the record before the access check, then gates only on `token.sub === operation.requesterId`. This allows any authenticated actor to probe arbitrary backup operation IDs across all tenants (existence oracle via 404 vs 403 differential), and any actor holding `backup:read:global` to read every tenant's operation details.

## What Changes

- Add a `tenantId` parameter to `findById` and add `AND tenant_id = $2` to its query.
- In `get-operation.action.ts::main`, pass `token.tenantId` to `findById` so cross-tenant IDs return `null` before the access check.
- Change the access check to gate on `token.tenantId === operation.tenantId` (in addition to the existing requester check) so a mismatched tenant gets a uniform 404, not 403, eliminating the existence oracle.
- All callers of `findById` outside the get-operation action must be audited and updated to pass the appropriate `tenantId`.

## Capabilities

### New Capabilities

- `backup-restore`: Backup operation fetch is scoped by tenant; cross-tenant probes return a uniform 404 with no existence signal.

### Modified Capabilities

## Impact

- `services/backup-status/src/operations/operations.repository.ts::findById` (lines 91-98)
- `services/backup-status/src/operations/get-operation.action.ts::main` (lines 80-88)
- Any internal caller of `findById` that must be updated to supply `tenantId`

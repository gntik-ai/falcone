## Why

`list-snapshots.action.ts::main` (lines 40-66) requires only `backup-status:read:global` and then takes `tenant_id` directly from the caller-supplied query param, listing that tenant's snapshots with no check that `tenant_id === token.tenantId`. Any holder of `backup-status:read:global` can enumerate snapshot inventories for arbitrary tenants simply by varying the `tenant_id` parameter. There is no `:own` scope variant and no tenant-match guard — a structural inconsistency with `query-audit.action.ts:62-74`, which distinguishes `:global` vs `:own` and enforces `params.tenant_id === token.tenantId` for non-global callers.

## What Changes

- Add a `backup-status:read:own` scope path: when the caller holds only `:own`, enforce `tenant_id === token.tenantId` and reject with HTTP 403 if they differ.
- Preserve the existing `:global` path but document that it is restricted to platform operators; do not remove it.
- Add an explicit policy check asserting that `:global` callers are platform operators (e.g. `token.actorType === 'platform_operator'`), so a tenant-scoped role that is accidentally granted `:global` still cannot enumerate foreign snapshots.
- Mirror the guard pattern already established in `query-audit.action.ts:62-74`.

## Capabilities

### New Capabilities

- `backup-restore`: Snapshot listing enforces per-tenant scope; `:own` callers may only list their own tenant's snapshots; `:global` is restricted to platform operators.

### Modified Capabilities

## Impact

- `services/backup-status/src/operations/list-snapshots.action.ts::main` (lines 40-66)
- Contrast reference: `services/backup-status/src/operations/query-audit.action.ts:62-74`

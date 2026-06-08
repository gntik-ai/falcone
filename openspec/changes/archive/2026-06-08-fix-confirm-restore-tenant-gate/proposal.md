## Why

`confirm-restore.action.ts::main` makes `body.tenant_id` optional and only verifies it against the actor's token when it is present as a string (lines 71-75). `ConfirmationsService.confirm` (lines 313-475) never checks `actor.tenantId === request.tenantId`. An actor holding `backup:restore:global` can confirm a pending restore belonging to any tenant simply by omitting `tenant_id` from the request body — the only residual barrier is a UX-style tenant-name confirmation string, which is not an authorization boundary.

## What Changes

- Make `tenant_id` a required field in `confirm-restore.action.ts` and unconditionally enforce `body.tenant_id === token.tenantId` for non-superadmin callers, mirroring the pattern in `initiate-restore.action.ts:46-55`.
- Add an unconditional tenant gate at the top of `ConfirmationsService.confirm`: if `!isSuperadmin && actor.tenantId !== request.tenantId`, throw 403, before any further processing.
- The `tenantNameConfirmation` check (lines 375-378) is retained as a UX safeguard but is no longer the primary authorization boundary.

## Capabilities

### New Capabilities

- `backup-restore`: Restore confirmation is gated by an unconditional tenant ownership check at both the action layer and the service layer; cross-tenant confirmation is rejected regardless of whether `tenant_id` is supplied.

### Modified Capabilities

## Impact

- `services/backup-status/src/api/confirm-restore.action.ts::main` (lines 65-75)
- `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.confirm` (lines 313-475)
- Contrast: `getStatus` (line ~511) and `abort` already have the tenant gate; `confirm` is the only method that is missing it

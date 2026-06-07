## Why

Three independent authorization gaps exist in the restore flow (source finding `bug-003`, amplifies `iso-001`):

**Gap 1 — Scope-only gate without target-tenant binding (initiate):**
`services/backup-status/src/api/initiate-restore.action.ts::main:19-22` accepts the request if the token contains `backup:restore:global` or `superadmin`. Lines 54-75 pass `body.tenant_id` directly as the restore target; `token.tenantId` is placed in the actor context but is never compared to `body.tenant_id`. A caller authenticated for tenant A can POST `{ tenant_id: "<B>" }` and the service initiates a restore for tenant B.

**Gap 2 — Same gap on confirm; `getStatus` leaks another tenant's request:**
`services/backup-status/src/api/confirm-restore.action.ts::main:20-23` has the identical scope-only gate. `ConfirmationsService.getStatus` at `confirmations.service.ts:503` only checks `request.requesterId !== actor.sub` — no assertion that `actor.tenantId === request.tenantId`.

**Gap 3 — Trivially satisfiable tenant-name confirmation:**
`services/backup-status/src/confirmations/confirmations.service.ts::resolveTenantName:171-175` returns `tenantId` itself when no resolver is wired (`return tenantId`). The destructive-action safety check at lines 371-373 compares `body.tenantNameConfirmation` to this echo — passing `tenant_name_confirmation = "<B>"` always satisfies the gate.

These gaps are independently exploitable even when `verify-backup-status-jwt-signature` is present: a legitimately issued JWT for tenant A can be used to overwrite tenant B's data. The prerequisite change `verify-backup-status-jwt-signature` must land first.

## What Changes

- `services/backup-status/src/api/initiate-restore.action.ts::main:19-75` — after scope validation, assert `body.tenant_id === token.tenantId` unless the caller holds a verified platform-level cross-tenant privilege (`superadmin`); return 403 on mismatch.
- `services/backup-status/src/api/confirm-restore.action.ts::main:20-68` — same binding check; update `getStatus` call to pass `actor.tenantId` for verification.
- `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.getStatus:500-514` — assert `actor.tenantId === request.tenantId` (or platform privilege) before returning status.
- `services/backup-status/src/confirmations/confirmations.service.ts::resolveTenantName:171-175` — forbid id-echo default; require an authoritative resolver; fail safely (error) if unconfigured.

## Capabilities

### New Capabilities

- `backup-restore`: Authenticated-tenant binding for restore initiation and confirmation, so that the restore target tenant is always compared to and must match the token's verified `tenantId` unless an explicit platform-level cross-tenant privilege is present.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the backup-restore capability spec -->

## Impact

- Tenant-scoped callers who POST `body.tenant_id` for a different tenant now receive HTTP 403.
- Supplying `tenant_name_confirmation` equal to the raw tenant id no longer satisfies the confirmation gate.
- Platform operators with verified `superadmin` scope (after the sibling fix makes those claims trustworthy) retain cross-tenant restore capability.
- `services/backup-status/src/api/initiate-restore.action.ts::main:54-75` — primary fix target.
- `services/backup-status/src/api/confirm-restore.action.ts::main:20-23` — fix target.
- `services/backup-status/src/confirmations/confirmations.service.ts::resolveTenantName:171-175` — fix target.
- `services/backup-status/src/confirmations/confirmations.service.ts:371-373` — confirmation gate fix target.

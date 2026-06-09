# confirm-restore: cross-tenant restore confirmation when tenant_id omitted

**Relates to #206 (scope-restore-to-authenticated-tenant) — that fix scoped the tenant check narrowly (only when tenant_id is present at the action layer); the service-layer confirm() still has no primary-actor tenant gate, so this residual remains. Consider reopening #206.**

| Field | Value |
|---|---|
| Change ID | `fix-confirm-restore-tenant-gate` |
| Capability | `backup-restore` |
| Type | bug |
| Priority | P0 (Critical) |
| OpenSpec change | `openspec/changes/fix-confirm-restore-tenant-gate/` |

## Why

`confirm-restore.action.ts::main` makes `body.tenant_id` optional and only verifies it against the actor's token when present as a string (lines 71-75). `ConfirmationsService.confirm` (lines 313-475) never checks `actor.tenantId === request.tenantId`. An actor with `backup:restore:global` belonging to tenant B can confirm a pending restore for tenant A simply by omitting `tenant_id` from the body. The only residual barrier is `tenantNameConfirmation` — a UX string match, not an authorization control. This is a destructive cross-tenant operation.

## What Changes

- Make `tenant_id` a required field in `confirm-restore.action.ts` and unconditionally enforce the tenant match for non-superadmin callers (mirroring `initiate-restore.action.ts:46-55`).
- Add an unconditional tenant gate at the top of `ConfirmationsService.confirm`: `if (!isSuperadmin && actor.tenantId !== request.tenantId) throw 403`, before any other decision logic.
- Retain `tenantNameConfirmation` as a UX safety check; it is no longer the primary authorization boundary.

## Spec delta (EARS)

### Requirement: Restore confirmation MUST enforce tenant ownership unconditionally at the service layer

The system SHALL reject a restore confirmation request at the service layer whenever the acting actor's `tenantId` does not match the `tenantId` on the confirmation request, unless the actor holds a documented platform-level superadmin scope, regardless of whether `tenant_id` was supplied in the request body.

#### Scenario: Cross-tenant restore confirmation without tenant_id is rejected (bbx-confirm-restore-crosstenant)

- **WHEN** an actor authenticated for tenant B, holding `backup:restore:global`, calls the confirm-restore endpoint with a valid confirmation token belonging to a pending restore request for tenant A, and the request body does NOT include a `tenant_id` field
- **THEN** the system returns HTTP 403 and does not execute the restore, and no confirmation state change is written to the database

### Requirement: Restore confirmation action layer MUST treat tenant_id as a required field

The system SHALL require the `tenant_id` field in the confirm-restore request body and SHALL unconditionally reject requests where `body.tenant_id` does not match `token.tenantId` for non-superadmin callers, mirroring the behaviour of initiate-restore.

#### Scenario: Omitting tenant_id from confirm-restore body is rejected at the action layer

- **WHEN** a non-superadmin actor submits a confirm-restore request body that does not include a `tenant_id` field
- **THEN** the system returns HTTP 400 indicating that `tenant_id` is a required field

### Requirement: Tenant-name confirmation MUST NOT serve as the sole authorization boundary for restore

The system SHALL treat the `tenantNameConfirmation` field as a UX safety check only; tenant ownership authorization SHALL be enforced by a dedicated tenant identity check that precedes and is independent of the tenant-name string match.

#### Scenario: Knowing the target tenant name does not bypass the tenant ownership gate

- **WHEN** an actor belonging to tenant B submits a confirm-restore request with the correct `tenantNameConfirmation` string for tenant A's restore request, but with `tenant_id` set to tenant A's ID (not the actor's own tenant)
- **THEN** the system returns HTTP 403 before evaluating the tenant-name string, and the restore is not executed

## Tasks

1. Add failing test `bbx-confirm-restore-crosstenant` (tenant B actor + `backup:restore:global`, no `tenant_id`, tenant A's confirmation token → assert 403, no DB state change)
2. Add variant: `tenant_id: <tenantA-id>` in body → assert 403
3. Add variant: omit `tenant_id` entirely → assert 400
4. Run `bash tests/blackbox/run.sh` — confirm RED before fix
5. In `ConfirmationsService.confirm`: add `isSuperadmin` check and early-return 403 when `!isSuperadmin && actor.tenantId !== request.tenantId`
6. In `confirm-restore.action.ts::main`: make `tenant_id` required; enforce match unconditionally for non-superadmin
7. Run `bash tests/blackbox/run.sh` — confirm GREEN after fix

Full checklist: `openspec/changes/fix-confirm-restore-tenant-gate/tasks.md`

## Acceptance criteria

- `bbx-confirm-restore-crosstenant`: tenant B actor with `backup:restore:global`, no `tenant_id` in body, tenant A's confirmation token → HTTP 403, no state change in DB
- Mismatched `tenant_id` in body → HTTP 403
- Missing `tenant_id` in body → HTTP 400
- Legitimate same-tenant confirm flow → HTTP 202 (no regression)
- Superadmin cross-tenant confirm flow → still works

## Code evidence

- `services/backup-status/src/api/confirm-restore.action.ts::main` (lines 71-75) — tenant check conditional on `typeof body.tenant_id === 'string'`; omitting `tenant_id` bypasses the check entirely
- `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.confirm` (lines 313-475) — no `actor.tenantId !== request.tenantId` check anywhere in the method; contrast `getStatus` (line ~511) which has the correct gate
- `services/backup-status/src/confirmations/confirmations.service.ts` (line ~375-378) — `tenantNameConfirmation` is the only tenant-binding check in `confirm()`, and it is a UX string match, not an authorization control

## Resolution (OpenSpec)

1. `/opsx:apply fix-confirm-restore-tenant-gate`
2. `/opsx:verify fix-confirm-restore-tenant-gate`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive fix-confirm-restore-tenant-gate`

Alternative shorthand: `/fix-bug fix-confirm-restore-tenant-gate`

Optional real-stack E2E: `/e2e-issue fix-confirm-restore-tenant-gate`

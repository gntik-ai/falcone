## Context

The restore lifecycle has three action-layer entry points: `initiate-restore.action.ts`, `confirm-restore.action.ts`, and `abort`. The initiate path correctly requires `tenant_id` in the body and unconditionally rejects mismatches (`initiate-restore.action.ts:46-55`). The abort path and `getStatus` in `ConfirmationsService` both check `actor.tenantId !== request.tenantId` at the service layer (`confirmations.service.ts` line ~511). `ConfirmationsService.confirm` (lines 313-475) is the only method that has no such check.

At the action layer, `confirm-restore.action.ts:71-75` applies the tenant check only when `typeof body.tenant_id === 'string'` — making `tenant_id` optional and the check bypassable by omission.

The only barrier remaining when `tenant_id` is absent is `tenantNameConfirmation` (lines 375-378 of the service), which matches the resolved name of `request.tenantId` (the target tenant, not the actor's tenant). This is a UX guard ("type the name of the tenant you are restoring") not an authorization control: the name is visible in the initiate response, and an attacker who obtained the confirmation token already knows the target tenant context.

`verifySecondActor` (for critical-risk requests) does check the second actor's tenant (line ~511), but the primary actor is never checked — so the cross-tenant primary actor successfully reaches the second-factor path.

## Goals / Non-Goals

**Goals:**
- Add an unconditional `actor.tenantId !== request.tenantId` gate at the top of `ConfirmationsService.confirm` before any other logic.
- Make `tenant_id` required in `confirm-restore.action.ts` and enforce the match unconditionally for non-superadmin callers.
- Ensure consistency across all three restore operations (initiate, confirm, abort).

**Non-Goals:**
- Removing the tenant-name UX confirmation (it remains a useful safety step).
- Changing the superadmin bypass path (superadmin legitimately needs cross-tenant capability).
- Modifying the second-factor verification logic (it is correct as-is).

## Decisions

**Decision: Fix at both action layer and service layer.**
Rationale: Defense in depth. The action layer is the first line and should reject clearly malformed requests early. The service layer is the authoritative gate and must be correct regardless of which action (or future internal caller) invokes it.

**Decision: Mirror `initiate-restore` semantics for `tenant_id` in confirm.**
Rationale: The asymmetry between initiate (required, unconditional) and confirm (optional, conditional) is the root cause. Making them consistent eliminates the class of bugs arising from asymmetric validation.

## Risks / Trade-offs

**Risk:** Existing clients that omit `tenant_id` from the confirm request body (e.g., internal services or scripts) will receive a 400 instead of proceeding.
**Mitigation:** This is the intended behavior change. Any client relying on `tenant_id` being optional in confirm is relying on the vulnerable behavior.

**Risk:** The superadmin cross-tenant path must still work without being blocked by the tenant check.
**Mitigation:** The existing `isSuperadmin` check in the service (already used in `getStatus` and `abort`) is the correct bypass; extend the same pattern to `confirm`.

## Migration Plan

No schema changes. Code changes are localized to:

1. `services/backup-status/src/api/confirm-restore.action.ts`: make `tenant_id` required; enforce match unconditionally for non-superadmin.
2. `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.confirm`: add `isSuperadmin = actor.scopes.includes('superadmin')` and an early-return 403 when `!isSuperadmin && actor.tenantId !== request.tenantId`.
3. Update unit tests and add `bbx-confirm-restore-crosstenant` black-box probe.

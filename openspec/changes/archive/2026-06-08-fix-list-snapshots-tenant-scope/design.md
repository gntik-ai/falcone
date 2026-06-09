## Context

`list-snapshots.action.ts::main` (lines 40-66) performs a single scope check:

```
if (!token.scopes.includes('backup-status:read:global')) {
  return { statusCode: 403, ... }
}
```

After that check it reads `tenant_id` from `params` and calls `adapter.listSnapshots(instance_id, tenant_id, context)` with no verification that `tenant_id` matches `token.tenantId`. The caller controls `tenant_id` freely. Any holder of `backup-status:read:global` — including a tenant-scoped role that has been over-granted — enumerates snapshot inventory (snapshot IDs, sizes, labels) for any arbitrary tenant.

The contrast reference is `query-audit.action.ts:62-74`, which models the correct dual-path pattern:

```
const hasGlobal = token.scopes.includes('backup-audit:read:global')
const hasOwn   = token.scopes.includes('backup-audit:read:own')
if (!hasGlobal && !hasOwn) return 403
if (!hasGlobal) {
  if (!params.tenant_id || params.tenant_id !== token.tenantId) return 403
}
```

## Goals / Non-Goals

**Goals:**
- Introduce a `backup-status:read:own` scope that restricts snapshot listing to the caller's own tenant.
- Add a platform-operator guard on the `:global` path so accidental over-grant of `:global` to a tenant role cannot be exploited.
- Mirror the established dual-path pattern from `query-audit.action.ts`.

**Non-Goals:**
- Changing the adapter interface or the downstream snapshot query.
- Introducing a new HTTP route or changing the URL surface.
- Modifying how `validateToken` works.

## Decisions

**Decision: Dual-path guard mirroring `query-audit.action.ts`.**
Rationale: The pattern is already proven and in production for the audit endpoint in the same service. Reusing it minimises the cognitive delta for maintainers and the review surface.

**Decision: Platform-operator check via `token.actorType`.**
Rationale: `actorType` is already present on the validated token (set by `backup-status.auth.ts`). No new fields or claims are required.

**Decision: `:global` is preserved but gated.**
Rationale: Platform-operator tooling legitimately needs to inspect any tenant's snapshots. Removing `:global` entirely would break that use case. The fix narrows who may use it, not what it does.

## Risks / Trade-offs

**Risk:** Existing callers that hold `:global` but are not platform operators (e.g. an internal service account) will start receiving 403 after the change.
**Mitigation:** Audit active scope grants before deploying; reissue affected service accounts with `:own` or promote them to a platform-operator role if cross-tenant access is legitimately required.

**Risk:** The `actorType` field on the token could be spoofed if `validateToken` is in TEST_MODE (bug-007).
**Mitigation:** This fix is independent of bug-007; the correct fix for that is tracked separately. Defenders should treat bug-007 as a prerequisite for full protection.

## Migration Plan

No schema or contract changes required. The migration is purely code-level:

1. In `list-snapshots.action.ts::main`, replace the single `:global` check with the dual `:own` / `:global` pattern.
2. Add the platform-operator guard on the `:global` branch.
3. Add black-box test `bbx-snapshots-scope` before applying the fix.
4. Run `bash tests/blackbox/run.sh` to confirm green.

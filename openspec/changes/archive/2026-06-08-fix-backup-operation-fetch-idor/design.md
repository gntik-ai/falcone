## Context

`operations.repository.ts::findById` (lines 91-98) executes `SELECT * FROM backup_operations WHERE id = $1` with no `tenant_id` column in the WHERE clause. The caller, `get-operation.action.ts::main` (lines 80-88), retrieves the full record first and then checks `token.sub !== operation.requesterId` (line 86). This fetch-before-gate order, combined with the missing tenant predicate, creates two exploitable conditions:

1. Any authenticated actor can learn whether an arbitrary operation ID exists by observing the 404 (not found in DB) vs 403 (found but forbidden) differential.
2. Any actor holding `backup:read:global` reads the full operation record regardless of tenant, since the existing access check only tests requester identity and global scope — there is no `token.tenantId === operation.tenantId` gate anywhere on this path.

For contrast, `findActive` (line 100+) correctly accepts `tenantId` as a parameter and includes it in the query.

## Goals / Non-Goals

**Goals:**
- Eliminate the IDOR by adding `AND tenant_id = $2` to `findById`.
- Remove the 404-vs-403 existence oracle by returning 404 uniformly for cross-tenant misses.
- Ensure `backup:read:global` does not grant cross-tenant single-record access.

**Non-Goals:**
- Changing the broader `backup:read:global` scope semantics for list/aggregate operations.
- Modifying the schema or adding new indexes (the `tenant_id` column already exists on the table, as evidenced by `findActive`).

## Decisions

**Decision: Add `tenantId` parameter to `findById` and filter in SQL.**
Rationale: The SQL layer is the right enforcement point; it prevents any future caller from accidentally bypassing the check. The pattern is already established in `findActive`. All existing callers of `findById` must be updated.

**Decision: Return 404 for cross-tenant misses.**
Rationale: Returning 403 for a cross-tenant ID leaks existence. A uniform 404 is the standard pattern for tenant-scoped resources — it does not reveal whether the resource exists under a different tenant.

## Risks / Trade-offs

**Risk:** Internal callers of `findById` (e.g., within the service or other actions) may not have `tenantId` readily available and will need refactoring.
**Mitigation:** Audit all call sites before merging; the function signature change will cause a compile-time error on every caller, making it impossible to miss.

**Risk:** Platform-operator tooling that legitimately needs to fetch operations across tenants will lose access.
**Mitigation:** Introduce a separate `findByIdGlobal` function (or an optional `tenantId` overload that only superadmin callers may invoke) to serve that use case explicitly, rather than leaving the default fetch unscoped.

## Migration Plan

No schema changes required — `tenant_id` is already a column in `backup_operations`. The migration is purely code-level:

1. Add `tenantId: string` parameter to `findById`; update SQL query.
2. Update `get-operation.action.ts` to pass `token.tenantId`.
3. Update any other internal callers.
4. Run existing unit and black-box test suites; add `bbx-backup-op-idor` cross-tenant probe.

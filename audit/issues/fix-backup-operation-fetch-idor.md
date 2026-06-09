# IDOR: backup operation fetch lacks tenant predicate (cross-tenant read + existence oracle)

**Related: #219 (restrict-shared-backup-status-visibility) — same service, but this is a distinct endpoint/mechanism (unscoped findById + existence oracle), not covered by #219.**

| Field | Value |
|---|---|
| Change ID | `fix-backup-operation-fetch-idor` |
| Capability | `backup-restore` |
| Type | bug |
| Priority | P0 (Critical) |
| OpenSpec change | `openspec/changes/fix-backup-operation-fetch-idor/` |

## Why

`operations.repository.ts::findById` executes `SELECT * FROM backup_operations WHERE id = $1` with no `tenant_id` predicate. The caller `get-operation.action.ts::main` fetches the record before the access check, then gates only on `token.sub === operation.requesterId` (the actor, not the tenant). This creates two exploitable conditions:

1. Any authenticated actor can determine whether an arbitrary operation ID exists across all tenants by observing the 404 (not found) vs 403 (found but forbidden) differential — a cross-tenant existence oracle.
2. Any actor holding `backup:read:global` reads the full operation record (including snapshot IDs, instance IDs, and failure reasons) for any tenant, since the existing check tests requester identity but has no `token.tenantId === operation.tenantId` gate.

## What Changes

- Add `AND tenant_id = $2` to `findById` and require `tenantId` as a parameter.
- Pass `token.tenantId` to `findById` in `get-operation.action.ts::main` so cross-tenant IDs resolve to `null`.
- Return HTTP 404 uniformly for cross-tenant misses, eliminating the 404-vs-403 existence oracle.
- Audit all callers of `findById` and update them to supply `tenantId`.

## Spec delta (EARS)

### Requirement: Backup operation fetch MUST be scoped by tenant

The system SHALL include the authenticated actor's `tenant_id` as a predicate in every query that retrieves a single backup operation by ID, so that operation records belonging to a different tenant are never returned to the caller.

#### Scenario: Cross-tenant operation ID returns 404 not 403 (bbx-backup-op-idor)

- **WHEN** an authenticated actor for tenant A calls the get-operation endpoint with an operation ID that belongs to tenant B
- **THEN** the response is HTTP 404 and the response body does not reveal any detail about the cross-tenant operation, providing no existence signal to the caller

### Requirement: Backup operation access check MUST enforce tenant ownership before revealing existence

The system SHALL perform the tenant-scoped lookup before any access-control decision so that a missing tenant predicate cannot be exploited as an existence oracle distinguishing 404 (not found) from 403 (access denied).

#### Scenario: Cross-tenant probe produces identical response to non-existent ID

- **WHEN** an authenticated actor requests an operation ID that exists in the database but belongs to a different tenant
- **THEN** the system returns the same HTTP 404 response it would return for a non-existent ID, with no body field indicating the operation exists

### Requirement: Global-scope backup read MUST NOT bypass tenant scoping on single-operation fetch

The system SHALL require that a caller holding `backup:read:global` may only read operations for their own tenant via the single-operation fetch endpoint, unless the caller additionally holds a documented platform-operator scope that explicitly grants cross-tenant access.

#### Scenario: Global read scope does not expose cross-tenant operation details

- **WHEN** an actor holding `backup:read:global` but belonging to tenant A requests an operation ID belonging to tenant B
- **THEN** the system returns HTTP 404 and does not return the operation body

## Tasks

1. Add failing test `bbx-backup-op-idor` (GET cross-tenant op ID → assert 404; also with `backup:read:global`)
2. Run `bash tests/blackbox/run.sh` — confirm RED before fix
3. Add `tenantId: string` param to `findById`; update SQL to `WHERE id = $1 AND tenant_id = $2`
4. Update `get-operation.action.ts::main` to pass `token.tenantId`
5. Audit and update all other callers of `findById`
6. Run `bash tests/blackbox/run.sh` — confirm GREEN after fix

Full checklist: `openspec/changes/fix-backup-operation-fetch-idor/tasks.md`

## Acceptance criteria

- `bbx-backup-op-idor`: GET an operation ID belonging to tenant B as tenant A's actor → HTTP 404, no existence-revealing body
- `bbx-backup-op-idor` (global-scope variant): actor with `backup:read:global` in tenant A fetches tenant B's operation → HTTP 404
- Cross-tenant probe response is identical to non-existent ID response (no oracle)
- Existing same-tenant fetch tests remain green

## Code evidence

- `services/backup-status/src/operations/operations.repository.ts::findById` (lines 91-98) — `SELECT * FROM backup_operations WHERE id = $1` with no `tenant_id` predicate
- `services/backup-status/src/operations/get-operation.action.ts::main` (lines 80-88) — `repo.findById(operationId)` called before access check; gate on `token.sub !== operation.requesterId` (actor, not tenant); 404 at line 82, 403 at line 87 (existence oracle)

## Resolution (OpenSpec)

1. `/opsx:apply fix-backup-operation-fetch-idor`
2. `/opsx:verify fix-backup-operation-fetch-idor`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive fix-backup-operation-fetch-idor`

Alternative shorthand: `/fix-bug fix-backup-operation-fetch-idor`

Optional real-stack E2E: `/e2e-issue fix-backup-operation-fetch-idor`

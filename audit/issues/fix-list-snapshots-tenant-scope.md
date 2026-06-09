# list-snapshots lets any global-scope holder read arbitrary tenant snapshots

> Related: #219 (restrict-shared-backup-status-visibility) — same service/theme but a distinct endpoint (list-snapshots :global scope, caller-supplied tenant_id); not covered by #219.

| Field | Value |
|---|---|
| Change ID | `fix-list-snapshots-tenant-scope` |
| Capability | `backup-restore` |
| Type | bug |
| Priority | P1 |
| OpenSpec change | `openspec/changes/fix-list-snapshots-tenant-scope/` |

## Why

`list-snapshots.action.ts::main` (lines 40-66) requires only `backup-status:read:global` and then takes `tenant_id` directly from the caller-supplied query parameter, listing that tenant's snapshots with no check that `tenant_id === token.tenantId`. Any holder of `backup-status:read:global` can enumerate snapshot inventories (snapshot IDs, sizes, labels) for arbitrary tenants by varying `tenant_id`. There is no `:own` scope variant and no tenant-match guard.

The inconsistency is visible by contrast with `query-audit.action.ts:62-74`, which in the same service correctly distinguishes `:global` vs `:own` and enforces `params.tenant_id === token.tenantId` for non-global callers. The missing `:own` path also forces over-privileged grants in practice: any legitimate tenant-scoped consumer of this endpoint must be given `:global`, creating a wider blast radius than necessary.

## What Changes

- Introduce a `backup-status:read:own` scope path that enforces `tenant_id === token.tenantId`, rejecting with HTTP 403 on mismatch.
- Preserve the existing `:global` path but add a platform-operator guard (`token.actorType === 'platform_operator'`); reject with HTTP 403 if a tenant-scoped actor attempts to enumerate a foreign tenant via `:global`.
- Mirror the dual-path pattern established in `query-audit.action.ts:62-74`.

## Spec delta (EARS)

**Requirement: Snapshot listing MUST enforce tenant scope for non-global callers**
The system SHALL reject any snapshot listing request where the caller holds `backup-status:read:own` but `tenant_id` does not match `token.tenantId`, returning HTTP 403 with no snapshot data disclosed.

**Scenario: Own-scope caller cannot list another tenant's snapshots (bbx-snapshots-scope)**
- WHEN an authenticated actor holding `backup-status:read:own` with `tenantId=ten_A` calls list-snapshots with `tenant_id=ten_B`
- THEN the system returns HTTP 403 and does not return any snapshot records belonging to tenant B

**Requirement: Global-scope snapshot listing MUST be restricted to platform operators**
The system SHALL verify that a caller presenting `backup-status:read:global` is a platform operator before listing snapshots for an arbitrary `tenant_id`.

**Scenario: Tenant-scoped actor with global scope is rejected**
- WHEN an authenticated actor whose `actorType` is not `platform_operator` holds `backup-status:read:global` and calls list-snapshots with a `tenant_id` differing from `token.tenantId`
- THEN the system returns HTTP 403 and does not disclose any snapshot records for the requested tenant

Full spec delta: `openspec/changes/fix-list-snapshots-tenant-scope/specs/backup-restore/spec.md`

## Tasks

- [ ] 1.1 Add test `bbx-snapshots-scope`: global-scope actor with tenantId=ten_A requests tenant_B snapshots; assert HTTP 403
- [ ] 1.2 Add test `bbx-snapshots-scope`: own-scope actor with tenantId=ten_A requests tenant_B snapshots; assert HTTP 403
- [ ] 1.3 Add test `bbx-snapshots-scope`: own-scope actor with tenantId=ten_A requests own snapshots; assert HTTP 200
- [ ] 1.4 Run `bash tests/blackbox/run.sh` — confirm tests FAIL before fix
- [ ] 2.1 Replace single `:global` check in `list-snapshots.action.ts::main` with dual `:own` / `:global` pattern mirroring `query-audit.action.ts:62-74`
- [ ] 2.2 Add platform-operator guard on `:global` path
- [ ] 2.3 Enforce `tenant_id === token.tenantId` on `:own` path
- [ ] 3.1 Run `bash tests/blackbox/run.sh` — confirm `bbx-snapshots-scope` is green
- [ ] 3.2 Confirm no regression in existing snapshot-listing tests
- [ ] 3.3 Run `bash tests/blackbox/run.sh`

Full task list: `openspec/changes/fix-list-snapshots-tenant-scope/tasks.md`

## Acceptance criteria

- `bbx-snapshots-scope`: Actor with `backup-status:read:global` and `tenantId=ten_A` requesting `tenant_id=ten_B` receives HTTP 403 (no snapshot data).
- `bbx-snapshots-scope`: Actor with `backup-status:read:own` and `tenantId=ten_A` requesting `tenant_id=ten_B` receives HTTP 403.
- `bbx-snapshots-scope`: Actor with `backup-status:read:own` and `tenantId=ten_A` requesting `tenant_id=ten_A` receives HTTP 200 with only tenant A's snapshots.
- Platform operator with `backup-status:read:global` can still list any tenant's snapshots.
- No regression in existing backup-status tests.

## Code evidence

- `services/backup-status/src/operations/list-snapshots.action.ts::main` — scope check at lines 40-41; caller-supplied `tenant_id` used at lines 44, 66 with no `=== token.tenantId` guard
- `services/backup-status/src/operations/query-audit.action.ts:62-74` — correct dual-path reference implementation in the same service

## Resolution (OpenSpec)

1. `/opsx:apply fix-list-snapshots-tenant-scope` — work through `tasks.md`
2. `/opsx:verify fix-list-snapshots-tenant-scope`
3. `bash tests/blackbox/run.sh`
4. `/opsx:archive fix-list-snapshots-tenant-scope`

Or use the wrapper: `/fix-bug fix-list-snapshots-tenant-scope`

Optional real E2E: `/e2e-issue fix-list-snapshots-tenant-scope`

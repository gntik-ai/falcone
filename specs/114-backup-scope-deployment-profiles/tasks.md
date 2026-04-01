# Tasks: Backup Scope & Limits by Deployment Profile

**Branch**: `114-backup-scope-deployment-profiles` | **Date**: 2026-04-01  
**Task ID**: US-BKP-01-T06 | **Epic**: EP-20 | **Story**: US-BKP-01  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Summary

This task produces a **documentation + API surface** for the backup scope matrix per deployment profile. No actual backup/restore execution is implemented here. The output is: PostgreSQL tables seeded with the 3-profile × 7-component matrix, two OpenWhisk query actions, Kafka audit events, APISIX route extensions, a console page, and integration tests.

**Total tasks: 22**

---

## Task Map

### Phase 0 — Research Spike

#### TASK-01: Research spike — confirm external dependencies
- **File**: `specs/114-backup-scope-deployment-profiles/research.md` *(new)*
- **Action**: Create document recording findings for:
  1. US-OBS-01 component health table name/schema (needed by `backup-scope-repository.mjs` for `operationalStatus` join)
  2. US-DEP-03 deployment profile detection mechanism (how `deployment_profile_registry.is_active` is set)
  3. EP-19 `boolean_capability_catalog` — verify or add `backup_scope_access` capability key
  4. Exact path of `platform-admin-routes.yaml` for APISIX route extension
- **Done when**: `research.md` exists and documents actual table/schema names or fallback decisions for each dependency
- **Fallback**: If US-OBS-01 not available → `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false` default; if US-DEP-03 not available → manual bootstrap job pattern documented
- **Blocking**: TASK-03, TASK-05, TASK-08 depend on findings

---

### Phase 1 — Design Artifacts

#### TASK-02: Write data-model.md with final DDL and API shapes
- **File**: `specs/114-backup-scope-deployment-profiles/data-model.md` *(new)*
- **Action**: Document final DDL (may diverge from plan after TASK-01 research), full API response shapes, component prop types, health join strategy, and `operationalStatus` resolution
- **Contents**:
  - Final `deployment_profile_registry` DDL
  - Final `backup_scope_entries` DDL with all indexes
  - Full annotated response shapes for `GET /v1/admin/backup/scope` and `GET /v1/tenants/{tenantId}/backup/scope`
  - React component prop type definitions for `BackupScopeEntry`, `TenantBackupScopeEntry`
- **Done when**: `data-model.md` committed with complete DDL and all response field descriptions
- **Depends on**: TASK-01

#### TASK-03: Write OpenAPI contract — backup-scope-get.json
- **File**: `specs/114-backup-scope-deployment-profiles/contracts/backup-scope-get.json` *(new)*
- **Action**: OpenAPI 3.0 operation object for `GET /v1/admin/backup/scope`
- **Contents**:
  - Parameters: `profile` query param (enum: all-in-one, standard, ha, all; optional)
  - Response 200 schema with `activeProfile`, `requestedProfile`, `entries[]`, `generatedAt`, `correlationId`
  - Response 400 `BACKUP_SCOPE_UNKNOWN_PROFILE`
  - Response 401, 403 schemas
  - Security: `openIdConnect` requiring `platform:admin:backup:read` scope
- **Done when**: Valid JSON file, parseable as OpenAPI 3.0 operation object
- **Depends on**: TASK-02

#### TASK-04: Write OpenAPI contract — tenant-backup-scope-get.json
- **File**: `specs/114-backup-scope-deployment-profiles/contracts/tenant-backup-scope-get.json` *(new)*
- **Action**: OpenAPI 3.0 operation object for `GET /v1/tenants/{tenantId}/backup/scope`
- **Contents**:
  - Path parameter: `tenantId`
  - Response 200 schema with `tenantId`, `activeProfile`, `planId`, `entries[]`, `generatedAt`, `correlationId`
  - Response 401, 403, 404 schemas
  - Security: `openIdConnect` requiring `tenant:backup:read` scope
- **Done when**: Valid JSON file, parseable as OpenAPI 3.0 operation object
- **Depends on**: TASK-02

#### TASK-05: Write Kafka event schema — backup-scope-query-event.json
- **File**: `specs/114-backup-scope-deployment-profiles/contracts/backup-scope-query-event.json` *(new)*
- **Action**: JSON Schema (draft-07) for Kafka topic `console.backup.scope.queried`
- **Contents**:
  - Required fields: `eventType`, `correlationId`, `actor` (object: `id`, `role`), `timestamp`
  - Optional fields: `tenantId` (null for superadmin queries), `requestedProfile`
  - `$schema`, `title`, `type: object`, `additionalProperties: false`
- **Done when**: Valid JSON Schema file
- **Depends on**: TASK-01 (Kafka topic naming confirmed)

#### TASK-06: Write quickstart.md
- **File**: `specs/114-backup-scope-deployment-profiles/quickstart.md` *(new)*
- **Action**: Local dev setup guide covering:
  - How to run the migration: `psql` command or Helm hook invocation
  - How to verify seed data: `SELECT COUNT(*) FROM backup_scope_entries` → 21; `SELECT COUNT(*) FROM deployment_profile_registry` → 4
  - How to run integration tests: `node --test tests/integration/114-backup-scope-deployment-profiles/`
  - How to run console component tests: `vitest run apps/web-console/src/__tests__/`
  - Environment variables needed: `BACKUP_SCOPE_KAFKA_TOPIC_QUERIED`, `BACKUP_SCOPE_HEALTH_JOIN_ENABLED`
  - Manual `is_active` update command when US-DEP-03 bootstrap not yet available
- **Done when**: `quickstart.md` committed with all commands verified against actual project layout
- **Depends on**: TASK-01, TASK-02

---

### Phase 2 — Migration & Seed

#### TASK-07: Implement PostgreSQL migration — 114-backup-scope-deployment-profiles.sql
- **File**: `services/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql` *(new)*
- **Action**: Write idempotent migration:
  1. `CREATE TABLE IF NOT EXISTS deployment_profile_registry` (profile_key PK, display_name, description, is_active, created_at, updated_at)
  2. `CREATE TABLE IF NOT EXISTS backup_scope_entries` (id UUID PK, component_key, profile_key FK, coverage_status CHECK, backup_granularity CHECK, rpo_range_minutes INT4RANGE, rto_range_minutes INT4RANGE, max_backup_frequency_minutes, max_retention_days, max_concurrent_jobs, max_backup_size_gb, preconditions TEXT[], limitations TEXT[], air_gap_notes, plan_capability_key, created_at, updated_at, UNIQUE(component_key, profile_key))
  3. Indexes: `idx_backup_scope_profile`, `idx_backup_scope_component`
  4. `updated_at` trigger function + trigger on both tables
  5. Seed 4 profile rows (`all-in-one`, `standard`, `ha`, `unknown`) with `ON CONFLICT DO NOTHING`
  6. Seed 21 component×profile rows (7 components × 3 non-unknown profiles) per matrix in plan.md, `ON CONFLICT DO NOTHING`
  7. `unknown` profile row seed with `is_active = false`
- **Done when**: Migration is idempotent (safe to run twice), `SELECT COUNT(*) FROM backup_scope_entries` = 21, `SELECT COUNT(*) FROM deployment_profile_registry` = 4
- **Depends on**: TASK-02

---

### Phase 3 — Repository

#### TASK-08: Implement backup-scope-repository.mjs
- **File**: `services/provisioning-orchestrator/src/repositories/backup-scope-repository.mjs` *(new)*
- **Action**: ESM module exporting:
  - `getMatrix({ pg, profileKey, includeAll })` — queries `backup_scope_entries` joined with `deployment_profile_registry`; if `includeAll=true` returns all 21 entries; if `profileKey` given filters by that profile; defaults to active profile (`is_active = true`); joins health table for `operationalStatus` when `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=true`
  - `getTenantProjection({ pg, tenantId, planId })` — narrows to components the tenant has active resources for (queries relevant resource tables); applies `plan_capability_key` filter against `boolean_capability_catalog`; appends `recommendation` string for `not-supported` and `operator-managed` entries
  - `resolveOperationalStatus(pg, componentKey)` — joins US-OBS-01 health table; returns `'operational' | 'degraded' | 'unknown'`; returns `'unknown'` when `BACKUP_SCOPE_HEALTH_JOIN_ENABLED !== 'true'` or health table absent
  - `getActiveProfile(pg)` — returns `profile_key` where `is_active = true`; returns `'unknown'` if none found
- **Done when**: Unit-testable functions exported; no circular deps; degrades gracefully when health table absent
- **Depends on**: TASK-07

---

### Phase 4 — OpenWhisk Actions

#### TASK-09: Implement backup-scope-get.mjs action
- **File**: `services/provisioning-orchestrator/src/actions/backup-scope-get.mjs` *(new)*
- **Action**: OpenWhisk action (ESM, `main` export) that:
  1. Extracts actor from `params.__ow_headers` JWT / `params.__ow_user`
  2. Validates actor role is `superadmin` or `sre`; returns 403 if not
  3. Parses `params.profile` query param; validates against known profile keys; returns 400 `BACKUP_SCOPE_UNKNOWN_PROFILE` for unrecognized values
  4. Calls `getMatrix()` from repository
  5. Publishes `console.backup.scope.queried` audit event (fire-and-forget)
  6. Returns structured response: `{ activeProfile, requestedProfile, entries, generatedAt, correlationId }`
- **Done when**: Action handles happy path + 400 unknown profile + 403 unauthorized; integration test TASK-17 passes
- **Depends on**: TASK-08, TASK-12

#### TASK-10: Implement tenant-backup-scope-get.mjs action
- **File**: `services/provisioning-orchestrator/src/actions/tenant-backup-scope-get.mjs` *(new)*
- **Action**: OpenWhisk action (ESM, `main` export) that:
  1. Extracts actor and validates role: `superadmin`, `sre`, or `tenant:owner`/`tenant:admin`
  2. Enforces tenant isolation: non-superadmin/non-sre actor must match `params.tenantId`; returns 403 otherwise
  3. Resolves `planId` from tenant assignment (reads `tenant_plan_assignments`)
  4. Calls `getTenantProjection()` from repository
  5. Publishes audit event with `tenantId` populated
  6. Returns structured response: `{ tenantId, activeProfile, planId, entries, generatedAt, correlationId }`
- **Done when**: Action handles happy path + 403 cross-tenant + filtered projection; integration test TASK-18 passes
- **Depends on**: TASK-08, TASK-12

---

### Phase 5 — Kafka Audit Events

#### TASK-11: Implement backup-scope-events.mjs
- **File**: `services/provisioning-orchestrator/src/events/backup-scope-events.mjs` *(new)*
- **Action**: ESM module exporting:
  - `publishScopeQueried({ correlationId, actor, tenantId, requestedProfile, kafkaClient })` → publishes to topic `process.env.BACKUP_SCOPE_KAFKA_TOPIC_QUERIED || 'console.backup.scope.queried'`
  - Fire-and-forget semantics: errors caught, logged via `console.error`, never propagated to caller
  - Message format matches `backup-scope-query-event.json` schema (TASK-05)
- **Done when**: Exports valid async function; audit integration test TASK-19 consumes event and asserts schema

#### TASK-12: Wire backup-scope-events.mjs into actions (dependency artifact)
- **File**: Internal wiring — no new file; TASK-09 and TASK-10 import from TASK-11
- **Action**: Ensure `backup-scope-get.mjs` and `tenant-backup-scope-get.mjs` both import and call `publishScopeQueried` after successful response construction
- **Note**: This task is satisfied when TASK-09 and TASK-10 both correctly import TASK-11
- **Done when**: Actions call publish; integration audit test TASK-19 passes
- **Depends on**: TASK-11

---

### Phase 6 — APISIX Routes

#### TASK-13: Extend platform-admin-routes.yaml with 2 backup scope routes
- **File**: `services/gateway-config/routes/platform-admin-routes.yaml` *(extended)*
- **Action**: Add two route entries (preserving all existing routes unmodified):
  ```yaml
  - uri: /v1/admin/backup/scope
    methods: [GET]
    upstream: provisioning-orchestrator
    plugins:
      openid-connect: { ... }  # inherit from existing pattern
      scope-enforcement:
        required_scope: "platform:admin:backup:read"
        required_roles: ["superadmin", "sre"]
      kafka-logger:
        topic: console.audit.gateway

  - uri: /v1/tenants/*/backup/scope
    methods: [GET]
    upstream: provisioning-orchestrator
    plugins:
      openid-connect: { ... }
      scope-enforcement:
        required_scope: "tenant:backup:read"
      kafka-logger:
        topic: console.audit.gateway
  ```
- **Done when**: YAML is valid (`helm template` smoke or `yq .` passes); existing routes not modified; 2 new routes present
- **Depends on**: TASK-01 (confirmed yaml path)

---

### Phase 7 — Console

#### TASK-14: Implement backupScopeApi.ts
- **File**: `apps/web-console/src/lib/backupScopeApi.ts` *(new)*
- **Action**: TypeScript module exporting:
  - Types: `BackupScopeEntry`, `BackupScopeMatrixResponse`, `TenantBackupScopeEntry`, `TenantBackupScopeResponse`
  - `fetchAdminBackupScope(profile?: string): Promise<BackupScopeMatrixResponse>` — calls `GET /v1/admin/backup/scope`
  - `fetchTenantBackupScope(tenantId: string): Promise<TenantBackupScopeResponse>` — calls `GET /v1/tenants/{tenantId}/backup/scope`
  - Uses existing fetch wrapper/auth patterns from `apps/web-console/src/lib/`
- **Done when**: Types compile; console unit tests TASK-21/22 import from this module without errors
- **Depends on**: TASK-03, TASK-04

#### TASK-15: Implement BackupScopeLegend.tsx and BackupScopeProfileSelector.tsx
- **Files**:
  - `apps/web-console/src/components/console/BackupScopeLegend.tsx` *(new)*
  - `apps/web-console/src/components/console/BackupScopeProfileSelector.tsx` *(new)*
- **Action**:
  - `BackupScopeLegend`: Static component rendering coverage status badges with definitions:
    - `platform-managed` → green badge
    - `operator-managed` → amber badge
    - `not-supported` → red badge
    - `unknown` → gray badge
    - operational status chip definitions
  - `BackupScopeProfileSelector`: Controlled tab set (`value`, `onChange` props) with tabs for All-in-One / Standard / HA / All; wired to `ConsoleBackupScopePage` state
- **Done when**: Components render without errors; `BackupScopeProfileSelector` fires `onChange`; storybook or unit test confirms badge colors
- **Depends on**: TASK-14

#### TASK-16: Implement BackupScopeMatrix.tsx and ConsoleBackupScopePage.tsx
- **Files**:
  - `apps/web-console/src/components/console/BackupScopeMatrix.tsx` *(new)*
  - `apps/web-console/src/pages/ConsoleBackupScopePage.tsx` *(new)*
- **Action**:
  - `BackupScopeMatrix`: Responsive table with:
    - Sticky component name column
    - Color-coded coverage cells using `BackupScopeLegend` badge logic
    - RPO/RTO tooltip per cell
    - Limits summary popover (max_backup_frequency, max_retention_days, max_concurrent_jobs, max_backup_size_gb)
    - Operational status chip when `operationalStatus !== 'unknown'`
    - Props: `entries: BackupScopeEntry[]`, `isLoading: boolean`
  - `ConsoleBackupScopePage`: Page component that:
    - Calls `fetchAdminBackupScope()` for superadmin/sre role, `fetchTenantBackupScope(tenantId)` for tenant role
    - Renders `BackupScopeProfileSelector` → triggers refetch with `?profile=` param
    - Renders `BackupScopeMatrix` with fetched entries
    - Renders `BackupScopeLegend`
    - Shows loading skeleton, error state, and empty state
    - Registered in router under backup/recovery navigation section
- **Done when**: Page renders matrix with correct structure; profile tab switching updates displayed entries; unit tests TASK-21/22 pass
- **Depends on**: TASK-14, TASK-15

---

### Phase 8 — Integration Tests

#### TASK-17: Integration test — backup-scope-get.test.mjs
- **File**: `tests/integration/114-backup-scope-deployment-profiles/backup-scope-get.test.mjs` *(new)*
- **Action**: `node:test` test file covering:
  - `GET /v1/admin/backup/scope` as superadmin → 200, 7 entries for active profile, no null `coverageStatus`
  - `GET /v1/admin/backup/scope?profile=all` → 200, 21 entries
  - `GET /v1/admin/backup/scope?profile=ha` → 200, 7 entries all with `profileKey = 'ha'`
  - `GET /v1/admin/backup/scope?profile=chaos` → 400, error code `BACKUP_SCOPE_UNKNOWN_PROFILE`
  - `GET /v1/admin/backup/scope` as unauthorized role → 403
  - `GET /v1/admin/backup/scope` with `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false` → 200, all `operationalStatus: 'unknown'`, no error
- **Done when**: All test cases pass; `node --test tests/integration/114-backup-scope-deployment-profiles/backup-scope-get.test.mjs` exits 0
- **Depends on**: TASK-09, TASK-13

#### TASK-18: Integration test — tenant-backup-scope-get.test.mjs
- **File**: `tests/integration/114-backup-scope-deployment-profiles/tenant-backup-scope-get.test.mjs` *(new)*
- **Action**: `node:test` test file covering:
  - Superadmin `GET /v1/tenants/{tenantId}/backup/scope` → 200, entries for tenant's resource types only
  - Tenant owner querying own tenant → 200, filtered projection (e.g., tenant with PostgreSQL + S3 → 2 entries)
  - Tenant owner querying another tenant's scope → 403
  - Plan-level capability filter: tenant on a plan without `backup_scope_access` → 403 or empty entries per spec
  - Unknown tenantId → 404
- **Done when**: All test cases pass
- **Depends on**: TASK-10, TASK-13

#### TASK-19: Integration test — backup-scope-audit.test.mjs
- **File**: `tests/integration/114-backup-scope-deployment-profiles/backup-scope-audit.test.mjs` *(new)*
- **Action**: `node:test` test file covering:
  - Call `GET /v1/admin/backup/scope` → consume `console.backup.scope.queried` Kafka topic → assert event contains: `eventType`, `correlationId`, `actor.id`, `actor.role`, `timestamp`
  - Call `GET /v1/tenants/{tenantId}/backup/scope` → assert Kafka event has `tenantId` populated
  - Assert event matches `backup-scope-query-event.json` JSON Schema (TASK-05)
- **Done when**: Test consumes Kafka event within 5s timeout and asserts schema; exits 0
- **Depends on**: TASK-09, TASK-10, TASK-11

---

### Phase 9 — Console Tests

#### TASK-20: Console test fixtures and test utilities
- **File**: `apps/web-console/src/__tests__/fixtures/backupScopeFixtures.ts` *(new)*
- **Action**: Export typed mock data:
  - `mockBackupScopeMatrix`: `BackupScopeMatrixResponse` with 7 entries (all 7 components for `standard` profile) covering all `coverageStatus` values
  - `mockTenantBackupScope`: `TenantBackupScopeResponse` with 2 entries (postgresql + s3)
  - Mock API module for `backupScopeApi` using `vi.mock`
- **Done when**: Fixtures export valid typed data; importable by TASK-21/22
- **Depends on**: TASK-14

#### TASK-21: Console unit test — BackupScopeMatrix.test.tsx
- **File**: `apps/web-console/src/__tests__/BackupScopeMatrix.test.tsx` *(new)*
- **Action**: `vitest` + React Testing Library tests:
  - Renders table with 7 rows using `mockBackupScopeMatrix`
  - `platform-managed` entries have green badge class
  - `not-supported` entries have red badge class
  - `operator-managed` entries have amber badge class
  - RPO/RTO tooltip renders on hover for entries with `rpoRangeMinutes`
  - Loading skeleton renders when `isLoading=true`
- **Done when**: `vitest run` passes all assertions
- **Depends on**: TASK-16, TASK-20

#### TASK-22: Console unit test — ConsoleBackupScopePage.test.tsx
- **File**: `apps/web-console/src/__tests__/ConsoleBackupScopePage.test.tsx` *(new)*
- **Action**: `vitest` + React Testing Library tests:
  - Loading state renders skeleton before data resolves
  - After mock API resolves, `BackupScopeMatrix` renders with correct entry count
  - Profile tab click triggers `fetchAdminBackupScope` with correct `profile` param
  - Error state renders error message when API rejects
- **Done when**: `vitest run` passes all assertions
- **Depends on**: TASK-16, TASK-20

---

## Execution Order

```
TASK-01 (Research)
    └─► TASK-02 (data-model.md)
            ├─► TASK-03 (contract: backup-scope-get.json)
            ├─► TASK-04 (contract: tenant-backup-scope-get.json)
            └─► TASK-06 (quickstart.md)
    └─► TASK-05 (contract: backup-scope-query-event.json)  [parallel with TASK-02]
    └─► TASK-07 (migration SQL)
            └─► TASK-08 (repository)
                    ├─► TASK-09 (action: backup-scope-get)
                    │       └─► TASK-17 (integration test)
                    └─► TASK-10 (action: tenant-backup-scope-get)
                            └─► TASK-18 (integration test)
    └─► TASK-11 (events module)
            └─► TASK-12 (wire into actions)
                    └─► TASK-19 (audit integration test)
    └─► TASK-13 (APISIX routes)  [parallel after TASK-01]

TASK-03 + TASK-04
    └─► TASK-14 (backupScopeApi.ts)
            └─► TASK-15 (BackupScopeLegend + BackupScopeProfileSelector)
                    └─► TASK-16 (BackupScopeMatrix + ConsoleBackupScopePage)
                            └─► TASK-20 (test fixtures)
                                    ├─► TASK-21 (BackupScopeMatrix.test)
                                    └─► TASK-22 (ConsoleBackupScopePage.test)
```

### Parallel opportunities after TASK-01 + TASK-02 complete
- TASK-03/04/05/06 can proceed in parallel
- TASK-07 can proceed in parallel with TASK-03/04
- TASK-13 (APISIX) can proceed in parallel with TASK-07
- Console tasks (TASK-14–16, TASK-20–22) can proceed in parallel with backend tasks (TASK-07–12) after TASK-02 contracts are drafted

---

## File Map (all artifacts)

| Task | File | Status |
|---|---|---|
| TASK-01 | `specs/114-backup-scope-deployment-profiles/research.md` | new |
| TASK-02 | `specs/114-backup-scope-deployment-profiles/data-model.md` | new |
| TASK-03 | `specs/114-backup-scope-deployment-profiles/contracts/backup-scope-get.json` | new |
| TASK-04 | `specs/114-backup-scope-deployment-profiles/contracts/tenant-backup-scope-get.json` | new |
| TASK-05 | `specs/114-backup-scope-deployment-profiles/contracts/backup-scope-query-event.json` | new |
| TASK-06 | `specs/114-backup-scope-deployment-profiles/quickstart.md` | new |
| TASK-07 | `services/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql` | new |
| TASK-08 | `services/provisioning-orchestrator/src/repositories/backup-scope-repository.mjs` | new |
| TASK-09 | `services/provisioning-orchestrator/src/actions/backup-scope-get.mjs` | new |
| TASK-10 | `services/provisioning-orchestrator/src/actions/tenant-backup-scope-get.mjs` | new |
| TASK-11 | `services/provisioning-orchestrator/src/events/backup-scope-events.mjs` | new |
| TASK-12 | (wiring — no new file) | n/a |
| TASK-13 | `services/gateway-config/routes/platform-admin-routes.yaml` | extended |
| TASK-14 | `apps/web-console/src/lib/backupScopeApi.ts` | new |
| TASK-15 | `apps/web-console/src/components/console/BackupScopeLegend.tsx` | new |
| TASK-15 | `apps/web-console/src/components/console/BackupScopeProfileSelector.tsx` | new |
| TASK-16 | `apps/web-console/src/components/console/BackupScopeMatrix.tsx` | new |
| TASK-16 | `apps/web-console/src/pages/ConsoleBackupScopePage.tsx` | new |
| TASK-17 | `tests/integration/114-backup-scope-deployment-profiles/backup-scope-get.test.mjs` | new |
| TASK-18 | `tests/integration/114-backup-scope-deployment-profiles/tenant-backup-scope-get.test.mjs` | new |
| TASK-19 | `tests/integration/114-backup-scope-deployment-profiles/backup-scope-audit.test.mjs` | new |
| TASK-20 | `apps/web-console/src/__tests__/fixtures/backupScopeFixtures.ts` | new |
| TASK-21 | `apps/web-console/src/__tests__/BackupScopeMatrix.test.tsx` | new |
| TASK-22 | `apps/web-console/src/__tests__/ConsoleBackupScopePage.test.tsx` | new |

---

## New Environment Variables

| Variable | Default | Used in |
|---|---|---|
| `BACKUP_SCOPE_KAFKA_TOPIC_QUERIED` | `console.backup.scope.queried` | TASK-11 |
| `BACKUP_SCOPE_HEALTH_JOIN_ENABLED` | `true` | TASK-08 |

---

## Done Criteria (from plan.md)

| Criterion | Task(s) | Evidence |
|---|---|---|
| DC-01: Migration creates tables, seeds 21 entries | TASK-07 | `SELECT COUNT(*) FROM backup_scope_entries` = 21 |
| DC-02: `GET /v1/admin/backup/scope` returns 7 entries for active profile | TASK-09, TASK-17 | Integration test pass |
| DC-03: `?profile=all` returns 21-entry matrix | TASK-09, TASK-17 | Integration test pass |
| DC-04: Unknown profile → 400 `BACKUP_SCOPE_UNKNOWN_PROFILE` | TASK-09, TASK-17 | Integration test pass |
| DC-05: Tenant endpoint returns only tenant's resource types | TASK-10, TASK-18 | Integration test with 2-resource tenant → 2 entries |
| DC-06: Cross-tenant access denied | TASK-10, TASK-18 | Integration test: tenant A → tenant B → 403 |
| DC-07: Kafka audit event on every query | TASK-11, TASK-19 | Audit test consumes event, asserts schema |
| DC-08: Console matrix renders correct coverage colors | TASK-16, TASK-21 | `platform-managed` = green, `not-supported` = red |
| DC-09: All 3 contracts committed | TASK-03, TASK-04, TASK-05 | `ls specs/114-backup-scope-deployment-profiles/contracts/` shows 3 JSON files |
| DC-10: `operationalStatus` degrades when health join disabled | TASK-08, TASK-17 | Integration test with `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false` → `operationalStatus: 'unknown'` for all entries, no error |

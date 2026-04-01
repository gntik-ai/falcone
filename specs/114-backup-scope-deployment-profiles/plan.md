# Implementation Plan: Backup Scope & Limits by Deployment Profile

**Branch**: `114-backup-scope-deployment-profiles` | **Date**: 2026-04-01 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-BKP-01-T06 | **Epic**: EP-20 | **Story**: US-BKP-01
**Depends on**: US-OBS-01 (health checks & operational status), US-DEP-03 (deployment profiles definition)
**Sibling tasks** (consume this artifact, not prerequisites): US-BKP-01-T01, US-BKP-01-T02, US-BKP-01-T03, US-BKP-01-T04, US-BKP-01-T05
**Input**: Feature specification from `specs/114-backup-scope-deployment-profiles/spec.md`

## Summary

T06 is a **documentation + API surface task** that defines and exposes the backup scope matrix per deployment profile. It does NOT implement actual backup/restore mechanisms (those are T01–T05). Instead, it delivers: (1) a static backup scope registry seeded from known platform topology, (2) an OpenWhisk action (`backup-scope-get`) serving that registry with role-based scoping, (3) a tenant-scoped projection action (`tenant-backup-scope-get`), (4) Kafka audit events for scope queries, and (5) a console page under the backup/recovery section.

Key design choices: (a) scope data is derived from active Helm values/feature flags at bootstrap time and stored in PostgreSQL tables `backup_scope_entries` and `deployment_profile_registry` — no runtime introspection at query time; (b) the distinction between "supported by profile" and "currently operational" is resolved by joining against the US-OBS-01 component health table at query time; (c) tenant-scoped view filters by plan-level capability `backup_scope_access` and by resource types the tenant actually uses; (d) all scope queries are audited to Kafka topic `console.backup.scope.queried`.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) / React 18 + TypeScript
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka audit), `undici` (integration tests), React + Tailwind CSS + shadcn/ui (console)
**Storage**: PostgreSQL — new tables `backup_scope_entries`, `deployment_profile_registry`; read-only joins to component health (US-OBS-01) and plan/capabilities tables (EP-19)
**Testing**: `node:test` + `node:assert` (backend integration), `vitest` + React Testing Library (console), `undici` (HTTP contract tests against APISIX)
**Target Platform**: Kubernetes / OpenShift (Helm), Apache OpenWhisk serverless
**Project Type**: Multi-tenant BaaS platform — control-plane backend + serverless actions + console
**Performance Goals**: Scope query response < 150 ms p95 (static table + health join); page first meaningful paint ≤ 2 s
**Constraints**: Superadmin sees all profiles and components; tenant owner sees only their resource types filtered by plan; zero false-positive coverage claims (SC-005); air-gap and partial-profile edge cases must produce explicit "unknown" entries rather than silently omitting them

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | Actions under `services/provisioning-orchestrator/src/actions/`; migrations under `services/provisioning-orchestrator/src/migrations/`; console page under `apps/web-console/src/pages/`; contracts under `specs/114-backup-scope-deployment-profiles/contracts/` |
| II. Incremental Delivery | ✅ PASS | Pure documentation + query surface; no backup execution; no new infrastructure services |
| III. K8s / OpenShift Compatibility | ✅ PASS | New migration runs as Helm hook; new actions registered in existing `provisioning-orchestrator` manifest; new APISIX routes extend existing `platform-admin-routes.yaml` |
| IV. Quality Gates | ✅ PASS | Integration tests under `tests/integration/114-backup-scope-deployment-profiles/`; console component tests; contract tests |
| V. Documentation as Part of Change | ✅ PASS | This plan.md, data-model.md, contracts/, quickstart.md |

---

## Project Structure

### Documentation (this feature)

```text
specs/114-backup-scope-deployment-profiles/
├── plan.md                                     ← This file
├── spec.md                                     ← Feature specification (already materialized)
├── checklists/
│   └── requirements.md                         ← (already exists)
├── data-model.md                               ← Phase 1 output: DDL, API shapes, component props
├── quickstart.md                               ← Phase 1 output: local dev and test execution
└── contracts/
    ├── backup-scope-get.json                   ← Superadmin/SRE: full matrix per profile
    ├── tenant-backup-scope-get.json            ← Tenant-scoped projection
    └── backup-scope-query-event.json           ← Kafka audit event schema
```

### Backend (provisioning-orchestrator)

```text
services/provisioning-orchestrator/src/
├── migrations/
│   └── 114-backup-scope-deployment-profiles.sql   ← DDL for new tables + seed data
├── repositories/
│   └── backup-scope-repository.mjs                ← Query logic: matrix + tenant projection
├── actions/
│   ├── backup-scope-get.mjs                        ← OpenWhisk action: superadmin/SRE scope query
│   └── tenant-backup-scope-get.mjs                 ← OpenWhisk action: tenant-scoped projection
└── events/
    └── backup-scope-events.mjs                     ← Kafka audit publisher
```

### Console

```text
apps/web-console/src/
├── pages/
│   └── ConsoleBackupScopePage.tsx                  ← Backup scope matrix view
└── components/console/
    ├── BackupScopeMatrix.tsx                        ← Per-profile × component table
    ├── BackupScopeLegend.tsx                        ← Coverage status badges + legend
    └── BackupScopeProfileSelector.tsx              ← Profile filter tabs
```

### APISIX Routes

```text
services/gateway-config/routes/
└── platform-admin-routes.yaml                      ← Extended with 2 new backup scope routes
```

### Tests

```text
tests/integration/114-backup-scope-deployment-profiles/
├── backup-scope-get.test.mjs
├── tenant-backup-scope-get.test.mjs
└── backup-scope-audit.test.mjs
```

---

## Data Model

### New Tables

#### `deployment_profile_registry`

Stores the known deployment profiles and their general descriptors. Seeded at migration time; updated on platform upgrade.

```sql
CREATE TABLE deployment_profile_registry (
  profile_key          TEXT PRIMARY KEY,   -- 'all-in-one' | 'standard' | 'ha' | 'unknown'
  display_name         TEXT NOT NULL,
  description          TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT false,  -- true for the currently-deployed profile
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `backup_scope_entries`

One row per (component, profile) pair. The authoritative backup scope matrix.

```sql
CREATE TABLE backup_scope_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_key        TEXT NOT NULL,   -- 'postgresql' | 'mongodb' | 'kafka' | 'openwhisk' | 's3' | 'keycloak' | 'apisix_config'
  profile_key          TEXT NOT NULL REFERENCES deployment_profile_registry(profile_key),
  coverage_status      TEXT NOT NULL CHECK (coverage_status IN ('platform-managed','operator-managed','not-supported','unknown')),
  backup_granularity   TEXT NOT NULL CHECK (backup_granularity IN ('full','incremental','config-only','none','unknown')),
  rpo_range_minutes    INT4RANGE,          -- NULL means not applicable
  rto_range_minutes    INT4RANGE,          -- NULL means not applicable
  max_backup_frequency_minutes  INT,       -- minimum interval between backups, NULL = unlimited/N/A
  max_retention_days            INT,       -- NULL = N/A
  max_concurrent_jobs           INT,       -- NULL = N/A
  max_backup_size_gb            NUMERIC,   -- NULL = N/A
  preconditions        TEXT[],             -- human-readable precondition notes
  limitations          TEXT[],             -- human-readable limitations
  air_gap_notes        TEXT,               -- air-gap specific notes when applicable
  plan_capability_key  TEXT,               -- if non-NULL, requires this capability in tenant plan
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (component_key, profile_key)
);

CREATE INDEX idx_backup_scope_profile ON backup_scope_entries(profile_key);
CREATE INDEX idx_backup_scope_component ON backup_scope_entries(component_key);
```

### Seed Data (Initial Matrix)

The migration seeds the known 3 profiles × 7 components = 21 entries. Example rows (abbreviated):

| component_key | profile_key | coverage_status | backup_granularity | rpo_range_min | max_retention_days |
|---|---|---|---|---|---|
| postgresql | all-in-one | platform-managed | full | [1440,1440] | 7 |
| postgresql | standard | platform-managed | incremental | [60,240] | 30 |
| postgresql | ha | platform-managed | incremental | [15,60] | 90 |
| mongodb | all-in-one | platform-managed | full | [1440,1440] | 7 |
| mongodb | standard | platform-managed | full | [240,480] | 30 |
| mongodb | ha | platform-managed | incremental | [60,120] | 90 |
| kafka | all-in-one | not-supported | none | NULL | NULL |
| kafka | standard | operator-managed | none | NULL | NULL |
| kafka | ha | operator-managed | none | NULL | NULL |
| openwhisk | all-in-one | not-supported | none | NULL | NULL |
| openwhisk | standard | operator-managed | config-only | NULL | 30 |
| openwhisk | ha | operator-managed | config-only | NULL | 90 |
| s3 | all-in-one | platform-managed | full | [1440,2880] | 14 |
| s3 | standard | platform-managed | incremental | [240,480] | 30 |
| s3 | ha | platform-managed | incremental | [60,120] | 90 |
| keycloak | all-in-one | platform-managed | config-only | NULL | 30 |
| keycloak | standard | platform-managed | config-only | NULL | 30 |
| keycloak | ha | platform-managed | config-only | NULL | 90 |
| apisix_config | all-in-one | platform-managed | config-only | NULL | 30 |
| apisix_config | standard | platform-managed | config-only | NULL | 30 |
| apisix_config | ha | platform-managed | config-only | NULL | 90 |

---

## API Contracts (shape overview — full JSON schemas in `contracts/`)

### `GET /v1/admin/backup/scope`

**Roles**: `superadmin`, `sre`
**Query params**: `?profile=all-in-one|standard|ha` (optional; omit = active profile; `?profile=all` = full matrix)

Response shape:

```json
{
  "activeProfile": "standard",
  "requestedProfile": "standard",
  "entries": [
    {
      "componentKey": "postgresql",
      "profileKey": "standard",
      "coverageStatus": "platform-managed",
      "backupGranularity": "incremental",
      "rpoRangeMinutes": { "min": 60, "max": 240 },
      "rtoRangeMinutes": { "min": 30, "max": 120 },
      "operationalStatus": "operational",
      "supportedByProfile": true,
      "maxBackupFrequencyMinutes": 60,
      "maxRetentionDays": 30,
      "maxConcurrentJobs": 2,
      "maxBackupSizeGb": null,
      "preconditions": ["Requires pg-basebackup or compatible tool installed"],
      "limitations": [],
      "airGapNotes": null,
      "planCapabilityKey": null
    }
  ],
  "generatedAt": "2026-04-01T10:00:00Z",
  "correlationId": "req-abc123"
}
```

### `GET /v1/tenants/{tenantId}/backup/scope`

**Roles**: `superadmin`, `sre`, `tenant:owner` (own tenant only)
**Query params**: none (returns only resource types the tenant uses, filtered by plan capabilities)

Response shape:

```json
{
  "tenantId": "ten-xyz",
  "activeProfile": "standard",
  "planId": "plan-pro",
  "entries": [
    {
      "componentKey": "postgresql",
      "coverageStatus": "platform-managed",
      "backupGranularity": "incremental",
      "rpoRangeMinutes": { "min": 60, "max": 240 },
      "rtoRangeMinutes": { "min": 30, "max": 120 },
      "operationalStatus": "operational",
      "tenantHasResources": true,
      "planRestriction": null,
      "recommendation": null
    },
    {
      "componentKey": "s3",
      "coverageStatus": "platform-managed",
      "backupGranularity": "incremental",
      "rpoRangeMinutes": { "min": 240, "max": 480 },
      "rtoRangeMinutes": null,
      "operationalStatus": "operational",
      "tenantHasResources": true,
      "planRestriction": null,
      "recommendation": "Consider external backup for objects > 10 GB"
    }
  ],
  "generatedAt": "2026-04-01T10:00:00Z",
  "correlationId": "req-def456"
}
```

### Kafka Audit Event: `console.backup.scope.queried`

Topic retention: 30d

```json
{
  "eventType": "backup.scope.queried",
  "correlationId": "req-abc123",
  "actor": { "id": "user-superadmin-1", "role": "superadmin" },
  "tenantId": null,
  "requestedProfile": "standard",
  "timestamp": "2026-04-01T10:00:00Z"
}
```

---

## New Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `BACKUP_SCOPE_KAFKA_TOPIC_QUERIED` | `console.backup.scope.queried` | Audit topic for scope queries |
| `BACKUP_SCOPE_HEALTH_JOIN_ENABLED` | `true` | If false, `operationalStatus` always returns `unknown` (for environments without US-OBS-01) |

---

## APISIX Route Definitions

Two new routes added to `services/gateway-config/routes/platform-admin-routes.yaml`:

```yaml
- uri: /v1/admin/backup/scope
  methods: [GET]
  upstream: provisioning-orchestrator
  plugins:
    openid-connect: { ... }
    scope-enforcement: { required_scope: "platform:admin:backup:read", required_role: ["superadmin","sre"] }
    kafka-logger: { topic: console.audit.gateway }

- uri: /v1/tenants/*/backup/scope
  methods: [GET]
  upstream: provisioning-orchestrator
  plugins:
    openid-connect: { ... }
    scope-enforcement: { required_scope: "tenant:backup:read" }
    kafka-logger: { topic: console.audit.gateway }
```

---

## Implementation Phases

### Phase 0 — Research & Spike (pre-implementation)

1. **Confirm US-OBS-01 component health table name and schema** — the `backup-scope-repository` must join against it for `operationalStatus`. If not yet available, fall back to `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false`.
2. **Confirm US-DEP-03 deployment profile detection mechanism** — validate that active profile is queryable from Helm values ConfigMap or equivalent. Determine `deployment_profile_registry.is_active` update strategy.
3. **Confirm plan capability catalog schema** (from EP-19) — verify `boolean_capability_catalog` key for backup scope access exists or add `backup_scope_access` as a new capability entry.
4. **Confirm existing `platform-admin-routes.yaml` path** and merge process for new routes.

Output: `specs/114-backup-scope-deployment-profiles/research.md`

### Phase 1 — Design Artifacts

1. Write `data-model.md` with final DDL (may diverge from plan after research), full API response shapes, component prop types, and health join strategy.
2. Write `contracts/backup-scope-get.json` (OpenAPI 3.0 operation object).
3. Write `contracts/tenant-backup-scope-get.json`.
4. Write `contracts/backup-scope-query-event.json` (JSON Schema for Kafka event).
5. Write `quickstart.md` with local dev setup, migration execution, and test run commands.

### Phase 2 — Migration & Seed

1. Write `services/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql`:
   - CREATE `deployment_profile_registry` + `backup_scope_entries`
   - Seed 3 profiles + 21 component×profile rows per initial matrix above
   - Add `updated_at` trigger on both tables
2. Validate migration idempotency: wrap in `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` for seed rows.

### Phase 3 — Repository

1. Implement `backup-scope-repository.mjs`:
   - `getMatrix({ profileKey, includeAll })` — queries `backup_scope_entries` joined with `deployment_profile_registry` and optional health join
   - `getTenantProjection({ tenantId, pg })` — narrows to resource types the tenant has, applies plan-level capability filter
   - `resolveOperationalStatus(componentKey)` — joins US-OBS-01 health table; degrades gracefully to `unknown` if unavailable

### Phase 4 — Actions

1. Implement `backup-scope-get.mjs`:
   - Validates actor role (superadmin or sre required)
   - Resolves `?profile` query param; defaults to active profile
   - Calls `getMatrix()`, publishes audit event, returns structured response
   - Returns `400 BACKUP_SCOPE_UNKNOWN_PROFILE` for unrecognized profile values

2. Implement `tenant-backup-scope-get.mjs`:
   - Validates actor is superadmin, sre, or the tenant's owner
   - Enforces tenant isolation: non-superadmin can only query own tenantId
   - Calls `getTenantProjection()`, filters by plan capability, appends `recommendation` where coverage is `not-supported` or `operator-managed`
   - Publishes audit event with tenantId populated

### Phase 5 — Kafka Audit

1. Implement `backup-scope-events.mjs`:
   - `publishScopeQueried({ correlationId, actor, tenantId, requestedProfile })` → topic `console.backup.scope.queried`
   - Fire-and-forget; errors logged but do not block query response

### Phase 6 — APISIX Routes

1. Add 2 new route entries to `services/gateway-config/routes/platform-admin-routes.yaml`.
2. Validate with `helm template` smoke test.

### Phase 7 — Console

1. Implement `ConsoleBackupScopePage.tsx`:
   - Calls `GET /v1/admin/backup/scope?profile=all` for superadmin role
   - Calls `GET /v1/tenants/{tenantId}/backup/scope` for tenant owner role
   - Renders `BackupScopeProfileSelector` (profile filter tabs: All-in-One / Standard / HA)
   - Renders `BackupScopeMatrix` (table: component rows × profile columns, colored by coverage status)
   - Renders `BackupScopeLegend` (badges: platform-managed=green, operator-managed=amber, not-supported=red, unknown=gray)
   - Shows operational status chip (operational / degraded / unknown) per cell where available

2. Implement `BackupScopeMatrix.tsx` — responsive table with sticky component column, color-coded coverage cells, RPO/RTO tooltips, and limits summary popover.

3. Implement `BackupScopeLegend.tsx` — static legend with definitions of each coverage status.

4. Implement `BackupScopeProfileSelector.tsx` — controlled tab set wired to page state.

5. Add `backupScopeApi.ts` to `apps/web-console/src/lib/` with typed fetch functions and `BackupScopeEntry`, `TenantBackupScopeEntry` types.

### Phase 8 — Tests

1. Integration tests (`tests/integration/114-backup-scope-deployment-profiles/`):
   - `backup-scope-get.test.mjs`: superadmin GET all profiles, unknown profile → 400, unauthorized role → 403
   - `tenant-backup-scope-get.test.mjs`: tenant owner own scope, tenant owner cross-tenant → 403, filtered by plan capability
   - `backup-scope-audit.test.mjs`: consume Kafka topic after query, assert event shape

2. Console unit tests (`apps/web-console/src/__tests__/`):
   - `BackupScopeMatrix.test.tsx`: renders correct coverage status colors, tooltips, limits popovers
   - `ConsoleBackupScopePage.test.tsx`: loading state, data table rendered, profile tab switching

---

## Security & Authorization

| Actor | Endpoint | Access |
|---|---|---|
| superadmin | `GET /v1/admin/backup/scope` | ✅ Full matrix, all profiles |
| sre (platform role) | `GET /v1/admin/backup/scope` | ✅ Full matrix, all profiles |
| tenant:owner | `GET /v1/tenants/{tenantId}/backup/scope` | ✅ Own tenant only, filtered projection |
| tenant:admin | `GET /v1/tenants/{tenantId}/backup/scope` | ✅ Own tenant only (if plan allows) |
| other | any | ❌ 403 |

All requests require valid Keycloak JWT. Scope enforcement plugin enforces `platform:admin:backup:read` for admin endpoint and `tenant:backup:read` for tenant endpoint. All successful queries emit Kafka audit event (FR-012).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| US-OBS-01 health table not yet available | Medium | Low | `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false` degrades `operationalStatus` to `unknown`; no blocking dependency |
| US-DEP-03 profile detection not formalized | Medium | Low | `deployment_profile_registry.is_active` updated manually by bootstrap job until US-DEP-03 is complete; documented in `quickstart.md` |
| RPO/RTO seed values are estimates | High | Low | Values clearly marked as "ranges / estimates" in API response and console; spec assumption documented |
| Plan capability `backup_scope_access` not yet in catalog | Low | Low | Add seed row in migration if absent; backward-compatible with existing EP-19 capabilities table |
| Partial-profile deployments (edge case) | Low | Medium | Per-component `coverage_status` = `unknown` for any component not found in the registry; never silently missing |

---

## Rollback Strategy

- Migration is additive only (new tables + seed data). Rollback: drop `backup_scope_entries`, drop `deployment_profile_registry`.
- APISIX route additions are additive. Rollback: remove the 2 route entries and re-apply.
- Console page is behind existing role-based navigation guard. Rollback: remove page import from router.
- No existing tables modified. No breaking changes to existing contracts.

---

## Observability

- Kafka topic `console.backup.scope.queried` (30d retention) provides full audit trail.
- Standard OpenWhisk activation logs for both actions.
- APISIX access logs via existing kafka-logger plugin.

---

## Done Criteria

| Criterion | Evidence |
|---|---|
| DC-01: Migration creates tables and seeds 21 entries | `psql -c "SELECT COUNT(*) FROM backup_scope_entries"` returns 21 |
| DC-02: `GET /v1/admin/backup/scope` returns all components for active profile | Integration test pass; response contains 7 component entries with no null `coverageStatus` |
| DC-03: `GET /v1/admin/backup/scope?profile=all` returns full 21-entry matrix | Integration test pass |
| DC-04: Unknown profile returns 400 | Integration test: `?profile=chaos` → 400 `BACKUP_SCOPE_UNKNOWN_PROFILE` |
| DC-05: Tenant endpoint returns only tenant's resource types | Integration test with tenant having only PostgreSQL + S3 → 2 entries |
| DC-06: Cross-tenant access denied | Integration test: tenant A requesting tenant B scope → 403 |
| DC-07: Kafka audit event emitted on every query | Audit integration test consumes event and asserts schema |
| DC-08: Console page renders matrix with correct coverage colors | Console unit test: BackupScopeMatrix renders `platform-managed` as green, `not-supported` as red |
| DC-09: All contracts committed under `specs/114-backup-scope-deployment-profiles/contracts/` | `ls contracts/` shows 3 JSON files |
| DC-10: `operationalStatus` degrades gracefully when health join is disabled | Integration test with `BACKUP_SCOPE_HEALTH_JOIN_ENABLED=false` → all entries show `operationalStatus: "unknown"` without error |

---

## Sequence of Implementation

```text
Phase 0 (Research)
    └─► Phase 1 (Design + Contracts)
            └─► Phase 2 (Migration + Seed)
                    ├─► Phase 3 (Repository)
                    │       └─► Phase 4 (Actions) ──► Phase 5 (Kafka Audit)
                    │                                       └─► Phase 6 (APISIX)
                    └─► Phase 7 (Console) [can start after Phase 1 contracts]
Phase 8 (Tests) [runs after Phases 4–7]
```

Phases 4–6 and Phase 7 can proceed in parallel after Phase 3 is complete.

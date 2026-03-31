# Tasks: Function Deploy–Execute Privilege Separation (US-SEC-02-T05)

**Feature Branch**: `095-function-deploy-exec-separation`
**Input**: `specs/095-function-deploy-exec-separation/plan.md` + `specs/095-function-deploy-exec-separation/spec.md`
**Prerequisites**: plan.md ✅, spec.md ✅
**Traceability**: EP-18 / US-SEC-02 / US-SEC-02-T05 · RF-SEC-010, RF-SEC-011

## Format: `[ID] [P?] [Story] Description with file path`

- **[P]**: Can run in parallel (different files, no inter-task dependencies within the phase)
- **[US#]**: User story label (US1–US5) required for story-phase tasks
- Setup/Foundational/Polish phases: no story label

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize migration artefact, contracts skeleton, and environment config so all subsequent phases build on a clean foundation.

- [ ] T001 Add env vars `FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED`, `FUNCTION_PRIVILEGE_CACHE_TTL_SECONDS`, `FUNCTION_PRIVILEGE_PROPAGATION_SLA_SECONDS`, `FUNCTION_PRIVILEGE_MIGRATION_REVIEW_PERIOD_DAYS`, `FUNCTION_PRIVILEGE_KAFKA_TOPIC_DENIED`, `FUNCTION_PRIVILEGE_KAFKA_TOPIC_ASSIGNED`, `FUNCTION_PRIVILEGE_KAFKA_TOPIC_REVIEW_NOTICE`, `FUNCTION_TRIGGER_RUNTIME_VALIDATION_MODE` to `services/provisioning-orchestrator/.env.example` and Helm/ConfigMap templates
- [ ] T002 [P] Create migration file skeleton `services/provisioning-orchestrator/src/migrations/095-function-deploy-exec-separation.sql` with section markers (tables, indexes, ALTER TABLE, seed classification)
- [ ] T003 [P] Create contracts directory skeleton `specs/095-function-deploy-exec-separation/contracts/` with placeholder files: `function-privilege-assignment.schema.json`, `function-privilege-denial.schema.json`, `function-privilege-denied.event.schema.json`, `function-privilege-assigned.event.schema.json`, `function-privilege-review-notice.event.schema.json`

**Checkpoint**: Environment config and empty artefact placeholders committed — subsequent phases can proceed in parallel.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data model, endpoint classification seed, and Kafka topics must be fully in place before enforcement, CRUD, or UI work begins.

- [ ] T004 Implement full DDL in `services/provisioning-orchestrator/src/migrations/095-function-deploy-exec-separation.sql`: tables `function_privilege_assignments`, `function_privilege_denials`, `function_privilege_assignment_history` with all indexes; `ALTER TABLE api_keys ADD COLUMN function_privileges TEXT[]`; `ALTER TABLE endpoint_scope_requirements ADD COLUMN function_privilege_subdomain TEXT`
- [ ] T005 Seed `endpoint_scope_requirements` with `function_privilege_subdomain` classifications for all function endpoints (`/v1/functions` family) — `function_deployment` for create/update/delete/config/triggers/packages, `function_invocation` for invoke/activations/results — inside the same migration or as an idempotent seed step in `services/provisioning-orchestrator/src/migrations/095-function-deploy-exec-separation.sql`
- [ ] T006 [P] Create domain model `services/provisioning-orchestrator/src/models/function-privilege-assignment.mjs` exporting `FunctionPrivilegeAssignment` class with fields: `id`, `tenantId`, `workspaceId`, `memberId`, `functionDeployment`, `functionInvocation`, `assignedBy`, `assignedAt`, `updatedAt`
- [ ] T007 [P] Create repository `services/provisioning-orchestrator/src/repositories/function-privilege-repository.mjs` with methods: `upsert(assignment)`, `findByWorkspaceMember(workspaceId, memberId)`, `listByWorkspace(workspaceId)`, `recordDenial(denialEvent)`, `queryDenials(filters)` — uses `pg`, connection from shared pool
- [ ] T008 [P] Create events module `services/provisioning-orchestrator/src/events/function-privilege-events.mjs` exporting Kafka publish helpers for topics `console.security.function-privilege-denied`, `console.security.function-privilege-assigned`, `console.security.function-privilege-review-notice`
- [ ] T009 [P] Populate JSON Schema contracts in `specs/095-function-deploy-exec-separation/contracts/`: `function-privilege-assignment.schema.json` (GET/PUT response), `function-privilege-denial.schema.json` (audit entry), all three event schemas

**Checkpoint**: Database schema, domain model, repository, event helpers, and contracts are all committed. No story work should begin before this phase.

---

## Phase 3: User Story 1 – Platform enforces deploy-only and execute-only roles (Priority: P1) 🎯 MVP

**Goal**: The APISIX scope-enforcement plugin evaluates `function_privilege_subdomain` in addition to the top-level privilege domain from T04. Deploy-only credentials receive 403 on invoke paths; invoke-only credentials receive 403 on deploy paths. Every denial is audited.

**Independent Test**: Assign a deploy-only service account. Attempt `POST /v1/functions/:id/invoke` → expect 403 + `function_privilege_denied` Kafka event + row in `function_privilege_denials`. Assign an invoke-only service account. Attempt `POST /v1/functions` → expect 403 + same evidence. Assign a dual-role account → both operations succeed.

### Implementation for User Story 1

- [ ] T010 [US1] Extend `services/gateway-config/plugins/scope-enforcement.lua`: read `function_privilege_subdomain` field from endpoint requirements cache; extract `function_deployment`/`function_invocation` claims from JWT or API key metadata; add evaluation block returning HTTP 403 with error body `{"code":"FUNCTION_PRIVILEGE_MISMATCH","requiredSubdomain":"...","presentedSubdomains":[...]}` when sub-domain check fails; inject `X-Function-Privilege-Subdomain` header on pass
- [ ] T011 [US1] Update endpoint requirements cache loader in `services/gateway-config/plugins/scope-enforcement.lua` (or its config loader) to fetch `function_privilege_subdomain` column from `endpoint_scope_requirements` table and include it in the in-memory lookup structure; respect `FUNCTION_PRIVILEGE_CACHE_TTL_SECONDS`
- [ ] T012 [US1] Add Kafka fire-and-forget publish for `console.security.function-privilege-denied` inside the 403 branch of `services/gateway-config/plugins/scope-enforcement.lua` (or existing Lua Kafka helper), including all fields: `actorId`, `actorType`, `attemptedOperation`, `requiredSubdomain`, `presentedSubdomains`, `topLevelDomain`, `requestPath`, `targetFunctionId`, `correlationId`, `occurredAt`
- [ ] T013 [US1] Implement Kafka consumer or async action `services/provisioning-orchestrator/src/actions/function-privilege-denial-recorder.mjs` that persists rows from `console.security.function-privilege-denied` topic into `function_privilege_denials` via `function-privilege-repository.mjs`
- [ ] T014 [US1] Write Lua unit tests in `services/gateway-config/tests/plugins/scope-enforcement-function-subdomain.spec.lua` covering: deploy-only → invoke path → 403, invoke-only → deploy path → 403, dual-role → both paths pass, top-level domain correct but sub-domain wrong → 403, function endpoint without subdomain requirement → no regression
- [ ] T015 [US1] Write backend unit tests in `services/provisioning-orchestrator/src/tests/actions/function-privilege-denial-recorder.test.mjs` covering: event consumed → row inserted, duplicate idempotency, unknown actor type handled gracefully

**Checkpoint**: US1 independently testable — APISIX enforces function sub-domain boundaries and all denials are audited.

---

## Phase 4: User Story 2 – Tenant Owner assigns function privileges per workspace member (Priority: P1)

**Goal**: Tenant owners can independently grant/revoke `function_deployment` and `function_invocation` per workspace member via the console and backing API. Changes propagate within 60 seconds.

**Independent Test**: In the console, open a member's permissions panel; see "Function Deployment" and "Function Invocation" as separate toggleable controls; grant only invocation; verify backend persists the assignment, Keycloak role is synced, and a deploy attempt from that member is denied after propagation.

### Implementation for User Story 2

- [ ] T016 [US2] Implement OpenWhisk action `services/provisioning-orchestrator/src/actions/function-privilege-assign.mjs`: `PUT /api/workspaces/:workspaceId/members/:memberId/function-privileges` — validates top-level domain compatibility, calls `function-privilege-repository.mjs#upsert`, publishes `console.security.function-privilege-assigned` event, writes history row to `function_privilege_assignment_history`, returns updated assignment; handle `409 CONFLICT` on concurrent change
- [ ] T017 [US2] Implement OpenWhisk action `services/provisioning-orchestrator/src/actions/function-privilege-query.mjs`: `GET /api/workspaces/:workspaceId/members/:memberId/function-privileges` and `GET /api/workspaces/:workspaceId/members/function-privileges` (list all members) — reads from `function_privilege_assignments` via repository; multi-tenant safe
- [ ] T018 [US2] Add Keycloak role sync inside `function-privilege-assign.mjs`: grant/revoke Keycloak realm roles `function_deployment_{workspaceId}` and `function_invocation_{workspaceId}` via Keycloak admin API; surface `KEYCLOAK_SYNC_FAILED` warning in response body without rolling back PostgreSQL write
- [ ] T019 [US2] Add APISIX cache invalidation trigger after assignment change in `function-privilege-assign.mjs`: POST to APISIX admin API to flush the function endpoint requirements cache entry or decrement TTL to zero; fall back gracefully if APISIX is unreachable
- [ ] T020 [P] [US2] Implement React component `apps/web-console/src/components/members/FunctionPrivilegeToggles.tsx`: renders "Function Deployment" and "Function Invocation" as independent `<Switch>` controls using shadcn/ui; accepts `functionDeployment: boolean`, `functionInvocation: boolean`, `onChange(patch)` props; disabled state when actor lacks admin permission
- [ ] T021 [P] [US2] Integrate `FunctionPrivilegeToggles` into existing workspace member permissions panel at `apps/web-console/src/pages/workspace/MemberPermissionsPage.tsx` (or equivalent path): fetch current assignment via `GET .../function-privileges`, render toggles, call `PUT .../function-privileges` on change, show success toast or error message
- [ ] T022 [US2] Write action unit tests in `services/provisioning-orchestrator/src/tests/actions/function-privilege-assign.test.mjs`: upsert idempotency, incompatible top-level domain rejected with 400, concurrent update returns 409, Keycloak sync failure returns warning but 200, event published on success
- [ ] T023 [P] [US2] Write React tests in `apps/web-console/src/tests/FunctionPrivilegeToggles.test.tsx`: renders toggles with correct state, calls onChange on interaction, shows error when API call fails, disables toggles when read-only

**Checkpoint**: US2 independently testable — tenant owners can manage function privileges via console and API; changes propagate within the SLA.

---

## Phase 5: User Story 3 – API keys scoped to function deployment or invocation (Priority: P2)

**Goal**: API key creation and update flows accept explicit `functionPrivileges` array (`function_deployment`, `function_invocation`), validated against the key's top-level privilege domain. APISIX evaluates these scopes the same way it evaluates member claims.

**Independent Test**: Create API key with `functionPrivileges: ["function_deployment"]`. Use key to invoke a function → 403. Create key with `["function_invocation"]` → deploy attempt returns 403. Create key with both (where top-level domain allows) → both operations succeed.

### Implementation for User Story 3

- [ ] T024 [US3] Extend API key create/update action (existing `services/provisioning-orchestrator/src/actions/` key management action): accept `functionPrivileges` field; validate that `function_deployment` is only allowed when `topLevelPrivilegeDomain = structural_admin`, `function_invocation` only when `data_access`; store validated array in `api_keys.function_privileges` column
- [ ] T025 [US3] Update APISIX key-auth metadata extraction in `services/gateway-config/plugins/scope-enforcement.lua` (or API key metadata loader): read `function_privileges` array from API key record and surface it as the `presentedSubdomains` set fed into the function sub-domain evaluation block added in T010
- [ ] T026 [P] [US3] Update JSON Schema contract `specs/095-function-deploy-exec-separation/contracts/function-privilege-assignment.schema.json` and add `api-key-function-scope.schema.json` under `specs/095-function-deploy-exec-separation/contracts/`; update `services/internal-contracts/src/` exports/index to include new schemas
- [ ] T027 [P] [US3] Update API key creation UI in `apps/web-console/src/pages/api-keys/ApiKeyCreatePage.tsx` (or equivalent): add "Function Access" section with checkboxes for "Function Deployment" and "Function Invocation", dynamically disabled based on selected top-level privilege domain
- [ ] T028 [US3] Write unit tests in `services/provisioning-orchestrator/src/tests/actions/api-key-function-scope.test.mjs`: `function_deployment` rejected when `data_access` top-level, `function_invocation` rejected when `structural_admin` top-level, both accepted when top-level allows, column stored correctly
- [ ] T029 [P] [US3] Write React tests in `apps/web-console/src/tests/ApiKeyFunctionScope.test.tsx`: checkboxes rendered, `function_deployment` disabled when `data_access` domain selected, correct payload submitted

**Checkpoint**: US3 independently testable — API keys carry explicit function scopes; enforcement and UI both validated.

---

## Phase 6: User Story 4 – Superadmin audits function privilege boundary violations (Priority: P2)

**Goal**: A superadmin can query `GET /api/security/function-privileges/denials` with filters by `requiredSubdomain`, `attemptedOperation`, `workspaceId`, `actorId`, date range, with results distinguishing deploy-denied-to-invoker from invoke-denied-to-deployer.

**Independent Test**: Trigger both denial types (deploy-only invoking, invoke-only deploying). Query with `requiredSubdomain=function_deployment` → only deployment denial events. Query with `requiredSubdomain=function_invocation` → only invocation denial events.

### Implementation for User Story 4

- [ ] T030 [US4] Implement OpenWhisk action `services/provisioning-orchestrator/src/actions/function-privilege-audit-query.mjs`: `GET /api/security/function-privileges/denials` with query params `tenantId`, `workspaceId`, `requiredSubdomain`, `attemptedOperation`, `actorId`, `from`, `to`, `limit` (default 50, max 200), `offset`; reads from `function_privilege_denials` via repository; superadmin-only authorization gate; returns paginated response per contract
- [ ] T031 [P] [US4] Update `services/provisioning-orchestrator/src/repositories/function-privilege-repository.mjs#queryDenials` to build parameterized SQL with all supported filter columns, index-aligned ordering (`denied_at DESC`), and `total` count via `COUNT(*) OVER()`
- [ ] T032 [P] [US4] Add audit query page `apps/web-console/src/pages/security/FunctionPrivilegeDenialsPage.tsx`: filter controls for sub-domain, attempted operation, workspace, actor, date range; results table with columns actor, type, attempted-operation, required-subdomain, presented-subdomains, target-function, denied-at; pagination; CSV export button
- [ ] T033 [US4] Write unit tests in `services/provisioning-orchestrator/src/tests/actions/function-privilege-audit-query.test.mjs`: filter by `requiredSubdomain`, filter by `attemptedOperation`, combined filters, pagination, non-superadmin blocked with 403, empty result set
- [ ] T034 [P] [US4] Write React tests in `apps/web-console/src/tests/FunctionPrivilegeDenialsPage.test.tsx`: filter interactions, results render, export button visible

**Checkpoint**: US4 independently testable — superadmins can query and filter function privilege boundary violations.

---

## Phase 7: User Story 5 – Migrate existing function permissions to the new model (Priority: P3)

**Goal**: On feature activation, all users and API keys with pre-existing function access automatically receive both `function_deployment` and `function_invocation` sub-domains. Workspace owners receive a review notification. Migration is idempotent and zero-downtime.

**Independent Test**: Run migration against a workspace with legacy function-capable members; verify each member has both privileges in `function_privilege_assignments`; verify a `function_privilege_review_notice` Kafka event was emitted per member/workspace; verify existing deploy and invoke operations still succeed.

### Implementation for User Story 5

- [ ] T035 [US5] Implement OpenWhisk action `services/provisioning-orchestrator/src/actions/function-api-key-migration.mjs`: scan `api_keys` where `function_privileges IS NULL OR function_privileges = '{}'` and the key's top-level domain is `structural_admin` or `data_access` (function-capable); backfill `function_privileges` with both `function_deployment` and `function_invocation` using `UPDATE ... WHERE function_privileges IS NULL OR function_privileges = '{}'` (idempotent); batch by tenant; emit `console.security.function-privilege-review-notice` per key/workspace; log counts
- [ ] T036 [US5] Implement member migration query in the same action (or a separate `function-member-migration.mjs`): `INSERT INTO function_privilege_assignments (tenant_id, workspace_id, member_id, function_deployment, function_invocation, assigned_by, ...) SELECT ... FROM workspace_members WHERE ... ON CONFLICT (tenant_id, workspace_id, member_id) DO NOTHING` — preserves manually refined rows, only fills new ones; emit review notice per workspace
- [ ] T037 [US5] Add migration notification handler logic: consume `console.security.function-privilege-review-notice` and create an in-app notification or banner record in the appropriate notifications table (or emit to `console.notifications.*` topic used by existing notification infrastructure); message should state "Function privileges should be reviewed and tightened"
- [ ] T038 [P] [US5] Add migration notice banner to `apps/web-console/src/pages/workspace/WorkspaceMembersPage.tsx` (or members overview): conditionally render a `<Alert>` component (shadcn/ui) informing tenant owners that function privileges were assigned by default and should be reviewed; dismiss stored in local state or backend flag
- [ ] T039 [US5] Write migration unit tests in `services/provisioning-orchestrator/src/tests/actions/function-api-key-migration.test.mjs`: idempotency (re-run does not overwrite manual refinements), all legacy keys backfilled, review notice emitted per workspace, batch pagination with large member sets
- [ ] T040 [P] [US5] Write React tests in `apps/web-console/src/tests/WorkspaceMigrationBanner.test.tsx`: banner renders when flag present, dismisses correctly

**Checkpoint**: US5 independently testable — migration preserves full backward compatibility and workspace owners are notified to review.

---

## Phase 8: Foundational — Trigger Runtime Identity Validation (Cross-Cutting)

**Purpose**: Validate that the runtime identity associated with a function trigger holds `function_invocation` at trigger create/update time. This is a cross-cutting concern referenced in the spec edge cases and FR-012.

- [ ] T041 Implement or extend trigger create/update handler in `apps/control-plane/src/` (handler for `POST /v1/functions/:id/triggers` and `PUT /v1/functions/:id/triggers/:triggerId`): after authentication, look up the trigger's `runtimeIdentityId`; call `function-privilege-repository.mjs#findByWorkspaceMember` (or equivalent API key lookup); if `functionInvocation = false`, either block (when `FUNCTION_TRIGGER_RUNTIME_VALIDATION_MODE=enforce`) or respond with warning field `triggerRuntimeIdentityWarning: "MISSING_FUNCTION_INVOCATION_PRIVILEGE"` (when mode=`warn`)
- [ ] T042 [P] Write integration test in `apps/control-plane/tests/triggers/trigger-runtime-identity-validation.test.mjs`: trigger created with deploy-only runtime identity → warn mode returns 201 with warning field; enforce mode returns 400 with `TRIGGER_RUNTIME_IDENTITY_MISSING_INVOKE`; trigger with invoke-capable identity → 201 no warning

**Checkpoint**: Trigger identity validation in place; edge case from spec covered.

---

## Phase 9: Backend Second-Line Revalidation (Cross-Cutting)

**Purpose**: The control-plane backend revalidates function sub-domain privileges before dispatching to OpenWhisk, providing defense-in-depth against APISIX misconfiguration or bypass.

- [ ] T043 Add middleware or request guard in `apps/control-plane/src/` function routes: read `X-Function-Privilege-Subdomain` and `X-Privilege-Domain` headers injected by APISIX (from T010); if missing or mismatched for deploy/invoke paths, return 403 `FUNCTION_PRIVILEGE_BACKEND_REVALIDATION_FAILED`; log structured warning
- [ ] T044 [P] Update `apps/control-plane/openapi/families/functions.openapi.json`: add `securityRequirements` or `x-privilege-subdomain` extension per operation documenting required function sub-domain; add 403 response schema with `code: FUNCTION_PRIVILEGE_MISMATCH` variant; add `X-Function-Privilege-Subdomain` to request header examples

**Checkpoint**: Second-line revalidation prevents bypass; OpenAPI updated.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: ADR, documentation, contract exports, CI validation, and rollout configuration.

- [ ] T045 Write ADR `docs/adr/adr-095-function-deploy-exec-separation.md` explaining: why function sub-domains refine T04 top-level domains instead of being independent domains; why enforcement is fail-closed; trigger identity validation design decision; migration dual-privilege strategy
- [ ] T046 [P] Update `services/internal-contracts/src/` exports/index to include all new schemas: `function-privilege-assignment.schema.json`, `function-privilege-denial.schema.json`, all three event schemas; bump package version if applicable
- [ ] T047 [P] Update `services/gateway-config/public-route-catalog.json` to include `function_privilege_subdomain` field for all function-related route entries; add a CI validation script or extend existing one to assert no function route is missing a sub-domain classification
- [ ] T048 [P] Update `AGENTS.md` (or project docs) with the Function Deploy–Execute Privilege Separation section: new env vars, new tables, new actions, new Kafka topics, new console pages — following the established section format in the file
- [ ] T049 Validate end-to-end rollout sequence: confirm `FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED=false` emits telemetry-only (no 403s), then flip to `true` and verify AC-01 through AC-08 acceptance criteria from `plan.md` are satisfied in staging environment; document evidence in PR description

**Checkpoint**: All cross-cutting concerns addressed — feature ready for PR review.

---

## Dependencies (Story Completion Order)

```text
Phase 1 (Setup)
    └─► Phase 2 (Foundational — schema, model, repo, events, contracts)
            ├─► Phase 3 (US1 — APISIX enforcement + denial recording)        [P1 MVP]
            │       └─► Phase 4 (US2 — member privilege CRUD + UI)           [P1 MVP]
            │               ├─► Phase 5 (US3 — API key scoping)              [P2]
            │               └─► Phase 6 (US4 — audit query + UI)             [P2]
            │                       └─► Phase 7 (US5 — migration)            [P3]
            ├─► Phase 8 (Trigger runtime identity validation — cross-cutting)
            │       (can start after Phase 2, independent of US1-US5 phases)
            └─► Phase 9 (Backend second-line revalidation)
                    (can start after Phase 3 enforcement headers are defined)

Phase 10 (Polish) ─► after all story phases complete
```

## Parallel Execution Examples

**After Phase 2 completes**:

| Track A | Track B | Track C |
|---------|---------|---------|
| Phase 3 (APISIX enforcement) | Phase 8 (Trigger validation — model design) | Phase 9 (Backend guard — skeleton) |

**Within Phase 4 (US2)**:

| Parallel group |
|----------------|
| T020 (`FunctionPrivilegeToggles` component) + T023 (React tests) |
| T016 (assign action) + T017 (query action) + T018 (Keycloak sync) |

**Within Phase 5 (US3)**:

| Parallel group |
|----------------|
| T026 (contracts + schema exports) + T027 (UI) + T029 (React tests) |

## Implementation Strategy

**MVP Scope (Stories 1 + 2)**:
- Complete Phases 1–4 to deliver enforcement at APISIX level and privilege assignment via console.
- Functional acceptance criteria AC-01, AC-02, AC-03, AC-04 are met.
- All other phases build on this foundation.

**Increment 2 (Stories 3 + 4)**:
- Phases 5–6: API key scoping and audit query.

**Increment 3 (Story 5 + Cross-Cutting)**:
- Phases 7–10: Migration, trigger validation, second-line revalidation, docs/ADR.

## Task Count Summary

| Phase | Story | Tasks | Notes |
|-------|-------|-------|-------|
| 1 — Setup | — | T001–T003 | 3 tasks |
| 2 — Foundational | — | T004–T009 | 6 tasks |
| 3 — US1 | P1 MVP | T010–T015 | 6 tasks |
| 4 — US2 | P1 MVP | T016–T023 | 8 tasks |
| 5 — US3 | P2 | T024–T029 | 6 tasks |
| 6 — US4 | P2 | T030–T034 | 5 tasks |
| 7 — US5 | P3 | T035–T040 | 6 tasks |
| 8 — Trigger validation | Cross-cutting | T041–T042 | 2 tasks |
| 9 — Backend revalidation | Cross-cutting | T043–T044 | 2 tasks |
| 10 — Polish | — | T045–T049 | 5 tasks |
| **Total** | | **T001–T049** | **49 tasks** |

**Parallelizable tasks**: T002, T003, T006, T007, T008, T009, T014, T015, T020, T023, T026, T027, T029, T031, T032, T034, T038, T040, T042, T044, T046, T047, T048

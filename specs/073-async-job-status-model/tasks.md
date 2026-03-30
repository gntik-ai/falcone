# Tasks: Modelo de Job/Operation Status para Workflows Asíncronos

**Feature**: US-UIB-02-T01 | **Branch**: `073-async-job-status-model`  
**Input**: Design documents from `/specs/073-async-job-status-model/`  
**Prerequisites**: plan.md ✅, spec.md ✅

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US4)
- File paths relative to repo root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and environment preparation

- [ ] T001 Verify `services/provisioning-orchestrator` package exists and update `package.json` to add `pg` and `kafkajs` as dependencies (or devDependencies for test env)
- [ ] T002 [P] Create directory structure: `services/provisioning-orchestrator/src/models/`, `src/repositories/`, `src/events/`, `src/actions/`, `src/migrations/`
- [ ] T003 [P] Create directory structure: `tests/unit/`, `tests/integration/`, `tests/contract/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create DDL migration file `services/provisioning-orchestrator/src/migrations/073-async-operation-tables.sql` with `async_operations` and `async_operation_transitions` tables, all constraints and indexes as defined in plan.md
- [ ] T005 [P] Create FSM module `services/provisioning-orchestrator/src/models/async-operation-states.mjs` exporting `VALID_TRANSITIONS`, `TERMINAL_STATES`, `isTerminal()`, and `validateTransition()` as specified in plan.md
- [ ] T006 [P] Create JSON Schema contract `services/internal-contracts/src/async-operation-state-changed.json` for the Kafka event `async_operation.state_changed` as specified in plan.md
- [ ] T007 Update `services/internal-contracts/src/index.mjs` to export the new `async-operation-state-changed.json` schema

**Checkpoint**: Foundation ready — FSM, DDL and event contract exist. User story phases can begin.

---

## Phase 3: User Story 1 — Registro de operación asíncrona al iniciar aprovisionamiento (Priority: P1) 🎯 MVP

**Goal**: When the console backend or API initiates a provisioning operation, the system creates an `async_operation` record with status `pending`, linked to tenant, actor and operation type.

**Independent Test**: Invoke `createOperation()` with valid callerContext and verify a record is returned with `status=pending`, all required fields (`operation_id`, `tenant_id`, `actor_id`, `actor_type`, `operation_type`, `correlation_id`, `created_at`, `updated_at`), and that missing `tenant_id` / `actor_id` raises `VALIDATION_ERROR`.

### Tests for User Story 1

- [ ] T008 [P] [US1] Write unit tests for `createOperation()` factory in `tests/unit/async-operation.test.mjs`: valid creation, missing required fields (`tenant_id`, `actor_id`, `actor_type`, `operation_type`), invalid `actor_type`, auto-generated `correlation_id`, nullable `workspace_id`/`idempotency_key`/`saga_id`

### Implementation for User Story 1

- [ ] T009 [US1] Create entity/factory module `services/provisioning-orchestrator/src/models/async-operation.mjs` — exports `createOperation()` and `applyTransition()` (domain logic only, no DB) as specified in plan.md (depends on T005)
- [ ] T010 [US1] Create PostgreSQL repository `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` — implement `createOperation(db, operation)` and `findById(db, { operation_id, tenant_id })` with tenant isolation (depends on T004, T009)
- [ ] T011 [P] [US1] Write integration tests for `createOperation` and `findById` in `tests/integration/async-operation-repo.test.mjs`: happy path, tenant isolation (actor of tenant A cannot see tenant B record), rejection without tenant_id/actor_id (depends on T004, T010)
- [ ] T012 [US1] Create OpenWhisk action `services/provisioning-orchestrator/src/actions/async-operation-create.mjs` — validates `callerContext`, calls `createOperation()` → `repo.createOperation()` → `events.publishStateChanged()`, returns `{ operationId, status, correlationId, createdAt }` (depends on T010, Kafka publisher in Phase 4)

**Checkpoint**: User Story 1 functional — `async-operation/create` action creates a record with `status=pending` and required fields verifiable independently.

---

## Phase 4: User Story 2 — Transiciones de estado del ciclo de vida (Priority: P1)

**Goal**: The system allows state transitions according to the FSM (`pending→running`, `running→completed`, `running→failed`). Invalid transitions are rejected with a descriptive error. Terminal states are immutable.

**Independent Test**: Create an operation, apply valid transitions in sequence (`pending→running→completed`), verify timestamps update. Attempt invalid transitions (e.g., `completed→running`) and confirm `INVALID_TRANSITION` error is thrown without corrupting state.

### Tests for User Story 2

- [ ] T013 [P] [US2] Write unit tests for `validateTransition()` FSM in `tests/unit/async-operation-states.test.mjs`: all valid transitions, all invalid transitions, terminal state immutability, error code `INVALID_TRANSITION`, `isTerminal()` for each status
- [ ] T014 [P] [US2] Extend unit tests in `tests/unit/async-operation.test.mjs` for `applyTransition()`: valid transitions with updated `updated_at`, `running→failed` requires `error_summary`, state not mutated on invalid transition

### Implementation for User Story 2

- [ ] T015 [US2] Extend `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` — implement `transitionOperation(db, { operation_id, tenant_id, new_status, actor_id, error_summary })` using atomic PG transaction: `SELECT FOR UPDATE`, FSM validation, `UPDATE async_operations`, `INSERT async_operation_transitions`, rollback on any failure (depends on T010)
- [ ] T016 [P] [US2] Create Kafka event publisher `services/provisioning-orchestrator/src/events/async-operation-events.mjs` — implement `publishStateChanged(producer, operation, previousStatus)` publishing to topic `console.async-operation.state-changed` with tenant-keyed partition; best-effort (Kafka failure does not rollback PG transaction) (depends on T006)
- [ ] T017 [P] [US2] Write contract tests in `tests/contract/async-operation-state-changed.test.mjs` — validate Kafka event payloads for `pending→running`, `running→completed`, `running→failed` against JSON Schema using `ajv` (depends on T006)
- [ ] T018 [US2] Extend integration tests in `tests/integration/async-operation-repo.test.mjs` — add tests for `transitionOperation`: valid transitions create `async_operation_transitions` row, invalid transition (`completed→running`) returns `INVALID_TRANSITION` without corrupting DB state, `running→failed` persists `error_summary` (depends on T015)
- [ ] T019 [US2] Create OpenWhisk action `services/provisioning-orchestrator/src/actions/async-operation-transition.mjs` — validates `callerContext`, resolves tenant isolation (superadmin bypass), calls `repo.transitionOperation()` → `events.publishStateChanged()`, returns `{ operationId, previousStatus, newStatus, updatedAt }`, correct error codes: `NOT_FOUND`(404), `INVALID_TRANSITION`(409), `VALIDATION_ERROR`(400), `TENANT_ISOLATION_VIOLATION`(403) (depends on T015, T016)
- [ ] T020 [US2] Update `services/provisioning-orchestrator/src/actions/async-operation-create.mjs` to wire in `events.publishStateChanged()` after `repo.createOperation()` (depends on T012, T016)

**Checkpoint**: User Story 2 functional — FSM enforces all valid/invalid transitions; Kafka events published; integration tests green.

---

## Phase 5: User Story 3 — Aislamiento multi-tenant (Priority: P1)

**Goal**: Operation records are strictly isolated by tenant. No actor from tenant A can see or modify operations of tenant B. Superadmin can query across all tenants.

**Independent Test**: Create operations in two distinct tenants. Query from tenant A — only tenant A records returned. Attempt direct access to tenant B record by ID from tenant A context — returns NOT_FOUND or 403. Query as superadmin without tenant filter — sees all records.

### Tests for User Story 3

- [ ] T021 [P] [US3] Extend integration tests in `tests/integration/async-operation-repo.test.mjs` — cross-tenant isolation: actor of tenant A queries `findById` with tenant B's `operation_id` returns `null`; `findByTenant` with tenant A only returns tenant A records; superadmin `findAll` returns records from both tenants (depends on T010, T015)

### Implementation for User Story 3

- [ ] T022 [US3] Extend `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` — implement `findByTenant(db, { tenant_id, status?, limit, offset })` with mandatory `tenant_id` filter and `findAll(db, { status?, limit, offset })` for superadmin cross-tenant queries (all queries except `findAll` enforce `tenant_id`) (depends on T010)
- [ ] T023 [US3] Verify OpenWhisk action `async-operation-transition.mjs` enforces tenant isolation: `tenant_id` always sourced from verified `callerContext`, never from caller payload; superadmin bypass only when `callerContext.actorType === 'superadmin'` (audit/review task — fix if needed) (depends on T019)
- [ ] T024 [US3] Verify OpenWhisk action `async-operation-create.mjs` enforces tenant isolation: `tenant_id` and `actor_id` always taken from `callerContext`, reject if missing (audit/review task — fix if needed) (depends on T020)

**Checkpoint**: User Story 3 functional — tenant isolation verified end-to-end in integration tests; superadmin cross-tenant access confirmed.

---

## Phase 6: User Story 4 — Metadatos mínimos y trazabilidad (Priority: P2)

**Goal**: Every operation record contains all required traceability fields. `correlation_id` is generated if not provided. `updated_at` reflects every state transition. Failed operations include `error_summary` with readable text, no sensitive data.

**Independent Test**: Create an operation and inspect all fields — `operation_id`, `tenant_id`, `actor_id`, `workspace_id`, `operation_type`, `status`, `created_at`, `updated_at`, `correlation_id` must all be present. Apply a transition and verify `updated_at` changes. Transition to `failed` and verify `error_summary` contains `code`, `message`, and optionally `failedStep` without stack traces or connection strings.

### Tests for User Story 4

- [ ] T025 [P] [US4] Extend unit tests in `tests/unit/async-operation.test.mjs` — metadata completeness: all required fields present after `createOperation()`, auto-generated `correlation_id` follows pattern `op:{tenantId}:{ts_base36}:{random8}`, `updated_at` changes after `applyTransition()`, `error_summary` structure validated for `failed` transitions
- [ ] T026 [P] [US4] Extend integration tests in `tests/integration/async-operation-repo.test.mjs` — field persistence: verify `updated_at` is updated in DB after `transitionOperation()`, `error_summary` stored correctly for `failed` transitions, `async_operation_transitions` row contains correct `previous_status`, `new_status`, `actor_id`, `tenant_id`, `transitioned_at`

### Implementation for User Story 4

- [ ] T027 [US4] Review and harden `error_summary` construction in `async-operation-transition.mjs` action — ensure `message` field never contains stack traces, connection strings, internal paths, or user PII; document acceptable message patterns (depends on T019)
- [ ] T028 [US4] Validate `correlation_id` generation and propagation in `async-operation.mjs` — if `callerContext` provides `correlationId` it is propagated; otherwise auto-generated per pattern; ensure `correlation_id` is included in structured log output from both OW actions (depends on T009, T012, T020)

**Checkpoint**: User Story 4 functional — all traceability fields verified in unit and integration tests; error_summary content validated as safe.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, observability wiring, and final validation

- [ ] T029 [P] Create ADR `docs/adr/073-async-job-status-model.md` documenting Decisions 1–5 from plan.md (entity independence, transition log in PG, correlation_id generation, Kafka topic, OW action structure)
- [ ] T030 [P] Add structured log statements (`console.log` JSON) to both OW actions (`async-operation-create.mjs`, `async-operation-transition.mjs`) for every create and transition event with fields: `operation_id`, `tenant_id`, `correlation_id`, `status`
- [ ] T031 [P] Add Prometheus-compatible metric counters (or log-based metric annotations) in OW actions: `async_operation_created_total{tenant, operation_type}`, `async_operation_transition_total{from, to}`, `async_operation_event_publish_failures_total`
- [ ] T032 Run `pnpm -r lint` and `pnpm -r test` from repo root; fix any lint/test failures
- [ ] T033 [P] Update `AGENTS.md` at repo root to reflect new modules and technology additions (ESM, pg, kafkajs, OpenWhisk actions pattern)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2; requires DDL (T004) and FSM (T005)
- **User Story 2 (Phase 4)**: Depends on Phase 3 completion (T009, T010); T013–T014 tests can start after T005
- **User Story 3 (Phase 5)**: Depends on Phase 3 and Phase 4 for full isolation verification
- **User Story 4 (Phase 6)**: Depends on Phase 3 and Phase 4 (traceability fields already created, needs hardening/validation)
- **Polish (Phase 7)**: Depends on Phases 3–6 completion

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependency on other stories
- **US2 (P1)**: Depends on US1 entity module (T009); FSM tests (T013) can run in parallel after T005
- **US3 (P1)**: Depends on US1 repository (T010); isolation tests require US2 `transitionOperation`
- **US4 (P2)**: Depends on US1 factory (T009) and US2 transition action (T019); can proceed in parallel once those are done

### Parallel Opportunities Within Phases

- **Phase 2**: T005 (FSM module) and T006 (JSON Schema) are fully independent and parallel
- **Phase 3**: T008 (unit tests) can be written before T009 is complete (TDD)
- **Phase 4**: T013, T014, T016, T017 are all parallel after Phase 2 completes
- **Phase 7**: T029, T030, T031, T033 are all parallel

---

## Parallel Example: User Story 2

```bash
# Launch in parallel (no file conflicts, no dependencies between them):
Task T013: Unit tests for FSM validateTransition() in tests/unit/async-operation-states.test.mjs
Task T014: Unit tests for applyTransition() in tests/unit/async-operation.test.mjs
Task T016: Kafka publisher in services/provisioning-orchestrator/src/events/async-operation-events.mjs
Task T017: Contract tests in tests/contract/async-operation-state-changed.test.mjs

# Then sequentially:
Task T015: transitionOperation() in repository (depends on T009, T005)
Task T018: Integration tests for transitionOperation (depends on T015)
Task T019: async-operation-transition.mjs OW action (depends on T015, T016)
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 — minimum viable model)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (DDL, FSM, schema) — **CRITICAL**
3. Complete Phase 3: US1 — create operation with pending status
4. Complete Phase 4: US2 — state transitions with Kafka events
5. **STOP and VALIDATE**: Run all unit + integration tests; verify AC-01 through AC-08 from plan.md
6. Deploy foundation; T02–T06 tasks can begin

### Incremental Delivery

1. Setup + Foundational → infrastructure ready
2. US1 → record creation working → independently testable (MVP foundation)
3. US2 → transitions + events → T02/T03 unblocked
4. US3 → isolation hardened → production-safe
5. US4 → traceability complete → audit-ready
6. Polish → docs + observability → PR ready

### Definition of Done (from plan.md)

| DOD | Check |
|-----|-------|
| DOD-01 | `async_operations` + `async_operation_transitions` tables with indexes exist (T004) |
| DOD-02 | Unit tests FSM 100% pass (T005, T008, T013, T014) |
| DOD-03 | Integration tests tenant isolation pass (T011, T018, T021, T026) |
| DOD-04 | Contract test Kafka event pass (T017) |
| DOD-05 | OW actions execute locally without error (T012, T019) |
| DOD-06 | Tenant isolation verified (T021, T023, T024) |
| DOD-07 | `async-operation-state-changed.json` exported from `internal-contracts` (T006, T007) |
| DOD-08 | ADR present in `docs/adr/` (T029) |
| DOD-09 | `pnpm -r lint` + `pnpm -r test` green (T032) |
| DOD-10 | SC-001: operation created < 2s p95 (measured in T011) |
| DOD-11 | SC-002: invalid transitions rejected 100% (T013) |
| DOD-12 | SC-003: tenant isolation 100% (T021) |
| DOD-13 | SC-004 + SC-005: audit event and traceability fields (T017, T025, T026) |

---

## Notes

- [P] tasks = different files, no dependencies — safe to parallelize
- [Story] label maps each task to its user story for traceability
- `tenant_id` is ALWAYS sourced from `callerContext` (IAM-verified), never from client payload
- Superadmin cross-tenant access: verified by `callerContext.actorType === 'superadmin'` only
- `error_summary.message` must never contain stack traces, connection strings, or PII
- Kafka publish is best-effort: failure logs metric but does NOT rollback PG transaction
- Commit after each phase or logical group; reference task IDs in commit messages

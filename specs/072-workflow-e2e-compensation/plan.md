# Implementation Plan: E2E Tests for Complex Workflows with Partial Failure Compensation

**Branch**: `072-workflow-e2e-compensation` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/072-workflow-e2e-compensation/spec.md`
**Backlog Traceability**: US-UIB-01-T06 · Epic EP-16 · Historia US-UIB-01

---

## Summary

This plan covers the creation of an E2E test suite that validates complex, multi-step console backend workflows running on Apache OpenWhisk, exercising the complete lifecycle: happy-path completion, partial failure detection, saga/compensation rollback in reverse order, idempotency under retry, multi-tenant isolation, and full audit traceability via a single correlation-id.

The test suite targets at least three representative workflow types (tenant provisioning, workspace creation, credential generation). Fault injection is achieved through test-controlled doubles or configuration flags without touching production workflow code. All tests must be CI-runnable and produce machine-readable results.

---

## Technical Context

**Language/Version**: Node.js 20+ (ESM modules), aligned with existing project standard  
**Primary Dependencies**:
- `node:test` (built-in) — test runner  
- Apache OpenWhisk client SDK (`openwhisk` npm package) — action invocation and activation polling  
- Apache APISIX (API Gateway) — HTTP console endpoint access  
- Keycloak — tenant authentication tokens for multi-tenant test contexts  
- PostgreSQL + MongoDB — state and audit log assertions  
- Kafka — event-driven side-effect assertions (optional, for event verification)  
**Storage**: PostgreSQL (relational workflow/audit data), MongoDB (document state)  
**Testing**: `node:test` (built-in), custom E2E harness, OpenWhisk test activations  
**Target Platform**: Kubernetes/OpenShift — tests run as a CI job against a deployed environment  
**Project Type**: E2E test suite (no production source changes; test infrastructure and scripts only)  
**Performance Goals**: Full suite completes within 10 minutes in a standard CI environment (SC-007)  
**Constraints**:
- No modification of production workflow code for fault injection
- Multi-tenant: test contexts must be fully isolated (separate tenant provisioning)
- Idempotency keys must be tracked and asserted across re-executions
- Compensation retry budget: ≤3 retries (SC-006)
**Scale/Scope**: ≥3 workflow types × 5 test scenario categories (happy path, partial failure, compensation retry, idempotency, multi-tenant isolation)

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo Separation | ✅ PASS | E2E tests land in `tests/e2e/workflows/` per constitution §I. No new top-level folders introduced. |
| II. Incremental Delivery | ✅ PASS | Test harness scaffolding is minimal; only adds test infra files. No production code touched. |
| III. Kubernetes/OpenShift Compatibility | ✅ PASS | CI job is a standard pod; no OpenShift-incompatible APIs used. |
| IV. Quality Gates at Root | ✅ PASS | A root-level script `scripts/test:e2e:workflows` will invoke the suite, reachable from repo root. |
| V. Documentation as Part of Change | ✅ PASS | `docs/adr/` entry required for fault injection mechanism decision (see Phase 1). |

**Violations requiring justification**: None.

---

## Project Structure

### Documentation (this feature)

```text
specs/072-workflow-e2e-compensation/
├── plan.md              ← This file (speckit.plan output)
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/           ← Phase 1 output
│   ├── fault-injection-api.md
│   └── audit-query-contract.md
└── tasks.md             ← Phase 2 output (speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
tests/
└── e2e/
    └── workflows/
        ├── helpers/
        │   ├── tenant-provisioner.mjs      # Create/destroy isolated tenant contexts
        │   ├── workflow-client.mjs         # Invoke console workflow endpoints via APISIX
        │   ├── openwhisk-poller.mjs        # Poll OpenWhisk activation results
        │   ├── fault-injector.mjs          # Configure fault injection per workflow step
        │   ├── audit-asserter.mjs          # Query and assert audit log by correlation-id
        │   └── idempotency-tracker.mjs     # Track and assert idempotency key outcomes
        ├── fixtures/
        │   ├── workflow-configs/           # Per-workflow-type test configuration
        │   │   ├── tenant-provisioning.json
        │   │   ├── workspace-creation.json
        │   │   └── credential-generation.json
        │   └── fault-injection/            # Fault injection scenarios per workflow
        │       ├── fail-at-step-2.json
        │       └── fail-at-step-n.json
        ├── happy-path.test.mjs             # FR-001, SC-001
        ├── partial-failure.test.mjs        # FR-002, FR-003, SC-002
        ├── compensation-retry.test.mjs     # FR-007, SC-006
        ├── idempotency.test.mjs            # FR-006, SC-005
        ├── multi-tenant-isolation.test.mjs # FR-005, SC-004
        ├── audit-traceability.test.mjs     # FR-004, SC-003
        └── index.mjs                       # Suite entry point (CI-executable)

scripts/
└── test-e2e-workflows.sh                  # Root-level gate: runs full E2E suite

docs/adr/
└── ADR-E2E-001-fault-injection-mechanism.md  # Documents chosen fault injection approach
```

**Structure Decision**: Single-project layout (Option 1 variant), using `tests/e2e/workflows/` to house all E2E test artifacts per the constitution's requirement that executable E2E validation lives under `tests/`. No production source files are modified.

---

## Phase 0: Research

**Output target**: `specs/072-workflow-e2e-compensation/research.md`

### Unknowns to Resolve

| # | Unknown | Research Task |
|---|---------|--------------|
| R1 | Fault injection mechanism | How to inject failures at specific OpenWhisk action steps without modifying production code: env-based flags, action aliases with stub implementations, or Kafka dead-letter simulation? |
| R2 | Audit log query interface | What API/query interface does US-UIB-01-T05 expose for correlation-id lookups? (HTTP endpoint, direct DB query, or event stream?) |
| R3 | Test tenant provisioning | Does a test-tenant creation utility already exist, or must this plan provide one? (impacts `tenant-provisioner.mjs` scope) |
| R4 | OpenWhisk activation polling latency | What is the realistic max activation completion time in CI? (impacts timeout configuration and 10-min CI budget) |
| R5 | Compensation detection signal | How does the saga/compensation layer (US-UIB-01-T04) signal compensation completion — synchronous response, Kafka event, or audit record? |
| R6 | Idempotency key protocol | Where is the idempotency key passed — HTTP header, request body field, or both? |
| R7 | Multi-tenant credential strategy | How are per-tenant Keycloak tokens obtained in CI without manual intervention? (service accounts vs. test realm config) |

### Best Practices Tasks

| # | Technology | Research Task |
|---|-----------|--------------|
| B1 | `node:test` parallel execution | Confirm parallel test isolation strategy for concurrent multi-tenant scenarios |
| B2 | OpenWhisk E2E patterns | Review existing OpenWhisk E2E test patterns from `001-function-versioning-rollback` for reuse |
| B3 | APISIX test routing | Confirm whether a dedicated test-traffic route or rate-limit bypass is needed for CI |

**Deliverable**: `research.md` consolidating Decision / Rationale / Alternatives for each item above.

---

## Phase 1: Design & Contracts

**Prerequisites**: `research.md` complete with all R1–R7 resolved.

### Data Model (`data-model.md`)

Key entities and their test-side representations:

| Entity | Fields | Notes |
|--------|--------|-------|
| `WorkflowTestRun` | `runId`, `workflowType`, `tenantId`, `correlationId`, `idempotencyKey`, `triggerTimestamp`, `finalState`, `stepOutcomes[]` | Created per test case |
| `StepOutcome` | `stepIndex`, `stepName`, `status` (`success`/`failed`/`compensated`), `compensationStatus`, `timestamp` | Asserted against audit log |
| `AuditEntry` | `correlationId`, `tenantId`, `actor`, `stepName`, `event`, `timestamp` | Queried from audit system |
| `FaultInjectionConfig` | `workflowType`, `failAtStep`, `compensationFailOnAttempt` (optional) | Drives `fault-injector.mjs` |
| `IdempotencyRecord` | `key`, `firstRunId`, `firstResult`, `rerunIds[]` | Asserted for zero-duplicate outcomes |

### Interface Contracts (`contracts/`)

1. **`fault-injection-api.md`** — Documents the interface for activating fault injection per workflow type and step index (resolved from R1). Covers: how the flag is passed (env var, action param, or test double registration), expected error shape returned, and cleanup protocol.

2. **`audit-query-contract.md`** — Documents the query interface for retrieving audit entries by correlation-id (resolved from R2). Covers: endpoint or query method, response schema, filtering by tenant-id and correlation-id, and expected completeness guarantees.

### Architecture: Test Flow

```
CI Job
  └─ index.mjs (suite entry)
       ├─ tenant-provisioner.mjs  ─→  Keycloak (create test realm / service account token)
       │                          ─→  PostgreSQL / MongoDB (pre-condition seed)
       ├─ fault-injector.mjs      ─→  OpenWhisk (register test double or inject env flag)
       ├─ workflow-client.mjs     ─→  APISIX → OpenWhisk action (trigger workflow)
       ├─ openwhisk-poller.mjs    ─→  OpenWhisk activation API (poll for completion)
       ├─ audit-asserter.mjs      ─→  Audit log API / DB (assert correlation-id completeness)
       ├─ idempotency-tracker.mjs ─→  Workflow endpoint (re-trigger with same key, assert dedup)
       └─ tenant-provisioner.mjs  ─→  Cleanup (destroy test tenant context)
```

### Agent Context Update

- Run `.specify/scripts/bash/update-agent-context.sh codex` after Phase 1 artifacts are complete.
- Technologies to add: `openwhisk` npm SDK, `node:test` parallel execution, Keycloak service account token flow.

---

## Complexity Tracking

No constitution violations. No additional tracking required.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| US-UIB-01-T04 (saga/compensation) not ready | Medium | High | Tests must declare hard dependency; if T04 not deployed, suite returns `skip` (not `fail`) with clear message |
| US-UIB-01-T05 (audit logging) not ready | Medium | High | Same `skip` strategy; audit-asserter returns `NOT_READY` sentinel |
| OpenWhisk activation timeout in CI | Low | Medium | Set configurable `ACTIVATION_TIMEOUT_MS` with default 120s; log activation IDs for debugging |
| Fault injection leaks state across tests | Medium | High | Each test creates a fresh tenant context; fault injector cleanup is `afterEach` |
| Cross-tenant data bleed from shared DB | Low | High | Tenant-id column filters enforced in all audit queries; assert absence of other-tenant records |
| Idempotency key collision across CI runs | Low | Medium | Prefix keys with `ci-run-${CI_JOB_ID}` to guarantee uniqueness per pipeline run |

---

## Rollback & Observability

- **Rollback**: Tests are read-only relative to production data; all writes are scoped to ephemeral test tenants that are cleaned up in `afterAll`.
- **Observability**: Each test logs its `correlationId` and `tenantId` on failure; `openwhisk-poller.mjs` emits activation IDs for post-mortem.
- **CI artefacts**: TAP-compatible output from `node:test`; activation logs uploaded as CI artifacts on failure.

---

## Dependency Sequence

```
US-UIB-01-T01 (workflow identification)
  ↓
US-UIB-01-T02 (OpenWhisk workflow functions deployed)
  ↓
US-UIB-01-T03 (console endpoint separation)
  ↓
US-UIB-01-T04 (saga/compensation implemented)  ←── HARD GATE for partial-failure tests
US-UIB-01-T05 (audit logging with correlation-id) ←── HARD GATE for audit tests
  ↓
US-UIB-01-T06 ← THIS TASK (E2E test suite)
```

Parallelizable within this task:
- `research.md` (Phase 0) can proceed in parallel across R1–R7 research items.
- `happy-path.test.mjs` can be scaffolded before T04/T05 are merged (placeholder assertions).
- `data-model.md` and `contracts/` can be authored as soon as R1 and R2 are resolved.

---

## Definition of Done

| Criterion | Evidence |
|-----------|---------|
| All 5 test scenario files exist under `tests/e2e/workflows/` | File presence in repo |
| `scripts/test-e2e-workflows.sh` runs from repo root | CI log shows `pass` exit |
| Happy-path scenarios pass for ≥3 workflow types (SC-001) | Green test output |
| Partial failure + compensation scenarios assert zero orphan resources (SC-002) | Test assertion output |
| Audit traceability queries return complete lifecycle by correlation-id (SC-003) | Assertion log |
| Multi-tenant concurrent run produces zero cross-tenant side-effects (SC-004) | Test assertion output |
| Idempotent re-execution produces zero duplicates (SC-005) | Assertion log |
| Compensation retries resolve within 3 attempts (SC-006) | Retry counter assertion |
| Full suite completes within 10 minutes in CI (SC-007) | CI job duration log |
| `docs/adr/ADR-E2E-001-fault-injection-mechanism.md` committed | File presence in repo |
| `research.md`, `data-model.md`, `contracts/` committed in feature branch | File presence in repo |

---

*Plan stops here. Next step: `/speckit.tasks` to generate `tasks.md`.*

# Tasks: Console Backend Audit and Correlation

**Feature**: `071-backend-audit-correlation`  
**Task ID**: US-UIB-01-T05  
**Epic**: EP-16 — Backend funcional de la consola  
**Story**: US-UIB-01 — Workflows backend de consola sobre OpenWhisk y orquestación segura  
**Generated**: 2026-03-29  
**Spec**: `specs/071-backend-audit-correlation/spec.md`  
**Plan**: `specs/071-backend-audit-correlation/plan.md`

> **Scope boundary**: T05 only — wiring audit emission and correlation-id propagation into the saga engine and all workflow function modules. Does NOT include: saga engine restructuring (T04), E2E failure and compensation tests (T06), new audit query/export surfaces (US-OBS-02), new UI screens, or new report products. All work must extend existing infrastructure without rework.

---

## File Map

### New Files to Create

| # | Path | Description |
|---|------|-------------|
| F-01 | `apps/control-plane/src/workflows/workflow-audit.mjs` | Centralised audit record builder and emitter for all console backend workflow executions |
| F-02 | `services/internal-contracts/src/console-workflow-audit-policy.json` | Declarative audit emission policy for T05 (workflow classification, masking policy, audit milestone steps) |
| F-03 | `tests/workflows/workflow-audit.test.mjs` | Unit tests: audit record emission, masking, validation, error paths |
| F-04 | `tests/workflows/workflow-audit-schema.test.mjs` | Contract validation tests: sample records against observability-audit-event-schema.json |

### Files to Modify

| # | Path | Change Description |
|---|------|--------------------|
| M-01 | `apps/control-plane/src/saga/saga-engine.mjs` | Add `emitWorkflowStarted`, `emitStepMilestone`, `emitWorkflowTerminal` calls; replace `// TODO(T05)` alert stub with real `events-admin.mjs` emit |
| M-02 | `apps/control-plane/src/saga/saga-definitions.mjs` | Add `auditMilestone: boolean` property to every step definition object |
| M-03 | `services/internal-contracts/src/index.mjs` | Export `getAuditEventSchemaForSubsystem` helper if not already present |

---

## Validation Commands

Run these after implementation to verify task completion:

```bash
# 1. Confirm all new source files exist
ls apps/control-plane/src/workflows/workflow-audit.mjs
ls services/internal-contracts/src/console-workflow-audit-policy.json
ls tests/workflows/workflow-audit.test.mjs
ls tests/workflows/workflow-audit-schema.test.mjs

# 2. Run unit tests for workflow-audit module
node --test tests/workflows/workflow-audit.test.mjs

# 3. Run contract schema validation tests
node --test tests/workflows/workflow-audit-schema.test.mjs

# 4. Run full saga engine test suite (must pass without regressions)
node --test tests/saga/saga-engine.test.mjs

# 5. Validate console-workflow-audit-policy.json parses correctly
node -e "const p = JSON.parse(require('fs').readFileSync('services/internal-contracts/src/console-workflow-audit-policy.json','utf8')); console.log('Policy OK, version:', p.version)"

# 6. Verify index.mjs exports getAuditEventSchemaForSubsystem
node --input-type=module <<'EOF'
import { getAuditEventSchemaForSubsystem } from './services/internal-contracts/src/index.mjs';
if (typeof getAuditEventSchemaForSubsystem !== 'function') throw new Error('export missing');
console.log('getAuditEventSchemaForSubsystem export OK');
EOF

# 7. Run all workflow and saga tests via root test runner
node --test 'tests/workflows/**/*.test.mjs'
node --test 'tests/saga/**/*.test.mjs'
```

---

## Tasks

Tasks are ordered by dependency. Each task is self-contained and executable by a constrained implement subagent. Tasks within the same group may be parallelized.

---

### GROUP A — Audit Module Core
> No upstream code dependencies. Must be complete before engine integration (GROUP C).

---

#### TASK-001 — Create `workflow-audit.mjs` with all exported functions

**File to create**: `apps/control-plane/src/workflows/workflow-audit.mjs`

**What to implement** (see plan.md §6.1 and §5):

Export the following named async/sync functions:

```js
// Emit a workflow-started record
export async function emitWorkflowStarted(sagaCtx): Promise<{ eventId }>

// Emit a step milestone record (called only when step.auditMilestone === true)
export async function emitStepMilestone(stepDef, stepStatus, sagaCtx, detail?): Promise<{ eventId }>

// Emit a terminal record (completed / compensated / compensation-failed / failed)
export async function emitWorkflowTerminal(sagaCtx, terminalStatus, detail?): Promise<{ eventId }>

// Validate an audit record against the canonical schema fields
export function validateAuditRecord(record): { ok: boolean, violations: string[] }

// Apply default_masked profile to a detail object
export function maskAuditDetail(detail): { masked: object, maskedFieldRefs: string[], sensitivityCategories: string[] }
```

**Record field mapping** (from `sagaCtx` → `observability-audit-event-schema.json` v2026-03-28 fields; see plan.md §5.1):

| Schema field | Source |
|---|---|
| `event_id` | `crypto.randomUUID()` |
| `event_timestamp` | `new Date().toISOString()` |
| `schema_version` | `"2026-03-28"` |
| `actor.actor_id` | `sagaCtx.actorId` |
| `actor.actor_type` | `sagaCtx.actorType` |
| `scope.mode` | `"tenant_workspace"` if `sagaCtx.workspaceId` present, else `"tenant"` |
| `scope.tenant_id` | `sagaCtx.tenantId` |
| `scope.workspace_id` | `sagaCtx.workspaceId` (only when `mode = tenant_workspace`) |
| `resource.subsystem_id` | `"openwhisk"` |
| `resource.resource_type` | `"console_workflow"` |
| `resource.resource_id` | `sagaCtx.sagaId` |
| `resource.parent_resource_id` | `sagaCtx.workflowId` |
| `action.category` | `"console_workflow_execution"` |
| `action.action_id` | `"workflow.started"` / `"workflow.terminal"` / `"step.succeeded"` / `"step.failed"` |
| `result.outcome` | passed-in status string |
| `correlation_id` | `sagaCtx.correlationId` |
| `origin.surface` | `"console_backend"` |
| `detail` | structured metadata object (never includes raw `params`) |
| `maskingApplied` | `true` if any masking applied |
| `maskedFieldRefs` | array of masked field paths |
| `sensitivityCategories` | array of sensitivity categories (may be empty) |

**`maskAuditDetail(detail)`** (plan.md §5.2):
- Input `params` are never included in `detail` (caller responsibility, but assert not present).
- `detail.stepOutput` is excluded by default (strip before masking).
- Any field whose key name matches `/password|secret|token|credential|key/i` has its value replaced with `"[REDACTED]"` and its path recorded in `maskedFieldRefs`.
- Returns `{ masked, maskedFieldRefs, sensitivityCategories }`.
- If no sensitive fields found: `maskedFieldRefs: []`, `maskingApplied: false`.

**`validateAuditRecord(record)`**:
- Required top-level fields: `event_id`, `event_timestamp`, `schema_version`, `actor`, `scope`, `resource`, `action`, `result`, `correlation_id`, `origin`.
- Required nested: `actor.actor_id`, `actor.actor_type`, `scope.tenant_id`, `resource.subsystem_id`, `action.action_id`, `result.outcome`.
- Returns `{ ok: true, violations: [] }` on pass; `{ ok: false, violations: ['<field> missing', ...] }` on failure.

**`emitAuditRecord(record)` (internal, not exported)**:
- Calls `maskAuditDetail` on `record.detail` before emission.
- Calls `validateAuditRecord(record)`; if `ok: false`, logs a structured `warn` (do not throw, do not emit the invalid record).
- Calls `events-admin.mjs` `emitAuditRecord` (or equivalent Kafka publish method). Import from `../events-admin.mjs`.
- Wraps the emit in try/catch; on error, logs `warn` with `{ sagaId: record.resource.resource_id, correlationId: record.correlation_id, error: err.message }` — does NOT rethrow (fire-and-forget with error capture per plan.md §6.1).

**Key invariants** (throw synchronously before any async work):
- If `sagaCtx.correlationId` is absent → throw `{ code: 'AUDIT_MISSING_CORRELATION_ID' }`.
- If `sagaCtx.tenantId` is absent → throw `{ code: 'AUDIT_MISSING_TENANT_ID' }`.

**Acceptance check**: Module loads without error; `emitWorkflowStarted` returns `{ eventId }` for valid `sagaCtx`; `maskAuditDetail({ token: 'abc' })` returns `{ masked: { token: '[REDACTED]' }, maskedFieldRefs: ['token'], ... }`; `validateAuditRecord` with all required fields returns `{ ok: true }`.

---

### GROUP B — Step Definition Annotations
> Depends on: plan.md §4.4 audit milestone classification. Can be developed in parallel with GROUP A. Must be complete before GROUP C.

---

#### TASK-002 — Add `auditMilestone` flags to `saga-definitions.mjs`

**File to modify**: `apps/control-plane/src/saga/saga-definitions.mjs`

**What to add** (plan.md §4.4 and §7.3):

Add an `auditMilestone: boolean` property to every step definition object in `sagaDefinitions`. Default is `false` for steps not listed below.

Set `auditMilestone: true` for the following steps (identified in the catalog as multi-system mutation steps; see plan.md §7.1 `console-workflow-audit-policy.json` `audit_milestone_steps`):

| Workflow | Step keys with `auditMilestone: true` |
|---|---|
| WF-CON-001 | `assign-keycloak-role`, `update-membership-record` |
| WF-CON-002 | `create-tenant-namespace`, `create-tenant-db`, `create-tenant-kafka-topics`, `create-tenant-storage` |
| WF-CON-003 | `create-workspace-namespace`, `create-workspace-db`, `create-workspace-kafka-topics` |
| WF-CON-004 | `create-credential-record`, `bind-credential-to-iam`, `store-credential-pointer` |
| WF-CON-006 | `register-service-account`, `bind-service-account-scopes`, `record-service-account-audit-ref` |

**Note**: The exact step keys must match those already defined in `saga-definitions.mjs` (delivered by T04). If a step key in the table above does not exist in the current definitions, use the nearest equivalent key from the existing definition and add a `// TODO: verify step key matches catalog entry` comment. Do not rename existing step keys.

**No other changes to the file**: do not remove, reorder, or rename any existing step, workflow, or export.

**Acceptance check**: Every step definition in every non-provisional workflow has an `auditMilestone` property of type `boolean`; steps in the milestone table above have `auditMilestone: true`; all other steps have `auditMilestone: false`.

---

### GROUP C — Saga Engine Integration
> Depends on: TASK-001 (workflow-audit.mjs), TASK-002 (auditMilestone flags). Extends the existing T04-delivered saga-engine.mjs.

---

#### TASK-003 — Modify `saga-engine.mjs` to emit audit records and wire TODO(T05) alert

**File to modify**: `apps/control-plane/src/saga/saga-engine.mjs`

**What to implement** (plan.md §6.2):

Make the following targeted changes. Do not restructure any existing logic.

**1. Import `workflow-audit.mjs`** at the top of the file (alongside existing imports):

```js
import { emitWorkflowStarted, emitStepMilestone, emitWorkflowTerminal } from '../workflows/workflow-audit.mjs';
```

**2. After `createSagaInstance()` call** (step 1 of `executeSaga`), add:

```js
await emitWorkflowStarted(sagaCtx);
```

This fires after the saga row is durably inserted and `sagaCtx.correlationId` is populated.

**3. After each `updateStepStatus('succeeded')` call** in the step execution loop, add:

```js
if (stepDef.auditMilestone === true) {
  await emitStepMilestone(stepDef, 'succeeded', sagaCtx, { stepKey: stepDef.key, ordinal: stepDef.ordinal });
}
```

**4. After each `updateStepStatus('failed')` call** in the step execution loop (before entering compensation), add:

```js
if (stepDef.auditMilestone === true) {
  await emitStepMilestone(stepDef, 'failed', sagaCtx, { stepKey: stepDef.key, ordinal: stepDef.ordinal, message: error?.message });
}
```

**5. After each `updateSagaStatus` call** that sets a terminal status (`'completed'`, `'compensated'`, `'compensation-failed'`), add:

```js
await emitWorkflowTerminal(sagaCtx, terminalStatus);
```

where `terminalStatus` is the value being passed to `updateSagaStatus`.

**6. Replace the `// TODO(T05): wire real alert` stub** in the compensation-failed path (inside `emitCompensationFailedAlert` or equivalent function/inline block) with a real `events-admin.mjs` emit:

```js
// Replace the TODO stub comment block with:
await eventsAdmin.emit({
  type: 'saga.compensation-failed',
  sagaId: sagaCtx.sagaId,
  workflowId: sagaCtx.workflowId,
  failedSteps,
  correlationId: sagaCtx.correlationId,
  tenantId: sagaCtx.tenantId
});
```

If `eventsAdmin` is not yet imported, add the import:
```js
import * as eventsAdmin from '../events-admin.mjs';
```

(or use the specific named export pattern that `events-admin.mjs` already uses in the file, if any import already exists).

**7. In `recoverInFlightSagas`**: when a stale saga is marked `compensation-failed` or `compensated`, call `emitWorkflowTerminal(sagaCtx, recoveredStatus)` after `updateSagaStatus`. Guard with: do NOT call `emitWorkflowStarted` again (only the terminal record for recovered sagas). Build a minimal `sagaCtx` from the recovered `saga_instances` row fields.

**Key constraint**: All `await emitWorkflow*` calls are wrapped in try/catch at the engine level as a safety net, logging `warn` on error — emission failures must never interrupt saga execution (plan.md §6.1).

**Acceptance check**: The TODO(T05) comment no longer appears in the file; `emitWorkflowStarted` is called once per `executeSaga` invocation; `emitWorkflowTerminal` is called once at each terminal state transition; `emitStepMilestone` is conditionally called based on `auditMilestone` flag.

---

### GROUP D — Contract Artifact
> No code dependency. Can be created in parallel with GROUP A–C.

---

#### TASK-004 — Create `console-workflow-audit-policy.json` contract artifact

**File to create**: `services/internal-contracts/src/console-workflow-audit-policy.json`

**What to implement** (plan.md §7.1):

Create the JSON file exactly as specified in plan.md §7.1:

```json
{
  "version": "2026-03-29",
  "scope": "US-UIB-01-T05",
  "subsystem_id": "openwhisk",
  "resource_type": "console_workflow",
  "origin_surface": "console_backend",
  "timeline_phase": "console_initiation",
  "guaranteed_records_per_execution": ["workflow.started", "workflow.terminal"],
  "conditional_records_per_execution": ["step.milestone (when auditMilestone=true)"],
  "masking_profile": "default_masked",
  "correlation_id_policy": {
    "passthrough": "preserve caller-provided correlationId",
    "generated": "saga:{workflowId}:{tenantId}:{timestamp_base36}:{random8}",
    "retry_behavior": "correlation_id is immutable for the full execution including retries and compensation"
  },
  "scope_modes": ["tenant", "tenant_workspace"],
  "sensitive_field_handling": "detail block excludes input params; output snapshots excluded by default; known sensitive identifiers replaced with [REDACTED]",
  "audit_milestone_steps": {
    "WF-CON-001": ["assign-keycloak-role", "update-membership-record"],
    "WF-CON-002": ["create-tenant-namespace", "create-tenant-db", "create-tenant-kafka-topics", "create-tenant-storage"],
    "WF-CON-003": ["create-workspace-namespace", "create-workspace-db", "create-workspace-kafka-topics"],
    "WF-CON-004": ["create-credential-record", "bind-credential-to-iam", "store-credential-pointer"],
    "WF-CON-006": ["register-service-account", "bind-service-account-scopes", "record-service-account-audit-ref"]
  }
}
```

**Acceptance check**: File is valid JSON; `JSON.parse(...)` does not throw; all top-level keys from plan.md §7.1 are present; `audit_milestone_steps` matches the `auditMilestone: true` step keys from TASK-002.

---

### GROUP E — Contract Index Update
> Depends on: TASK-004 (console-workflow-audit-policy.json must exist to be exported).

---

#### TASK-005 — Add `getAuditEventSchemaForSubsystem` export to `services/internal-contracts/src/index.mjs`

**File to modify**: `services/internal-contracts/src/index.mjs`

**What to add** (plan.md §6.4):

1. **Export the new policy contract**:
   ```js
   export { default as consoleWorkflowAuditPolicy } from './console-workflow-audit-policy.json' assert { type: 'json' };
   ```

2. **Add `getAuditEventSchemaForSubsystem` helper** if not already exported:
   ```js
   // Read observability-audit-event-schema.json (already in this directory) and
   // return the subsystem configuration block for the given subsystemId.
   // Returns undefined if subsystemId is not found in the schema's subsystem roster.
   export function getAuditEventSchemaForSubsystem(subsystemId) {
     // Import the schema JSON inline (adjust path if the schema file has a different location)
     const schema = auditEventSchema; // assumed already imported as: import auditEventSchema from './observability-audit-event-schema.json' assert { type: 'json' };
     return schema?.subsystems?.[subsystemId] ?? schema?.subsystem_roster?.[subsystemId] ?? undefined;
   }
   ```
   
   - If `observability-audit-event-schema.json` is not yet imported in `index.mjs`, add the import.
   - If the schema JSON does not have a `subsystems` or `subsystem_roster` key, return the schema root itself (since the schema is the authoritative source for all subsystems).
   - Do not modify or remove any existing exports.

**Acceptance check**: `import { getAuditEventSchemaForSubsystem, consoleWorkflowAuditPolicy } from './services/internal-contracts/src/index.mjs'` resolves; `typeof getAuditEventSchemaForSubsystem === 'function'`; `consoleWorkflowAuditPolicy.version === '2026-03-29'`.

---

### GROUP F — Test Suite
> TASK-006 and TASK-007 can be authored in parallel with GROUP A–E; they must pass once implementation is complete. TASK-008 depends on TASK-003 (engine changes).

---

#### TASK-006 — Create unit tests: `tests/workflows/workflow-audit.test.mjs`

**File to create**: `tests/workflows/workflow-audit.test.mjs`

**Test cases to implement** using `node:test`, mocking `events-admin.mjs` as a no-op stub (plan.md §9.1):

| Test case | Assertion |
|---|---|
| `emitWorkflowStarted` with valid `sagaCtx` (correlationId + tenantId set) | Returns `{ eventId }` (UUID); stub shows `events-admin` was called once |
| `emitWorkflowStarted` with missing `correlationId` | Throws `{ code: 'AUDIT_MISSING_CORRELATION_ID' }` |
| `emitWorkflowStarted` with missing `tenantId` | Throws `{ code: 'AUDIT_MISSING_TENANT_ID' }` |
| `emitWorkflowTerminal` with `terminalStatus = 'completed'` | Produced record has `result.outcome === 'completed'` |
| `emitWorkflowTerminal` with `terminalStatus = 'compensation-failed'` | Produced record has `result.outcome === 'compensation-failed'` |
| `emitStepMilestone` with step `{ key: 'assign-keycloak-role', auditMilestone: true }` and `stepStatus='succeeded'` | Emits record with `action.action_id === 'step.succeeded'`; `events-admin` called once |
| `emitStepMilestone` with `stepStatus='failed'` | Emits record with `action.action_id === 'step.failed'` |
| `maskAuditDetail` with `{ token: 'abc123', workflowId: 'WF-CON-001' }` | Returns `masked.token === '[REDACTED]'`; `maskedFieldRefs` contains `'token'`; `workflowId` unchanged |
| `maskAuditDetail` with no sensitive fields | `maskedFieldRefs: []`; `maskingApplied: false` |
| `maskAuditDetail` strips `stepOutput` from detail | `masked.stepOutput` is `undefined` |
| `validateAuditRecord` with all required fields present | `{ ok: true, violations: [] }` |
| `validateAuditRecord` missing `correlation_id` | `ok: false`; `violations` contains a string referencing `correlation_id` |
| `validateAuditRecord` missing `actor.actor_id` | `ok: false` |
| Emit transport error is non-fatal | Stub `events-admin` to throw; `emitWorkflowStarted` does NOT rethrow; returns `{ eventId }` |

**Test infrastructure**: Create a minimal mock for `../events-admin.mjs` using `node:test` mock or an in-file stub object. Capture call count and arguments. No real Kafka connections.

**Acceptance check**: All test cases pass with `node --test tests/workflows/workflow-audit.test.mjs`.

---

#### TASK-007 — Create contract validation tests: `tests/workflows/workflow-audit-schema.test.mjs`

**File to create**: `tests/workflows/workflow-audit-schema.test.mjs`

**Test cases to implement** (plan.md §9.2):

1. **Started record conforms to schema**: Build one sample `workflow.started` record manually (using the field mapping from TASK-001) and validate that all required fields from `observability-audit-event-schema.json` are present and correctly typed.
2. **Step-milestone record conforms to schema**: Build one sample `step.succeeded` record and validate.
3. **Terminal record conforms to schema**: Build one sample `workflow.terminal` record with `result.outcome = 'completed'` and validate.
4. **`console-workflow-audit-policy.json` loads and parses**: Import or `JSON.parse` the file; assert `version`, `scope`, `audit_milestone_steps`, and `masking_profile` keys exist.
5. **Policy `audit_milestone_steps` keys are a subset of `saga-definitions.mjs` step keys**: Import `saga-definitions.mjs` (or a minimal re-export of step keys); for each workflow in `audit_milestone_steps`, assert every listed step key exists in the corresponding workflow's step definitions.
6. **`schema_version` in sample records matches the contract version**: Sample records emitted by `emitWorkflowStarted` (via the real module with a mock transport) carry `schema_version = '2026-03-28'`.

**Acceptance check**: All 6 test cases pass with `node --test tests/workflows/workflow-audit-schema.test.mjs`.

---

#### TASK-008 — Extend saga engine integration tests for audit emission assertions

**File to modify**: `tests/saga/saga-engine.test.mjs`

**What to add** (do not remove or modify any existing test cases; plan.md §9.3):

Add the following new test cases to the existing test file:

1. **`emitWorkflowStarted` called once per `executeSaga`**: Stub `workflow-audit.mjs` exports. Run `executeSaga` for a successful 2-step workflow. Assert `emitWorkflowStarted` was called exactly once. Assert `emitWorkflowTerminal` was called exactly once with status `'completed'`.
2. **`correlationId` is identical in start and terminal records**: Capture the `sagaCtx` argument passed to `emitWorkflowStarted` and `emitWorkflowTerminal`. Assert `sagaCtx.correlationId` is the same non-null string in both calls.
3. **Step failure triggers `emitWorkflowTerminal` with `'compensated'` or `'compensation-failed'`**: Inject a step failure in step 2. Assert `emitWorkflowTerminal` is called with a terminal error status (not `'completed'`).
4. **`emitStepMilestone` called only for `auditMilestone: true` steps**: In a 3-step definition where step 2 has `auditMilestone: true` and steps 1 and 3 have `auditMilestone: false`, assert `emitStepMilestone` is called exactly once (for step 2) after a successful run.
5. **`events-admin.mjs` alert called on `compensation-failed`**: Stub `events-admin.mjs`. Simulate all compensation retries failing. Assert the `emit` call (or equivalent method) was called with `type: 'saga.compensation-failed'` and matching `sagaId`.

**Stubbing approach**: Use `node:test` mock utilities or module-level stubs to replace `workflow-audit.mjs` and `events-admin.mjs` exports; do not modify the production source files.

**Acceptance check**: All new test cases pass; no existing test cases fail.

---

## Criteria of Done

Cross-reference with plan.md §15:

| CD | Criterion | Verifiable Evidence | Covered By |
|----|-----------|---------------------|------------|
| CD-01 | `workflow-audit.mjs` exists and all unit tests pass | `node:test` output: 0 failures | TASK-001, TASK-006 |
| CD-02 | `workflow-audit-schema.test.mjs` passes contract validation for all three record types | `node:test` output: 0 failures | TASK-001, TASK-007 |
| CD-03 | Saga engine integration tests assert `emitWorkflowStarted` and `emitWorkflowTerminal` called once each per execution | `node:test` output | TASK-003, TASK-008 |
| CD-04 | `correlationId` is identical in start and terminal records for a sample execution | Test assertion on stub call args (TASK-008 test 2) | TASK-003, TASK-008 |
| CD-05 | `console-workflow-audit-policy.json` contract artifact is present and parses without error | File exists; `JSON.parse` succeeds | TASK-004 |
| CD-06 | `saga-definitions.mjs` has `auditMilestone` on every step and policy JSON `audit_milestone_steps` matches | Code review + TASK-007 test 5 | TASK-002, TASK-007 |
| CD-07 | TODO(T05) compensation-failed alert stub replaced with real `events-admin.mjs` call | Code review; TASK-008 test 5 covers path | TASK-003, TASK-008 |
| CD-08 | No new test failures in existing saga or workflow test suites | Root `node:test` clean run | TASK-003, TASK-008 |
| CD-09 | Audit records contain no raw secrets, tokens, or credentials | `maskAuditDetail` unit tests pass; TASK-006 masking tests | TASK-001, TASK-006 |
| CD-10 | All changes committed on branch `071-backend-audit-correlation` with conventional-commit message | `git log` | — |

---

## Implementation Order (Recommended)

```
TASK-004   (console-workflow-audit-policy.json)  ← no deps; create early as reference
TASK-001   (workflow-audit.mjs)                  ← no code deps; needs schema contract as reference
TASK-002   (saga-definitions.mjs auditMilestone) ← no new code deps; extend T04 output
  ↓
TASK-003   (saga-engine.mjs modifications)       ← needs TASK-001 and TASK-002
  ↓
TASK-005   (internal-contracts/index.mjs)        ← needs TASK-004
TASK-006   (workflow-audit.test.mjs)             ← needs TASK-001; can be authored earlier, must pass after
TASK-007   (workflow-audit-schema.test.mjs)      ← needs TASK-001, TASK-002, TASK-004
TASK-008   (saga-engine.test.mjs extensions)     ← needs TASK-003
```

Parallel opportunities:
- TASK-004 and TASK-001 may be started simultaneously (plan.md is the shared reference).
- TASK-002 may be started simultaneously with TASK-001.
- TASK-006 and TASK-007 may be drafted before TASK-001 is finalized (TDD approach), but must pass once TASK-001 is complete.

---

*Tasks file: `specs/071-backend-audit-correlation/tasks.md`*

## ADDED Requirements

### Requirement: DSL interpreter workflow definition
The system SHALL provide a single generic Temporal workflow, `DslInterpreterWorkflow`, that accepts a fully-resolved flow definition as input and executes it to completion without requiring a workflow type registration per flow definition version.

#### Scenario: Workflow executes a named flow definition
- **WHEN** a caller starts `DslInterpreterWorkflow` with a valid flow definition payload
- **THEN** the workflow engine begins executing the root sequence node of the definition without error

#### Scenario: Workflow input carries the definition inline
- **WHEN** the `DslInterpreterWorkflow` input contains the flow definition directly (inline strategy per ADR #356)
- **THEN** the workflow executes without scheduling an additional load-definition activity

#### Scenario: Workflow loads definition via activity when only flowId and version are supplied
- **WHEN** the `DslInterpreterWorkflow` input contains only a `flowId` and `version` reference
- **THEN** the workflow schedules a `loadFlowDefinition` activity, the result is recorded in Temporal history, and execution proceeds with the resolved definition

---

### Requirement: Execution version pinning
The system SHALL pin the flow definition version to the value resolved at workflow start so that publishing a new version of the same flow never alters the semantics of any in-flight execution.

#### Scenario: New version published while v1 execution is in-flight
- **WHEN** a `DslInterpreterWorkflow` instance is executing version 1 of a flow definition
- **AND** version 2 of the same flow is published
- **THEN** the in-flight instance continues executing version 1 semantics until it completes or is cancelled

---

### Requirement: Sequence node execution
The system SHALL execute nodes listed under a `sequence` node by awaiting each activity or sub-graph in declaration order, advancing only after the preceding step has completed or the workflow is cancelled.

#### Scenario: Sequential steps complete in order
- **WHEN** a flow definition contains a sequence of two task nodes A and B
- **THEN** task A activity completes before task B activity is scheduled

---

### Requirement: Parallel node execution
The system SHALL execute nodes listed under a `parallel` node by scheduling all branches as concurrent activity futures and awaiting all branches before advancing.

#### Scenario: Parallel branches run concurrently
- **WHEN** a flow definition contains a parallel node with branches X and Y
- **THEN** both branch activities are scheduled before either completes
- **AND** execution advances only after both branches have finished

---

### Requirement: Task node activity dispatch
The system SHALL execute a `task` node by invoking the corresponding registered activity and applying the per-task `RetryPolicy` from the DSL definition verbatim to the activity options.

#### Scenario: Task with custom retry policy
- **WHEN** a task node specifies `maxAttempts: 3` and `initialInterval: 2s`
- **THEN** the activity is scheduled with a `RetryPolicy` of `maximumAttempts: 3` and `initialInterval: 2s`
- **AND** no other retry defaults override those values

#### Scenario: Task with no retry policy
- **WHEN** a task node specifies no retry policy
- **THEN** the activity is scheduled with the Temporal SDK default retry policy

---

### Requirement: Wait (durable timer) node execution
The system SHALL execute a `wait` node by scheduling a durable Temporal `sleep` timer for the duration specified in the DSL, surviving worker restarts without data loss.

#### Scenario: Worker killed during wait timer
- **WHEN** a `DslInterpreterWorkflow` is suspended on a `wait` node timer
- **AND** the worker pod is terminated and restarted
- **THEN** the workflow resumes on the new worker, the timer fires at the originally scheduled wall-clock time, and execution continues to the next node

---

### Requirement: Human-approval signal node execution
The system SHALL execute an `approval` node by blocking via `setHandler` on a named signal channel and advancing when the signal is received; an optional timeout branch SHALL be taken if the timeout elapses before the signal arrives.

#### Scenario: Approval signal received before timeout
- **WHEN** a workflow is waiting on an `approval` node with a 24-hour timeout
- **AND** an external actor sends the approval signal within the window
- **THEN** the workflow advances on the approved path and the timeout timer is cancelled

#### Scenario: Approval timeout elapses without signal
- **WHEN** a workflow is waiting on an `approval` node with a 1-hour timeout
- **AND** no signal arrives before the timeout
- **THEN** the workflow advances on the timeout/rejection path

---

### Requirement: Sub-flow child workflow execution
The system SHALL execute a `subFlow` node by starting a child `DslInterpreterWorkflow` with the referenced flow definition and awaiting its completion, propagating cancellation to the child if the parent is cancelled.

#### Scenario: Parent cancelled while child sub-flow is running
- **WHEN** a parent `DslInterpreterWorkflow` is cancelled while a child sub-flow workflow is in progress
- **THEN** the cancellation is propagated to the child workflow via the Temporal `CancellationScope`
- **AND** both parent and child workflows terminate in a cancelled state

---

### Requirement: Branch node deterministic expression evaluation
The system SHALL evaluate branch conditions and data-mapping expressions using only the sandboxed deterministic engine selected per ADR #356 (CEL or JSONata), never via arbitrary JavaScript `eval` or `Function` constructor inside workflow code.

#### Scenario: Branch condition evaluated without arbitrary code execution
- **WHEN** a `branch` node condition expression is evaluated during workflow execution
- **THEN** the evaluation is performed by the sandboxed expression engine
- **AND** no non-deterministic host API (random, date, network) is invoked inside workflow code during the evaluation

#### Scenario: Invalid expression fails the workflow task with a non-retryable error
- **WHEN** a branch condition expression is syntactically invalid
- **THEN** the workflow task fails with a non-retryable application error identifying the offending node ID

---

### Requirement: Stable node-ID activity naming convention
The system SHALL encode the DSL node ID in every activity invocation such that each Temporal history event for an activity can be unambiguously mapped back to the originating DSL node; this encoding SHALL be the normative contract for monitoring (#366).

#### Scenario: History event maps back to DSL node ID
- **WHEN** a completed workflow history is exported
- **THEN** every `ActivityTaskScheduled` event contains the DSL node ID of the originating task node in its headers or `activityId` field
- **AND** a test that maps the exported history back to DSL node IDs finds no unmapped events

---

### Requirement: Workflow determinism — no non-deterministic API usage
The system SHALL ensure all workflow code (everything inside `DslInterpreterWorkflow` and any sub-workflow helpers) uses only Temporal SDK deterministic constructs; the SDK replayer SHALL pass on recorded production histories without non-determinism errors.

#### Scenario: Replayer passes on recorded history
- **WHEN** a Temporal SDK `WorkflowReplayer` is run against a recorded execution history for a completed `DslInterpreterWorkflow` instance
- **THEN** the replay completes without a `DeterminismViolationError`

---

### Requirement: Worker deployment — Dockerfile and runtime
The system SHALL build the workflow worker from a `services/workflow-worker/Dockerfile` using the `node:22-alpine` base image, running as the non-root `node` user, built from the repository root context consistent with `apps/control-plane/Dockerfile`.

#### Scenario: Container starts as non-root user
- **WHEN** the workflow worker container image is started
- **THEN** the process runs as UID corresponding to the `node` user in the `node:22-alpine` image
- **AND** the process does not have `root` privileges

---

### Requirement: Worker deployment — Helm component-wrapper wiring
The system SHALL wire the workflow worker as a `component-wrapper` dependency in `charts/in-falcone/Chart.yaml` under the alias `workflowWorker`, guarded by the `workflowWorker.enabled` condition, with a corresponding stanza in `values.yaml` and an extended `values.schema.json` referencing the existing `#/definitions/component` definition.

#### Scenario: Worker disabled by default
- **WHEN** `values.yaml` is applied without overrides
- **THEN** `workflowWorker.enabled` is `false` and no workflow worker Deployment is created

#### Scenario: Worker enabled in overlay
- **WHEN** an overlay sets `workflowWorker.enabled: true` with a valid image reference
- **THEN** the umbrella chart renders a workflow worker Deployment with the configured image

---

### Requirement: Worker graceful shutdown and probe configuration
The system SHALL configure liveness and readiness probes on the workflow worker Deployment and handle `SIGTERM` by allowing in-flight activity polls to drain before the process exits, consistent with health probe patterns in `charts/in-falcone/values.yaml`.

#### Scenario: Worker pod receives SIGTERM during idle poll
- **WHEN** Kubernetes sends `SIGTERM` to the workflow worker pod
- **THEN** the worker stops accepting new tasks, drains the current poll, and exits with code 0 within the configured `terminationGracePeriodSeconds`

---

### Requirement: Durable resume after worker kill
The system SHALL resume a workflow execution on a replacement worker after the original worker pod is killed mid-execution, with no loss of completed activity results stored in Temporal history.

#### Scenario: Worker pod killed mid-sequence execution
- **WHEN** a `DslInterpreterWorkflow` has completed the first task in a two-task sequence
- **AND** the worker pod is killed before the second task begins
- **THEN** a replacement worker picks up the workflow, replays history to reconstruct state, and executes the second task exactly once
- **AND** the first task is NOT re-executed

---

### Requirement: Task-queue and namespace binding per tenancy ADR
The system SHALL bind the worker to the Temporal task queue and namespace configuration resolved per the tenancy decision in ADR #356, reading queue name and namespace from environment variables at startup.

#### Scenario: Worker binds to configured task queue
- **WHEN** the worker starts with `TEMPORAL_TASK_QUEUE=flows-main` and `TEMPORAL_NAMESPACE=default`
- **THEN** the Temporal worker registers `DslInterpreterWorkflow` on task queue `flows-main` in namespace `default`

---

### Requirement: Real-stack Temporal service in test environment
The system SHALL add a `temporal` service (Temporal dev-server image) to `tests/env/docker-compose.yml` so that workflow worker real-stack tests can connect to a local Temporal server without Kubernetes.

#### Scenario: Tests/env stack includes Temporal
- **WHEN** `tests/env/up.sh` completes successfully
- **THEN** a Temporal server is reachable on its configured port and the workflow worker can register workflows against it

#### Scenario: TypeScript convention deviation documented
- **WHEN** a developer inspects `services/workflow-worker/package.json`
- **THEN** the package does NOT declare `"type": "module"` and its comments or a co-located note explain that the Temporal SDK's deterministic bundler requires the TypeScript/CommonJS compilation path rather than the repo-standard `.mjs` ESM convention

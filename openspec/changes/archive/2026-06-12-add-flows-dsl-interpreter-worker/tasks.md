## 1. Test environment — Temporal dev-server

- [x] 1.1 Add `temporal` service (temporalio/auto-setup dev image) to `tests/env/docker-compose.yml` with gRPC frontend on port 7233 and ephemeral storage (no persistent volume)
- [x] 1.2 Update `tests/env/up.sh` to health-gate on the Temporal frontend gRPC port before declaring the stack ready
- [x] 1.3 Verify `tests/env/down.sh` tears down the `temporal` container cleanly

## 2. Service scaffold

- [x] 2.1 Create `services/workflow-worker/` directory with `package.json` (TypeScript, no `"type":"module"`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity` dependencies; pin SDK version)
- [x] 2.2 Add `tsconfig.json` targeting CommonJS output to a `dist/` directory
- [x] 2.3 Add `services/workflow-worker/src/worker.ts` — entry point that reads `TEMPORAL_TASK_QUEUE` and `TEMPORAL_NAMESPACE` env vars, registers `DslInterpreterWorkflow`, and starts the Temporal Worker
- [x] 2.4 Add `services/workflow-worker/src/workflows/DslInterpreterWorkflow.ts` — generic interpreter workflow (full implementation, not a throwing stub — see Deviations)
- [x] 2.5 Add `services/workflow-worker/src/activities/` directory with a stub `loadFlowDefinition` activity (returns a fixed test definition; real impl is #360)

## 3. DSL interpreter — core execution mapping

- [x] 3.1 Implement `sequence` node handler: iterate child nodes and await each in order
- [x] 3.2 Implement `parallel` node handler: `Promise.all` over child branch futures
- [x] 3.3 Implement `task` node handler: `executeActivity` with `activityId: node.id` and per-task `RetryPolicy` from DSL applied verbatim to activity options (covers spec: Task node activity dispatch + Stable node-ID naming)
- [x] 3.4 Implement `wait` node handler: `workflow.sleep(duration)` using the DSL-specified duration
- [x] 3.5 Implement `approval` node handler: `setHandler` on signal channel; race `sleep(timeout)` against signal receipt; advance on approved or timeout branch per spec
- [x] 3.6 Implement `subFlow` node handler: `executeChild(DslInterpreterWorkflow, childInput)` inside a `CancellationScope`; propagate parent cancellation to child
- [x] 3.7 Implement `branch` node handler: delegate condition evaluation to the `evaluateExpression` activity (not inline in workflow code); route to the matching branch
- [x] 3.8 Add `evaluateExpression` activity stub (cel-js evaluation outside the sandbox per ADR-11/cel; non-retryable failure on invalid expression)

## 4. Inline vs. load-by-reference input dispatch

- [x] 4.1 Define the `WorkflowInput` TypeScript type: discriminated union of `{ definition: FlowDefinition }` (inline) and `{ flowId: string; version: string }` (load-by-reference)
- [x] 4.2 In `DslInterpreterWorkflow`: if input is load-by-reference, schedule `loadFlowDefinition` activity and use the result; if inline, use the definition directly (covers spec: Workflow input dispatch)
- [x] 4.3 Add a payload-size guard that returns a non-retryable `ApplicationFailure` if an inline definition exceeds 3 MB

## 5. Version pinning

- [x] 5.1 Store the resolved flow definition (with its version string) in a local workflow variable at workflow start so that any subsequent re-evaluation of the definition always uses the pinned copy
- [x] 5.2 Write a version-pinning test that asserts a second version published after workflow start does not change the in-flight execution's definition reference (see Deviations: implemented as a real-stack test, the higher-fidelity placement for a workflow-level property)

## 6. Determinism and replay tests

- [x] 6.1 Record a workflow execution history against the real Temporal dev-server (the replay tests start each fixture flow, then fetch its proto history)
- [x] 6.2 Write a replayer test using `WorkflowReplayer` (`Worker.runReplayHistory`) that loads the recorded history and asserts no `DeterminismViolationError` — for every runnable fixture flow + the human-approval signal flow
- [x] 6.3 Audit `DslInterpreterWorkflow` and all helper functions in the workflow bundle for non-deterministic API usage (`Date.now`, `Math.random`, direct `fetch`/`http`); guarded by bbx-flows-interp-005 (static guard) + the replay tests (runtime guard)

## 7. Node-ID naming convention test

- [x] 7.1 Write a test that executes a sequence flow against the real Temporal dev-server, exports the resulting history, and asserts every `ActivityTaskScheduled` event has an `activityId` matching a node ID from the originating flow definition

## 8. Real-stack durability and version-pinning tests

- [x] 8.1 Write a worker-kill test: start a two-task sequence flow; after the first task completes, terminate the worker process; start a new worker; assert the second task executes exactly once and the workflow completes successfully
- [x] 8.2 Write a version-pinning test: start a flow execution with definition v1; register v2 during the in-flight execution (different node graph); assert the in-flight execution completes on v1 semantics

## 9. Dockerfile

- [x] 9.1 Create `services/workflow-worker/Dockerfile` using `node:22-alpine` as the base image, built from the repo root context (`docker build -f services/workflow-worker/Dockerfile .`), running `npm run build` (tsc compile), setting `USER node`, and using `CMD ["node", "dist/worker.js"]`
- [x] 9.2 Verify the built image starts as non-root — asserted by bbx-flows-interp-007 (Dockerfile `USER node`); a live `docker run whoami` is not run in CI (no image build in the unit/blackbox lanes)

## 10. Helm wiring

- [x] 10.1 Add `workflowWorker` component-wrapper dependency to `charts/in-falcone/Chart.yaml` (`alias: workflowWorker`, `condition: workflowWorker.enabled`, `file://./charts/component-wrapper`)
- [x] 10.2 Add `workflowWorker` stanza to `charts/in-falcone/values.yaml` with `enabled: false`, `wrapper.componentId: workflow-worker`, `wrapper.workload.kind: Deployment`, placeholder image, `replicas: 2`, ClusterIP service on port 8080, the `app.kubernetes.io/component: flows-worker` podLabel (NetworkPolicy contract), probes, and graceful shutdown
- [x] 10.3 Add `"workflowWorker": { "$ref": "#/definitions/component" }` to `charts/in-falcone/values.schema.json` properties
- [x] 10.4 Run `helm template . --set workflowWorker.enabled=true` from `charts/in-falcone/` and assert no render errors (covered by bbx-flows-interp-008..011 + helm lint)

## 11. Validation and CI smoke

- [x] 11.1 Run `openspec validate add-flows-dsl-interpreter-worker --strict` and fix any errors
- [x] 11.2 Run `tests/env/up.sh` Temporal services with the extended compose file and confirm `temporal` reaches healthy state (via `tests/env/workflow-worker/run.sh`)
- [x] 11.3 Run the workflow-worker real-stack suite (`bash tests/env/workflow-worker/run.sh`) against the `tests/env/` Temporal stack — all 10 tests green

## Deviations (recorded per the change process)

- **Probes in the component-wrapper subchart**: the shared `charts/component-wrapper`
  workload template did not render `livenessProbe`/`readinessProbe`/`startupProbe` or
  `terminationGracePeriodSeconds`. They were added ADDITIVELY (gated by `with`, so sibling
  components that do not set them are unaffected) so the worker Deployment can satisfy the
  spec's probe + graceful-shutdown requirement. The worker exposes an HTTP health server
  (`/livez`, `/readyz`) for the probes; it serves probes only (no business traffic).
- **`app.kubernetes.io/component: flows-worker` label** is injected via `podLabels` (which
  the workload template already renders) rather than by changing the shared label helpers,
  keeping the change scoped to the worker stanza while satisfying the Temporal NetworkPolicy
  label contract.
- **Component-alias registry updated**: adding the `workflowWorker` alias required syncing
  the three places that enumerate the chart component aliases (`scripts/lib/deployment-chart.mjs`,
  `scripts/lib/deployment-topology.mjs`, and the `packaging_guidance.component_aliases` list
  in `services/internal-contracts/src/deployment-topology.json`) plus the contract test
  `tests/contracts/deployment-topology.contract.test.mjs`. Without this the chart-consistency
  unit/contract validators (CI `quality`) fail.
- **ISO-8601 duration conversion (bug surfaced by the real-stack slice)**: the DSL expresses
  durations as ISO-8601 (`PT2S`, `P2D`; FLW-E008), but the Temporal SDK's `Duration` /
  `compileRetryPolicy` REJECT ISO-8601 strings (`TypeError: Invalid duration string: 'PT2S'`).
  An `isoDurationToMs` converter (pure/deterministic) normalises every DSL duration
  (`wait.duration`, `approval.timeout`, retry `initialInterval`/`maximumInterval`, activity
  timeouts) to milliseconds before it reaches the SDK. Caught by the real-stack retry test,
  not the in-memory mapping unit tests — added `flw-unit-dur-01..03` to lock it.
- **Task 2.4 is a full implementation, not a throwing stub**: the change ships the complete
  interpreter (all node types) because the real-stack durability/replay/version-pinning proofs
  require a working interpreter. Activity bodies remain stubs (the #360 catalog seam).
- **Task 5.2 / 9.2 placement**: version pinning is a workflow-level property, so it is proven
  in the real-stack suite (`tests/env/workflow-worker/version-pinning.test.mjs`) rather than
  with `MockActivityEnvironment` (which isolates a single activity and cannot observe the
  workflow's pinned definition). Non-root container start is asserted statically from the
  Dockerfile (bbx-flows-interp-007); the unit/blackbox lanes do not build the image.

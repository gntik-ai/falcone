## 1. Test environment — Temporal dev-server

- [ ] 1.1 Add `temporal` service (temporalio/auto-setup dev image) to `tests/env/docker-compose.yml` with gRPC frontend on port 7233 and ephemeral storage (no persistent volume)
- [ ] 1.2 Update `tests/env/up.sh` to health-gate on the Temporal frontend gRPC port before declaring the stack ready
- [ ] 1.3 Verify `tests/env/down.sh` tears down the `temporal` container cleanly

## 2. Service scaffold

- [ ] 2.1 Create `services/workflow-worker/` directory with `package.json` (TypeScript, no `"type":"module"`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity` dependencies; pin SDK version)
- [ ] 2.2 Add `tsconfig.json` targeting CommonJS output to a `dist/` directory
- [ ] 2.3 Add `services/workflow-worker/src/worker.ts` — entry point that reads `TEMPORAL_TASK_QUEUE` and `TEMPORAL_NAMESPACE` env vars, registers `DslInterpreterWorkflow`, and starts the Temporal Worker
- [ ] 2.4 Add `services/workflow-worker/src/workflows/DslInterpreterWorkflow.ts` — skeleton workflow function (stub that throws `ApplicationFailure.nonRetryable('not implemented')`)
- [ ] 2.5 Add `services/workflow-worker/src/activities/` directory with a stub `loadFlowDefinition` activity (returns a fixed test definition; real impl is #360)

## 3. DSL interpreter — core execution mapping

- [ ] 3.1 Implement `sequence` node handler: iterate child nodes and await each in order
- [ ] 3.2 Implement `parallel` node handler: `Promise.all` over child branch futures
- [ ] 3.3 Implement `task` node handler: `executeActivity` with `activityId: node.id` and per-task `RetryPolicy` from DSL applied verbatim to activity options (covers spec: Task node activity dispatch + Stable node-ID naming)
- [ ] 3.4 Implement `wait` node handler: `workflow.sleep(duration)` using the DSL-specified duration
- [ ] 3.5 Implement `approval` node handler: `setHandler` on signal channel; race `sleep(timeout)` against signal receipt; advance on approved or timeout branch per spec
- [ ] 3.6 Implement `subFlow` node handler: `executeChild(DslInterpreterWorkflow, childInput)` inside a `CancellationScope`; propagate parent cancellation to child
- [ ] 3.7 Implement `branch` node handler: delegate condition evaluation to the `evaluateExpression` activity (not inline in workflow code); route to the matching branch
- [ ] 3.8 Add `evaluateExpression` activity stub (returns `true`; real impl deferred to expression engine selection per ADR #356)

## 4. Inline vs. load-by-reference input dispatch

- [ ] 4.1 Define the `WorkflowInput` TypeScript type: discriminated union of `{ definition: FlowDefinition }` (inline) and `{ flowId: string; version: string }` (load-by-reference)
- [ ] 4.2 In `DslInterpreterWorkflow`: if input is load-by-reference, schedule `loadFlowDefinition` activity and use the result; if inline, use the definition directly (covers spec: Workflow input dispatch)
- [ ] 4.3 Add a payload-size guard that returns a non-retryable `ApplicationFailure` if an inline definition exceeds 3 MB

## 5. Version pinning

- [ ] 5.1 Store the resolved flow definition (with its version string) in a local workflow variable at workflow start so that any subsequent re-evaluation of the definition always uses the pinned copy
- [ ] 5.2 Write a unit test (SDK `MockActivityEnvironment`) that asserts a second version published after workflow start does not change the in-flight execution's definition reference

## 6. Determinism and replay tests

- [ ] 6.1 Record a workflow execution history against the real Temporal dev-server (run `workflow execute` via Temporal CLI, save JSON history)
- [ ] 6.2 Write a replayer test using `WorkflowReplayer` that loads the recorded history and asserts no `DeterminismViolationError`
- [ ] 6.3 Audit `DslInterpreterWorkflow` and all helper functions in the workflow bundle for non-deterministic API usage (`Date.now`, `Math.random`, direct `fetch`/`http`); fix any violations found

## 7. Node-ID naming convention test

- [ ] 7.1 Write a test that executes a simple two-task sequence flow against the real Temporal dev-server, exports the resulting history, and asserts every `ActivityTaskScheduled` event has an `activityId` matching a node ID from the originating flow definition

## 8. Real-stack durability and version-pinning tests

- [ ] 8.1 Write a worker-kill test: start a two-task sequence flow; after the first task completes, terminate the worker process; start a new worker; assert the second task executes exactly once and the workflow completes successfully
- [ ] 8.2 Write a version-pinning test: start a flow execution with definition v1; register v2 during the in-flight execution (different node graph); assert the in-flight execution completes on v1 semantics

## 9. Dockerfile

- [ ] 9.1 Create `services/workflow-worker/Dockerfile` using `node:22-alpine` as the base image, built from the repo root context (`docker build -f services/workflow-worker/Dockerfile .`), running `npm run build` (tsc compile), setting `USER node`, and using `CMD ["node", "dist/worker.js"]`
- [ ] 9.2 Verify the built image starts as non-root (`docker run --rm <image> whoami` returns `node`)

## 10. Helm wiring

- [ ] 10.1 Add `workflowWorker` component-wrapper dependency to `charts/in-falcone/Chart.yaml` (`alias: workflowWorker`, `condition: workflowWorker.enabled`, `file://./charts/component-wrapper`)
- [ ] 10.2 Add `workflowWorker` stanza to `charts/in-falcone/values.yaml` with `enabled: false`, `wrapper.componentId: workflow-worker`, `wrapper.workload.kind: Deployment`, placeholder image, `replicas: 2`, and ClusterIP service on port 8080
- [ ] 10.3 Add `"workflowWorker": { "$ref": "#/definitions/component" }` to `charts/in-falcone/values.schema.json` properties
- [ ] 10.4 Run `helm template . --set workflowWorker.enabled=true` from `charts/in-falcone/` and assert no render errors

## 11. Validation and CI smoke

- [ ] 11.1 Run `openspec validate add-flows-dsl-interpreter-worker --strict` and fix any errors
- [ ] 11.2 Run `tests/env/up.sh` with the extended compose file and confirm all services (including `temporal`) reach healthy state
- [ ] 11.3 Run the full workflow-worker test suite (`npm test` in `services/workflow-worker/`) against the `tests/env/` stack

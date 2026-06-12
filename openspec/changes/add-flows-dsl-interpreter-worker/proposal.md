## Why

The platform has no runtime execution engine for user-defined workflows: the Temporal-based workflow engine epic (#355) validated the interpreter pattern (#356) and established the DSL schema (#357, #358), but no production worker exists that can actually run a flow definition. Without the generic `DslInterpreterWorkflow` and the worker deployment that hosts it, the activity catalog (#360), API (#361), triggers (#365), and monitoring (#366) have nothing to build on.

## What Changes

- New `services/workflow-worker/` TypeScript service (Temporal TypeScript SDK; deviation from the repo-wide `"type":"module"` / `.mjs` convention because workflow code requires the SDK's deterministic bundler — deviation documented in the package README).
- `DslInterpreterWorkflow` Temporal workflow definition: receives a parsed flow definition (strategy per #356 ADR — workflow input by default, or load-by-`flowId`+`version` via a recorded activity), version-pinned per execution so publishing v2 never affects in-flight v1 runs.
- Full DSL-to-Temporal execution mapping: sequence → sequential awaits; parallel → `Promise.all` activity futures; task → activity invocation with per-task `RetryPolicy` from the DSL applied verbatim; wait → durable `sleep` timer; human-approval → `setHandler` signal with optional timeout branch; sub-flow → child workflow; cancellation propagated via `CancellationScope`.
- Sandboxed deterministic expression evaluation (CEL or JSONata, per #356 ADR choice) for branch/condition and data-mapping expressions — no arbitrary code execution inside workflow code.
- Stable node-ID activity naming convention: activity type encodes the DSL node ID in headers/identifiers so every history event maps back to a canvas node — normative contract for #366 monitoring.
- Dockerfile (`node:22-alpine`, build from repo root, `USER node`) consistent with `apps/control-plane/Dockerfile` conventions.
- Helm wiring: new `workflowWorker` component-wrapper entry in `charts/in-falcone/Chart.yaml` behind `workflowWorker.enabled`; `values.schema.json` extended with the `workflowWorker` component definition.
- `tests/env/docker-compose.yml` extended with a local Temporal server service (Temporal dev-server image) for real-stack tests.
- SDK replayer tests on recorded histories asserting no non-deterministic API usage.
- Worker-kill durability test and version-pinning test in `tests/env/` real-stack suite.

## Capabilities

### New Capabilities

- `workflows`: covers the runtime interpreter and worker — the `DslInterpreterWorkflow` definition, all DSL node execution semantics, determinism guarantees, the node-ID naming convention, durable resume on worker kill, version pinning, and the worker Deployment with Helm wiring.

### Modified Capabilities

*(none — this change introduces a wholly new capability)*

## Impact

- **New service**: `services/workflow-worker/` (TypeScript, Temporal SDK; compiled before container build).
- **Helm chart**: `charts/in-falcone/Chart.yaml` gains a `workflowWorker` dependency entry; `charts/in-falcone/values.yaml` gains a `workflowWorker` stanza; `charts/in-falcone/values.schema.json` gains a `workflowWorker` property referencing the existing `#/definitions/component` definition.
- **Test environment**: `tests/env/docker-compose.yml` gains a `temporal` service (Temporal dev-server); `tests/env/up.sh` / `tests/env/down.sh` gain a corresponding health-gate and teardown step.
- **Downstream blockers resolved**: #360 (activity catalog), #365 (triggers), #366 (monitoring) all depend on the stable node-ID naming convention and worker being available.
- **No breaking changes** to existing capabilities.

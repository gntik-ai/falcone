## Context

The Temporal workflow engine epic (#355) has produced:
- An interpreter pattern ADR (#356) choosing `DslInterpreterWorkflow` as a single generic workflow type (not code-generated per-definition).
- A DSL schema (#357) and an execution-semantics table (#358) mapping each DSL node type to a Temporal primitive.
- A pgvector/provisioning-preflight precedent (#352, commit `2df2c43`) showing the pattern for adding a new worker service: `services/<service>/` directory, build from repo root, `node:22-alpine` + `USER node` Dockerfile, component-wrapper Helm entry.

Current gap: no `services/workflow-worker/` exists; the Temporal SDK is not in any package.json; `workflowWorker` is absent from `charts/in-falcone/`; `tests/env/docker-compose.yml` has no Temporal dev-server.

Code evidence: `apps/control-plane/Dockerfile` (node:22-alpine base, USER node, build from repo root), `charts/in-falcone/Chart.yaml` (component-wrapper aliasing pattern with `condition: <alias>.enabled`), `charts/in-falcone/values.schema.json` (`#/definitions/component` reused by every component entry), `services/realtime-gateway/package.json` (`"type":"module"`, Node >= 20, no TypeScript).

## Goals / Non-Goals

**Goals:**
- Deliver a production-ready `DslInterpreterWorkflow` that can execute all DSL node types from #358.
- Establish and test the stable node-ID activity naming convention that #366 monitoring depends on.
- Prove durable resume under worker kill and version-pinning under concurrent version publish.
- Wire the worker into the umbrella chart and the real-stack test environment.
- Deviate from the `.mjs` ESM convention exactly where the Temporal SDK requires it, and document the deviation so future contributors understand it.

**Non-Goals:**
- Activity implementations (owned by #360).
- API endpoints or triggers (#361, #365).
- Temporal server Helm chart for production (owned by a sibling change in the epic).
- Multi-namespace / multi-tenant Temporal topology (the tenancy ADR #356 decision is consumed as an input; this change implements what the ADR prescribes).

## Decisions

### D1 — TypeScript over ESM `.mjs`

**Decision**: `services/workflow-worker/` is a TypeScript project compiled with `tsc` (or the Temporal bundler) to CommonJS output, not a plain `.mjs` ESM service like `services/scheduling-engine/` or `services/realtime-gateway/`.

**Rationale**: The Temporal TypeScript SDK's `@temporalio/worker` package requires workflow code to be processed by the SDK's deterministic bundler (`bundleWorkflowCode`), which runs Webpack under the hood and cannot accept native ESM `import.meta` or top-level-`await` constructs in workflow files. The determinism sandbox intercepts Node built-ins at the module level; this interception is incompatible with Node's native ESM loader. This is a hard constraint from the SDK, not a preference.

**Alternative considered**: Compile `.ts` to ESM `.mjs` (`"module": "ESNext"` in tsconfig). Rejected: `@temporalio/worker` bundler fails on ESM workflow files; the Temporal community docs confirm CJS output as the supported path (code evidence: no `"type":"module"` in any Temporal SDK `package.json` peer).

**Deviation documentation**: `services/workflow-worker/package.json` must NOT contain `"type":"module"` and must include a `// NOTE` comment (or a short `WORKFLOW_WORKER_NOTES` section) explaining the CJS requirement.

### D2 — Inline definition strategy as the default input

**Decision**: `DslInterpreterWorkflow` accepts the full flow definition inline in the workflow input by default. Load-by-`flowId`+`version` via a recorded activity is supported as an alternative input shape (discriminated by the presence of a `flowId` field vs. a `definition` field).

**Rationale**: Recording the load-activity in Temporal history is necessary for replay determinism when definitions are fetched from a store. Inline input removes the network round-trip for the common hot path (API-driven execution) and keeps the history self-contained for debugging.

**Risk**: Large flow definitions inflate the workflow input payload. Temporal's default payload size limit is 4 MB; any definition exceeding that must use the load-by-reference path. Mitigation: the workflow input schema validator rejects inline definitions larger than a configured threshold and returns a structured error before scheduling the workflow.

### D3 — Node-ID encoding in `activityId`

**Decision**: The `activityId` passed to every `executeActivity` call SHALL be the DSL node ID (string), optionally suffixed with a loop counter for iterated nodes. This is the normative contract for #366 monitoring.

**Rationale**: `activityId` is surfaced in `ActivityTaskScheduled` history events, is already indexed by Temporal Web UI, and does not require custom header parsing. Alternative: encode the node ID in a `SearchAttribute` or memo — rejected as more complex and not queryable in the OSS Temporal edition without additional indexer config. Encoding in a custom payload header was also considered but requires #366 to implement a custom header reader.

**Contract**: Every `executeActivity` call in `DslInterpreterWorkflow` must pass `{ activityId: node.id }` in options. A test asserts that every `ActivityTaskScheduled` event in a recorded history has an `activityId` that matches a node in the originating flow definition.

### D4 — Sandboxed expression evaluation

**Decision**: Branch conditions and data-mapping expressions are evaluated using the sandboxed engine resolved from ADR #356 (CEL via `cel-js` or JSONata via `jsonata`). The evaluation helper is imported as a plain activity (not inline in workflow code) so the expression engine's non-deterministic internals (timestamp, random) are isolated from the workflow sandbox.

**Rationale**: Running any third-party expression library inside the Temporal workflow sandbox risks non-determinism violations if the library touches `Date.now()`, `Math.random()`, or I/O. Delegating evaluation to an activity is the Temporal-recommended pattern for any non-deterministic side effect.

**Alternative considered**: Run CEL/JSONata inside the workflow using the SDK's `vm` context injection. Rejected: the SDK's `defaultSinks` do not expose `vm.Script`; injecting the engine requires forking the bundler config, adding maintenance burden.

### D5 — Local Temporal dev-server in `tests/env/`

**Decision**: Add `temporalite/temporalite` (or the official `temporalio/auto-setup` dev image) to `tests/env/docker-compose.yml` as a new service named `temporal`, exposing the gRPC frontend on port 7233.

**Rationale**: The CLAUDE.md memory entry "prefer real-stack testing via docker-compose" mandates real backing services in `tests/env/`. The worker-kill and version-pinning tests require a real Temporal server with durable state; an in-memory mock cannot replicate history replay. The `temporalio/auto-setup` image is the lightest officially-supported single-container Temporal dev setup (no Cassandra/MySQL required; uses SQLite in dev mode).

**Teardown**: `tests/env/down.sh` stops the `temporal` service alongside all others; no persistent volume is declared (ephemeral `tmpfs` consistent with the `postgres` service pattern in `docker-compose.yml`).

### D6 — Helm: `workflowWorker` as a component-wrapper entry

**Decision**: Add `workflowWorker` to `charts/in-falcone/Chart.yaml` dependencies using the same `component-wrapper` / `file://./charts/component-wrapper` pattern as `controlPlaneExecutor`. Extend `values.schema.json` with `"workflowWorker": { "$ref": "#/definitions/component" }`. Default `enabled: false` in `values.yaml`.

**Rationale**: All existing application services (controlPlane, controlPlaneExecutor, webConsole) follow this exact pattern. Deviating would require a custom Helm template, increasing maintenance surface.

**Resource limits**: Initial `values.yaml` defaults follow the `controlPlaneExecutor` pattern (small limits profile, 2 replicas, ClusterIP service on port 8080) since the worker has no inbound HTTP traffic — it only makes outbound gRPC calls to the Temporal server.

## Risks / Trade-offs

- **Workflow history replay on SDK upgrades**: Upgrading `@temporalio/workflow` may introduce breaking history format changes. Mitigation: pin the SDK version in `package.json` and upgrade only after running the replayer test suite against a corpus of recorded histories.
- **Large inline definitions**: Definitions near the 4 MB Temporal payload limit will silently succeed in dev but fail in production if the cluster has a lower configured limit. Mitigation: add a payload-size guard in the workflow input validator (spec requirement D2 above).
- **Expression engine determinism**: A future upgrade to the sandboxed engine (CEL/JSONata) could introduce non-determinism. Mitigation: pin the expression engine version; run replayer tests in CI against recorded histories to catch regressions before deployment.
- **Single task queue**: Starting with a single shared task queue simplifies the implementation but becomes a bottleneck at high throughput. The tenancy ADR (#356) decision is authoritative; this change implements that decision without optimising prematurely.

## Migration Plan

1. Add `temporal` to `tests/env/docker-compose.yml`; update `tests/env/up.sh` health gate.
2. Scaffold `services/workflow-worker/` with TypeScript config, Temporal SDK dependencies, and `DslInterpreterWorkflow` skeleton.
3. Implement DSL node execution mapping per spec (sequence → sub-graph recursion; parallel → `Promise.all`; task → `executeActivity`; wait → `sleep`; approval → `setHandler`/`sleep` race; subFlow → `executeChild`; cancellation → `CancellationScope`).
4. Implement node-ID activity naming convention (`activityId: node.id` on every dispatch).
5. Write and pass replayer tests on recorded histories.
6. Add `services/workflow-worker/Dockerfile`; verify `USER node` and `node:22-alpine` base.
7. Extend `charts/in-falcone/Chart.yaml`, `values.yaml`, `values.schema.json`.
8. Verify umbrella chart renders cleanly: `helm template` with `workflowWorker.enabled: true`.

**Rollback**: `workflowWorker.enabled` defaults to `false`; the feature is entirely behind this gate. Rolling back means re-setting the flag; no schema migrations are introduced.

## Open Questions

- **ADR #356 tenancy decision**: multi-namespace vs. single-namespace with task-queue-per-tenant — the `TEMPORAL_TASK_QUEUE` and `TEMPORAL_NAMESPACE` env vars read from configuration; the exact default values must be confirmed against the ADR output before the first production release.
- **Expression engine selection**: ADR #356 chooses between CEL and JSONata; this design is neutral — the sandboxed evaluation activity is swappable. The concrete import path (`cel-js` vs. `jsonata`) is deferred to `/opsx:apply` time.

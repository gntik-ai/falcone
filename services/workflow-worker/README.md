# workflow-worker

Falcone Temporal **DSL interpreter worker**. Hosts the single generic
`DslInterpreterWorkflow` that executes any flow definition (apiVersion `v1.0`,
`services/internal-contracts/src/flow-definition.json`) and the harness activities the
flow activity catalog (#360) plugs into.

## TypeScript / CommonJS deviation (why this is not an `.mjs` ESM service)

Unlike sibling services (`services/realtime-gateway`, `services/scheduling-engine`),
this package is **TypeScript compiled to CommonJS** and **deliberately does NOT declare
`"type": "module"`** in `package.json`.

This is a hard constraint of the **Temporal TypeScript SDK**, not a style choice:
`@temporalio/worker` processes workflow code through its **deterministic bundler**
(`bundleWorkflowCode`, Webpack under the hood). The bundler + the determinism sandbox
intercept Node built-ins at the module level, which is incompatible with Node's native
ESM loader (`import.meta`, top-level `await`, ESM resolution). The supported path is
CJS output. See `tsconfig.json` (`"module": "CommonJS"`).

## Runtime configuration (env)

| Variable             | Default            | Purpose                                    |
| -------------------- | ------------------ | ------------------------------------------ |
| `TEMPORAL_ADDRESS`   | `127.0.0.1:7233`   | Temporal frontend gRPC address             |
| `TEMPORAL_NAMESPACE` | `falcone-flows`    | Temporal namespace (tenancy ADR #356)      |
| `TEMPORAL_TASK_QUEUE`| `flows-main`       | Task queue the worker polls                |
| `WORKER_HEALTH_PORT` | `8080`             | HTTP probe port (`/livez`, `/readyz`)      |

Graceful shutdown: `SIGTERM`/`SIGINT` stops accepting new tasks, drains the current
poll, and exits 0.

## Node-ID activity naming convention (normative contract for monitoring #366)

Every activity dispatched by `DslInterpreterWorkflow` sets the Temporal **`activityId`
to the DSL node id** (optionally suffixed `#<loopCounter>` for an iterated node), via
`activityIdForNode` in `src/shared/naming.ts`. Because `activityId` is surfaced verbatim
on the `ActivityTaskScheduled` history event:

```
history event ActivityTaskScheduled.activityId === DSL node.id   (or node.id#<n>)
```

every history event maps back unambiguously to a canvas node — no custom header parsing.
**#366 monitoring depends on this exact encoding.** Changing it is a breaking change to
the monitoring contract. A history-mapping test asserts it
(`tests/env/workflow-worker/node-id-naming.test.mjs`).

## Activity-interface contract (the #360 plug-in seam)

The activity catalog (#360) implements `executeTask` against the
`ActivityInput` → `ActivityResult` envelope in `src/shared/types.ts`:

```ts
interface ActivityInput {
  nodeId: string;                       // DSL node id (also the Temporal activityId)
  taskType: string;                     // catalog task identifier
  node: TaskNode;                       // the originating DSL task node
  params: Record<string, unknown>;      // resolved task parameters (node.input)
  tenant: TenantContext;                // tenant isolation envelope (tenantId, workspaceId, ...)
}
```

The interpreter NEVER invokes a task activity without a `TenantContext` (BaaS isolation
rule). This change ships only the stub `executeTask`; the real catalog replaces the body
while keeping the envelope stable.

## DSL → Temporal mapping (flow-definition-mapping.json)

| DSL node    | Temporal primitive                                           |
| ----------- | ------------------------------------------------------------ |
| `sequence`  | sequential awaits of each step                               |
| `parallel`  | `Promise.all` over branch futures                            |
| `task`      | `executeActivity('executeTask', { activityId, retry, ... })` |
| `branch`    | `evaluateExpression` activity per arm; route first truthy / default |
| `wait`      | `sleep(<ISO-8601 duration>)` durable timer                   |
| `approval`  | `setHandler(approvalSignal)`; race signal vs `sleep(timeout)`|
| `sub-flow`  | `executeChild(DslInterpreterWorkflow)` inside a `CancellationScope` |

Per-task `retryPolicy` is mapped verbatim (`src/shared/mapping.ts`):
`maxAttempts → maximumAttempts`, `backoffCoefficient`, `initialInterval`,
`maximumInterval`, `nonRetryableErrors → nonRetryableErrorTypes`, and the
`timeouts.*` fields → the matching `ActivityOptions.*Timeout`.

## Determinism

All workflow code (`src/workflows/**`, plus the pure helpers it imports from
`src/shared/**`) uses ONLY Temporal SDK deterministic constructs — no `Date.now`,
`Math.random`, `fetch`, or I/O. CEL evaluation is delegated to the
`evaluateExpression` **activity** (runs outside the sandbox) per ADR-11 / design D4. The
SDK `WorkflowReplayer` is run over recorded fixture histories to catch regressions
(`tests/env/workflow-worker/replay.test.mjs`).

## Build

```
pnpm --filter @in-falcone/workflow-worker build   # tsc → dist/ (CommonJS)
node dist/worker.js                                # run the worker
```

The container image (`Dockerfile`, `node:22-alpine`, `USER node`) is built **from the
repo root** so the worker's workspace deps resolve, consistent with
`apps/control-plane/Dockerfile`.

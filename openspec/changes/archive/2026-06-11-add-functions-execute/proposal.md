## Why

`services/adapters/src/openwhisk-admin.mjs` builds request payloads for OpenWhisk but
there is no client or runtime anywhere in the control-plane; every Functions route
returned 501. Unlike the Postgres and MongoDB executors — where the adapter builds a
driver-ready plan — Functions has no executable adapter plan. This change adds a real
Functions executor (`createFunctionsExecutor` / `executeFunctions`) backed by a
pluggable backend: a LOCAL `worker_threads` backend for dev/test and a Knative backend
for production (`deploy/kind/control-plane/function-executor.mjs`). Functions and
activations are tenant-scoped by workspace in the store.

## What Changes

- `apps/control-plane/src/runtime/functions-executor.mjs` — `createFunctionsExecutor({store,backend,timeoutMs})` + `executeFunctions(params)`; operations: deploy, list, get, invoke, activations; `localWorkerBackend` (worker_threads, hard timeout, captured logs); `inMemoryFunctionStore`.
- `apps/control-plane/src/runtime/server.mjs` — five workspace-scoped routes wired via `runFunctions`: `GET/POST /v1/functions/workspaces/{wid}/actions`, `GET .../actions/{name}`, `POST .../actions/{name}/invocations`, `GET .../actions/{name}/activations`.
- `apps/control-plane/src/runtime/main.mjs` — instantiates `createFunctionsExecutor` by default; `FN_BACKEND=off` disables; production injects a Knative backend.
- Tests: `tests/env/executor/functions-executor.test.mjs` + `tests/env/executor/run-functions.sh` — 8/8 green.

## Capabilities

### New Capabilities

- `functions`: Serverless function deploy, list, get, invoke, and activation history — workspace-scoped, backend-pluggable, with a LOCAL worker_threads backend for dev/test and a Knative backend for production.

### Modified Capabilities

## Impact

- `apps/control-plane/src/runtime/functions-executor.mjs` — new file (executor + local backend + in-memory store).
- `apps/control-plane/src/runtime/server.mjs` — five functions routes added (`fn` pattern, `runFunctions` helper).
- `apps/control-plane/src/runtime/main.mjs` — conditional `createFunctionsExecutor` initialization; `FN_BACKEND=off` opt-out.
- `services/adapters/src/openwhisk-admin.mjs` — reused unchanged as payload-builder reference; executor does not call it.
- `tests/env/executor/functions-executor.test.mjs` + `tests/env/executor/run-functions.sh` — 8/8 green.

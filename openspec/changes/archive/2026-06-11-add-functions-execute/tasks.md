## Implementation status (Phase 1 — DONE)

Implemented + proven via `bash tests/env/executor/run-functions.sh` (8/8, pure Node):
- `deploy`, `list`, `get`, `invoke`, `activations` executed via the pluggable backend in
  `apps/control-plane/src/runtime/functions-executor.mjs`; `localWorkerBackend`
  (worker_threads, hard timeout, captured logs); `inMemoryFunctionStore` (workspace-keyed).
- HTTP routes wired in `apps/control-plane/src/runtime/server.mjs`:
  `GET/POST /v1/functions/workspaces/{wid}/actions`,
  `GET .../actions/{name}`,
  `POST .../actions/{name}/invocations`,
  `GET .../actions/{name}/activations`.
- `main.mjs` instantiates `createFunctionsExecutor` by default; `FN_BACKEND=off` disables.
- Tests (8/8): deploy+invoke returns result+logs, list hides source, activations recorded,
  workspace B cannot see/invoke workspace A's function (404), throwing function returns
  status error (not 5xx), runaway function killed by timeout (status timeout),
  unknown function 404, 401 on missing identity.

DEFERRED: Knative backend wiring as the default in-cluster path; Postgres-backed
function/activation store; function versions and rollback; triggers (cron, Kafka, storage
events); streaming logs via SSE or WebSocket.

## 1. Baseline

- [ ] T01 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] T02 Confirm `openspec validate add-functions-execute --strict` passes

## 2. Black-box tests (write first; must be red before implementation)

- [ ] T03 Write failing test `bbx-fn-deploy-invoke`: deploy a function via
  `POST /v1/functions/workspaces/{wid}/actions` with a source that returns a value and
  emits console output; invoke via `POST .../actions/{name}/invocations`; assert
  `status: "success"`, `result`, and `logs` in response
- [ ] T04 Write failing test `bbx-fn-activation-recorded`: after a successful invocation,
  call `GET .../actions/{name}/activations`; assert at least one activation record with
  matching `status: "success"` and `result`
- [ ] T05 Write failing test `bbx-fn-list-hides-source`: deploy a function; list via
  `GET .../actions`; assert no returned item has a `source` field
- [ ] T06 Write failing test `bbx-fn-cross-workspace-isolation`: workspace A deploys
  a function; workspace B calls `GET .../actions/{name}` under its own path; assert 404
- [ ] T07 Write failing test `bbx-fn-throwing-returns-error`: deploy a function that
  throws; invoke it; assert HTTP 200, `status: "error"`, and `error` field present
- [ ] T08 Write failing test `bbx-fn-timeout-bounded`: deploy a function with an
  infinite loop; invoke with a short timeout; assert HTTP 200 and `status: "timeout"`
- [ ] T09 Write failing test `bbx-fn-unknown-action-404`: get or invoke a function name
  that was never deployed; assert HTTP 404
- [ ] T10 Write failing test `bbx-fn-no-identity-401`: list functions with no identity
  headers and no API key; assert HTTP 401
- [ ] T11 Write failing test `bbx-fn-disabled-501`: request any functions endpoint when
  `FN_BACKEND=off`; assert HTTP 501 with `code: "FUNCTIONS_DISABLED"`
- [ ] T12 Confirm all T03–T11 are red against the current codebase before implementation

## 3. Executor implementation

- [ ] T13 Implement `inMemoryFunctionStore()` in
  `apps/control-plane/src/runtime/functions-executor.mjs`:
  - `deploy(ws, fn)` — store function record keyed by `${ws}\0${name}`; return record
  - `list(ws)` — return all records for workspace; omit `source` field
  - `get(ws, name)` — return record or null
  - `recordActivation(ws, name, activation)` — append to per-function activation list
  - `listActivations(ws, name)` — return activations for function in workspace
- [ ] T14 Implement `localWorkerBackend({timeoutMs})`:
  - Run function source in a `worker_threads` Worker; inject sandboxed `console`
  - Hard `setTimeout` terminates worker and resolves `{ timedOut: true }` on timeout
  - Return `{ ok, result, logs }` or `{ ok: false, error, logs }` on exception
  - Document: NOT a security sandbox; production uses Knative pods
- [ ] T15 Implement `createFunctionsExecutor({store, backend, timeoutMs})` +
  `executeFunctions(params)`:
  - Guard: if `!identity.tenantId` throw 401 `IDENTITY_MISSING`
  - `deploy` — validate name; call `store.deploy(workspaceId, fn)`; return record
  - `list` — call `store.list(workspaceId)`; assert no `source` field in output
  - `get` — call `store.get(workspaceId, name)`; throw 404 if absent
  - `invoke` — get function (404 if absent); call `backend.invoke(source, params)`;
    map `timedOut` → `status: "timeout"`, `ok: false` → `status: "error"`,
    `ok: true` → `status: "success"`; record activation; return activation
  - `activations` — get function (404 if absent); call `store.listActivations`

## 4. Route wiring

- [ ] T16 Confirm `runFunctions(functionsExecutor, params, successStatus)` helper exists
  in `server.mjs`; throws 501 `FUNCTIONS_DISABLED` when `functionsExecutor` is falsy
- [ ] T17 Confirm `GET /v1/functions/workspaces/{wid}/actions` wired to `list`
- [ ] T18 Confirm `POST /v1/functions/workspaces/{wid}/actions` wired to `deploy`
- [ ] T19 Confirm `GET /v1/functions/workspaces/{wid}/actions/{name}` wired to `get`
- [ ] T20 Confirm `POST /v1/functions/workspaces/{wid}/actions/{name}/invocations`
  wired to `invoke`
- [ ] T21 Confirm `GET /v1/functions/workspaces/{wid}/actions/{name}/activations`
  wired to `activations`
- [ ] T22 Confirm `main.mjs` instantiates `createFunctionsExecutor` by default;
  `FN_BACKEND=off` skips instantiation (leaves `functionsExecutor` undefined)

## 5. Integration verification

- [ ] T23 Run `bash tests/env/executor/run-functions.sh`; confirm all 8 tests pass
- [ ] T24 Run `bash tests/blackbox/run.sh`; confirm T03–T11 pass (green) and existing
  tests are unaffected
- [ ] T25 Run `openspec validate add-functions-execute --strict`

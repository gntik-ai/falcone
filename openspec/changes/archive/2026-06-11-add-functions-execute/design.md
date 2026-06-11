## Context

`services/adapters/src/openwhisk-admin.mjs` builds HTTP request payloads for OpenWhisk
admin operations (action create/invoke). No code in the control-plane ever passed those
payloads to a real runtime. The five functions routes in
`apps/control-plane/src/runtime/server.mjs` (the `fn` pattern and `runFunctions` helper)
existed but `functionsExecutor` was never instantiated, so every call returned 501.

Unlike the Postgres and MongoDB executors — where the adapter builds a driver-ready plan
that the executor runs — the OpenWhisk adapter builds HTTP payloads for a specific
external API. There is no plan type for worker-thread or Knative execution. The executor
therefore owns the backend abstraction directly, following the same direct-driver pattern
used by the events executor (`kafkajs`) and the kind control-plane's
`function-executor.mjs` (Knative).

The kind runtime's per-workspace store scoping is the established isolation model; the
executor reuses it.

## Goals / Non-Goals

**Goals:**
- Implement `createFunctionsExecutor({store, backend, timeoutMs})` +
  `executeFunctions(params)` in
  `apps/control-plane/src/runtime/functions-executor.mjs`.
- Support operations: `deploy`, `list`, `get`, `invoke`, `activations`.
- Ship a `localWorkerBackend` (`worker_threads`, hard timeout, captured logs) for
  dev/test. Document clearly: NOT a security sandbox; production uses Knative pods.
- Ship an `inMemoryFunctionStore` for dev/test; accept any store with
  `{deploy, list, get, listActivations, recordActivation}` for production injection.
- Enforce tenant isolation via per-workspace store scoping: every store lookup is keyed
  by `workspaceId`; cross-workspace access is structurally impossible.
- `list` never returns the `source` field.
- Wire the executor into `server.mjs` via `runFunctions`; instantiate from `main.mjs`
  by default (`FN_BACKEND=off` opts out; production injects a Knative backend).
- Prove correctness with `tests/env/executor/functions-executor.test.mjs` (8/8, pure
  Node — no external service required for the local backend).

**Non-Goals:**
- Knative backend wiring as the default in-cluster path (deferred).
- Postgres-backed function/activation store (deferred).
- Function versions and rollback (deferred).
- Triggers: cron, Kafka event, storage event (deferred).
- Streaming logs via SSE or WebSocket (deferred).

## Decisions

**D1 — Backend-pluggable executor; no adapter plan for functions.**
The OpenWhisk adapter builds HTTP payloads for a specific external API, not a
driver-ready plan. There is no plan schema for worker-thread or Knative execution.
The executor owns a `{ invoke(source, params) }` backend interface directly. The local
`worker_threads` backend ships by default for dev/test; production passes a Knative
backend. This is consistent with the events executor's direct-driver pattern.

**D2 — LOCAL worker_threads backend is NOT a security sandbox.**
The worker receives the raw function source and runs it in a separate thread with a
sandboxed `console` injected. A hard `setTimeout` terminates the worker on timeout.
This provides process-level isolation only: the worker shares the same OS process and
can access the file system and network. Production deployments MUST use the Knative
backend (isolated pods). The code comment and this design note make the boundary
explicit.

**D3 — Tenant isolation via per-workspace store scoping.**
Every store operation (`deploy`, `list`, `get`, `listActivations`, `recordActivation`)
is keyed by `workspaceId` extracted from verified gateway-injected identity. A caller
that supplies a different `workspaceId` in the path is rejected at the identity-check
layer before the store call. There are no shared keys or cross-workspace indices.

**D4 — Failing functions return HTTP 200 with `status: "error"`, not 5xx.**
A function that throws is a caller-controlled event, not a server fault. The executor
catches the error, records an activation with `status: "error"` and a sanitized `error`
field (message only; no stack), and returns HTTP 200. This avoids false-positive 5xx
alerts and is consistent with OpenWhisk's activation model.

**D5 — Runaway invocations return HTTP 200 with `status: "timeout"`.**
The worker-thread timer terminates the worker and resolves with `{ timedOut: true }`.
The executor maps this to an activation with `status: "timeout"`. This allows the
caller to distinguish a timeout from an error without a 5xx.

**D6 — 501 when no executor is configured (`FUNCTIONS_DISABLED`).**
`runFunctions` in `server.mjs` throws `{statusCode: 501, code: "FUNCTIONS_DISABLED"}`
when `functionsExecutor` is falsy. This is consistent with the events and Mongo
executors' disabled-state policy.

## Risks / Trade-offs

**Risk: The in-memory store is not durable across restarts.**
Mitigation: This is explicit and expected for dev/test. A Postgres-backed store is
deferred. The local backend is not intended for production.

**Risk: worker_threads-based isolation is insufficient for production.**
Mitigation: The code, comments, and this document all state clearly that the local
backend is dev/test only. The production Knative backend is already built at
`deploy/kind/control-plane/function-executor.mjs` and provides full pod isolation.

**Risk: Activation records grow unboundedly in the in-memory store.**
Mitigation: Acceptable at dev/test scale. A retention policy and bounded list are
deferred to the Postgres store phase.

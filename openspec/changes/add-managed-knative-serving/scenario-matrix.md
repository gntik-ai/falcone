# Source scenario traceability for #933

This matrix maps every `#### Scenario` in `specs/functions/spec.md` and
`specs/mcp/spec.md` to the owning source and a named test. It is source-level
evidence only. Tests marked **local pass** ran in the assigned source worktree.
**CI required** means the test exists but could not pass in this sandbox: HTTP
tests cannot bind loopback (`listen EPERM`), and tests importing `undici` need
the normal dependency installation. These are not live OpenShift acceptance.

| Functions scenario | Source | Named test | Evidence |
|---|---|---|---|
| Deploy fails explicitly while managed runtime is degraded | `apps/control-plane/fn-handlers.mjs` | `function-knative-01` | local pass |
| Invoke fails explicitly with an external incompatibility | `apps/control-plane/knative-runtime.mjs`, `apps/control-plane/fn-handlers.mjs` | `knative-runtime-07`, `function-knative-02` | local pass |
| Disabled Functions preserve the existing error | `apps/control-plane/fn-handlers.mjs` | `function-knative-04` | local pass |
| Delete during an outage is accepted as pending cleanup | `apps/control-plane/runtime-cleanup-repository.mjs`, `apps/control-plane/fn-handlers.mjs` | `function-knative-05`, `runtime-cleanup-01` | local pass |
| Degraded metadata read remains honest | `apps/control-plane/fn-handlers.mjs` | `function-knative-06` | local pass |
| Same names in adjacent tenants remain distinct | `apps/control-plane/function-executor.mjs`, `apps/control-plane/fn-handlers.mjs` | `managed-function-ownership-01`, `managed-function-ownership-05`, `bbx-fn-deploy-scope-01` | local pass |
| Version and rollback preserve Function semantics | `apps/control-plane/fn-handlers.mjs`, `apps/control-plane/function-executor.mjs` | `fn-lifecycle-own-01`, `fn-lifecycle-own-02`; `bbx-786-01` | unit local pass; blackbox CI required |
| Tenant teardown leaves no function workloads | `apps/control-plane/runtime-teardown-coordinator.mjs`, `apps/control-plane/function-executor.mjs`, `apps/control-plane/runtime-cleanup-repository.mjs` | `runtime-teardown-01`, `managed-function-ownership-02b`, `runtime-cleanup-02`, `bbx-933-aggregate-teardown-21` | local pass |
| Teardown is deferred safely during an outage | `apps/control-plane/runtime-teardown-coordinator.mjs`, `apps/control-plane/runtime-cleanup-repository.mjs`, `apps/control-plane/function-executor.mjs` | `runtime-teardown-01`, `runtime-cleanup-02b`, `managed-function-ownership-02b`, `bbx-933-aggregate-teardown-22` | local pass |
| Unavailable deploy has correlated evidence | `apps/control-plane/fn-handlers.mjs`, `apps/control-plane/knative-observability.mjs` | `knative-observability-01`, `knative-observability-02` | local pass |
| Adjacent tenant cannot use dependency status to enumerate workloads | `apps/control-plane/fn-handlers.mjs` | `function-knative-08`, `bbx-fn-list-scope-01` | local pass |

| MCP scenario | Source | Named test | Evidence |
|---|---|---|---|
| Publish fails explicitly while Knative is degraded | `apps/control-plane-executor/src/runtime/server.mjs`, `apps/control-plane-executor/src/runtime/mcp-engine.mjs` | `bbx-933-mcp-publish-gate` | CI required |
| Consumer receives honest unavailable status | `apps/control-plane-executor/src/runtime/server.mjs` | `bbx-933-mcp-rpc-unavailable` | CI required |
| Disabled hosting remains distinguishable | `apps/control-plane-executor/src/runtime/server.mjs` | `bbx-933-mcp-disabled-distinct` | CI required |
| Delete during an outage is accepted as pending cleanup | `apps/control-plane-executor/src/runtime/mcp-engine.mjs`, `apps/control-plane/runtime-cleanup-repository.mjs` | `outage teardown: tenant and capability operations atomically retain idempotent MCP cleanup obligations`, `runtime-cleanup-03`, `bbx-933-mcp-delete-pending` | unit local pass; HTTP CI required |
| Unavailable notification has no JSON-RPC body | `apps/control-plane-executor/src/runtime/server.mjs` | `bbx-933-mcp-notification` | CI required |
| Authentication and ownership precede dependency status | `apps/control-plane-executor/src/runtime/server.mjs`, `apps/control-plane-executor/src/runtime/mcp-engine.mjs` | `cross-tenant: B cannot get / call / audit A's server (404)`, `bbx-933-mcp-precedence` | unit local pass; HTTP CI required |
| Degraded audit read remains available | `apps/control-plane-executor/src/runtime/mcp-engine.mjs`, `apps/control-plane-executor/src/runtime/server.mjs` | `bbx-933-mcp-degraded-read` | CI required |
| Same server identity in two tenants remains isolated | `apps/control-plane-executor/src/runtime/mcp-engine.mjs`, `apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs` | `outage teardown: tenant and capability operations atomically retain idempotent MCP cleanup obligations`, `bbx-933-mcp-cluster-local-isolation-36` | unit local pass; blackbox CI required |
| Idle server scales down and cold-starts | `apps/control-plane-executor/src/mcp-custom-hosting.mjs`, `apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs` | `valid image -> ksvc: mcp-server label, min-scale 0, non-root securityContext`, `bbx-933-mcp-hosted-invoke` | manifest local pass; HTTP CI required |
| Direct or cross-namespace ingress remains denied | `apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs` | `bbx-933-mcp-cluster-local-isolation-36`, `bbx-933-mcp-knative-ingress-52` | CI required |
| Tenant deprovision removes the complete MCP footprint | `apps/control-plane-executor/src/runtime/mcp-runtime-cleaner.mjs`, `apps/control-plane-executor/src/runtime/mcp-engine.mjs` | `runtime-cleanup-04`, `mcp-runtime-cleaner-01`, `bbx-933-aggregate-teardown-21` | repository local pass; cleaner CI required |
| Runtime outage defers cleanup honestly | `apps/control-plane-executor/src/runtime/mcp-engine.mjs`, `apps/control-plane/runtime-cleanup-repository.mjs` | `runtime-cleanup-05`, `bbx-933-aggregate-teardown-22` | local pass |
| Retried cleanup is safe | `apps/control-plane-executor/src/runtime/mcp-runtime-cleaner.mjs`, `apps/control-plane/runtime-cleanup-repository.mjs` | `runtime-cleanup-05`, `mcp-runtime-cleaner-04`, `bbx-933-mcp-cleaner-precondition-errors-30` | repository local pass; cleaner/blackbox CI required |
| Hosted-server outage is correlated without secrets | `apps/control-plane-executor/src/runtime/server.mjs`, `apps/control-plane/knative-observability.mjs` | `mcp-knative-metrics-01`, `bbx-933-mcp-central-audit` | metrics local pass; HTTP CI required |
| Adjacent tenant learns no hosted-server state | `apps/control-plane-executor/src/runtime/mcp-engine.mjs`, `apps/control-plane-executor/src/runtime/server.mjs` | `cross-tenant: B cannot get / call / audit A's server (404)`, `bbx-933-mcp-precedence` | unit local pass; HTTP CI required |

The source-level task checkboxes remain open until the CI-required tests pass on
the ChangeSet. T22–T27 remain blocked on the disposable remote OpenShift 4.21
cluster, coordinated chart release and independent live acceptance.

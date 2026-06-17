# Evidence — Functions (Knative) + Events (Kafka) + event-driven integration (live `falcone` ns)

Target: kind test-cluster-b, ns `falcone`, Helm `in-falcone-0.3.0`.
Surfaces tested: **cp-executor** (`falcone-cp-executor`, image `in-falcone-control-plane-executor:0.9.5`,
port-forward 18082) and **control-plane** (`falcone-control-plane`, image `in-falcone-control-plane:0.6.2`,
port-forward 18080). Fixtures: Tenant A = Ops Demo (`ffd33d99…`, ws `9dfb3614…`, slug `ops-ws`);
Tenant B = DataPlane Demo (`a5db1fad…`, ws `7d155cef…`, slug `primary`).
Auth: real `flc_service_*` API keys per workspace (executor data-plane) + superadmin platform JWT (control-plane).

Repro: `bash tests/live-audit/specs/06-functions-events.sh` → 19 functional PASS, 3 ISOLATION FAIL (the leaks).

## Two distinct, simultaneously-live function/event runtimes (key architecture fact)

| Surface | Served by | Route shape | Backend | Store |
|---|---|---|---|---|
| **Executor functions** | cp-executor `server.mjs` | `/v1/functions/workspaces/{ws}/actions/{name}/…` | **local worker_threads** (FN_BACKEND unset → `createFunctionsExecutor()` default) | **in-memory** (`inMemoryFunctionStore`) |
| **Executor events** | cp-executor `events-executor.mjs` | `/v1/events/workspaces/{ws}/topics/…` | **real Kafka** `falcone-kafka:9092` (KAFKA_BROKERS set) | Kafka, physical topic `evt.<ws>.<topic>` |
| **Control-plane Knative functions** | `deploy/kind/control-plane` `fn-handlers.mjs` | `/v1/functions/actions/{resourceId}/…` + `/v1/functions/workspaces/{ws}/actions` | **real Knative ksvc** (`fn-runtime:0.1.0`, scale-from-zero) | Postgres `fn_actions`/`fn_activations` |

`kubectl -n falcone get ksvc` → `fn-primary-multiplier` (READY) — created by `falcone-control-plane`
(`ksvcName('primary','multiplier')`), i.e. it belongs to **Tenant B** (ws slug `primary`).
Code refs: `apps/control-plane/src/runtime/server.mjs:313-332`, `…/functions-executor.mjs:51-122`,
`…/events-executor.mjs:17-122`, `deploy/kind/control-plane/fn-handlers.mjs`, `…/tenant-store.mjs:160`.

## Status per functionality

| Functionality | Status | Evidence |
|---|---|---|
| Executor: list actions | **Active** | `GET …/actions` → 200 `{"items":[]}` |
| Executor: deploy action | **Active** | `POST …/actions` → 201 `{"name":"lafn…mult","runtime":"nodejs",…}` |
| Executor: get action | **Active** | `GET …/actions/{name}` → 200 `{…,"hasSource":true}` |
| Executor: **invoke → result** | **Active** | `POST …/{name}/invocations {a:6,b:7}` → 200 `{"status":"success","result":{"product":42,"tenant":"A"}}` |
| Executor: invoke captures logs | **Active** | `console.log` → `"logs":["hello from tenantA"]`; `process` defined → confirms in-thread Node runner |
| Executor: activations | **Active** | `GET …/{name}/activations` → 200 `{"items":[{"activationId":…,"success":true,"durationMs":…}]}` |
| Events: list_topics | **Active** | `GET …/topics` → 200, logical names only |
| Events: create_topic | **Active** | `POST …/topics {topic,partitions}` → 201 `{"topic":"laevt…t","created":true}` |
| Events: publish | **Active** | `POST …/{topic}/publish` → 202 `{"published":1,"partitions":[…baseOffset…]}` |
| Events: **consume (round-trip)** | **Active** | published `{hello:world,n:42}` key `k1` → consumed back identically `{"key":"k1","value":"{\"hello\":\"world\",\"n\":42}","offset":"0"}` |
| Control-plane **Knative invoke → result** | **Active** | `POST /v1/functions/actions/fn_27a950f2-f89/invocations {a:6,b:7,name:"mundo"}` → 202; result `{"engine":"knative","product":42,"greeting":"hola mundo"}`, logs `["knative fn running for mundo"]`, durationMs 1299 (cold start) |
| Function **triggers** (`…/triggers`) | **Not-deployed** | 404 `NO_ROUTE` on executor AND control-plane |
| Function **rules** (`…/rules`) | **Not-deployed** | 404 `NO_ROUTE` on executor AND control-plane |
| **kafka-triggers** (`/actions/{id}/kafka-triggers`) | **Not-deployed** | 404 `NO_ROUTE` |
| **Kafka → function** end-to-end | **Not-deployed** | no trigger/rule route, no background consumer (grep: only catalog/migration/console-UI refs) |
| **Kafka → workflow** end-to-end | **Not-deployed** | no Temporal, no `workflow-worker`/`event-gateway` deploy; flows route → `NO_ROUTE` |

## Functions invoke → correct result: PROVEN on BOTH runtimes

- **Executor (worker_threads):** `main({a:6,b:7})` → `{product:42}`. Real in-thread execution (`process` present, logs captured).
- **Knative (real ksvc):** `fn-primary-multiplier` (`fn_27a950f2-f89`) → `{engine:"knative",product:42,greeting:"hola mundo"}`, 1.3 s cold start. This is the production-style runtime.

## Event-driven integration (EXPLICIT REQUIREMENT) — RESULT

- **Kafka → function: NOT WIRED / NOT-DEPLOYED.** There is no way to bind a Kafka topic to a function:
  the trigger/rule routes from the public route catalog (`…/triggers`, `…/rules`,
  `/actions/{id}/kafka-triggers`) return **404 `NO_ROUTE` on both the executor and the control-plane**
  (the executor proxies the miss upstream; the kind control-plane also has no such route — its
  `fnInventory` reports hard-coded `triggers:0, rules:0`). No background Kafka→function consumer exists
  in the deployed runtimes (code grep for a kafka-trigger/rule consumer finds only the route catalog,
  a migration, and the web-console UI — no executable wiring).
- **Kafka → workflow: NOT-DEPLOYED.** No Temporal, no `workflow-worker`/`event-gateway` deployments
  (`kubectl get deploy` shows only apisix, control-plane, cp-executor, ferretdb, keycloak,
  observability, seaweedfs-s3, web-console). Flows routes return `NO_ROUTE`.
- **What works without triggers:** events publish→consume round-trip (Kafka) and function invoke→result
  (both runtimes) each work in isolation — but the *integration* (an event automatically invoking a
  function/workflow) is **absent**. A consumer must be supplied by the tenant's own code calling the
  invoke API; the platform provides no event→function binding.
- Direct Kafka confirms physical topic `evt.9dfb3614-…laevt…t` (per-workspace prefix is real).

## FINDING FE-1 (CRITICAL, tenant-isolation) — executor functions/events: path workspaceId overrides the key's workspace ⇒ cross-tenant IDOR

The executor route handlers pass the **path** `workspaceId` (`groups[0]`) into the functions/events
executors, and the executor uses `params.workspaceId ?? identity.workspaceId` — so the **path always
wins** and the verified API key's bound workspace is never enforced. `resolveIdentity`
(`server.mjs:123`) resolves tenant/workspace from the verified key but **no handler asserts
`identity.workspaceId === path workspaceId`** for the functions/events families.

Empirical proof — **Tenant B's real `flc_service` key, with Tenant A's workspace id in the path**:

```
POST /v1/functions/workspaces/<A_ws>/actions/lafn…mult/invocations   (B key) {a:2,b:3}
 -> 200 {"status":"success","result":{"product":6,"tenant":"A"}}         # B INVOKES A's function
GET  /v1/functions/workspaces/<A_ws>/actions/lafn…mult                (B key)
 -> 200 {"name":"lafn…mult","workspaceId":"9dfb3614…","hasSource":true}  # B reads A's fn metadata
GET  /v1/events/workspaces/<A_ws>/topics                              (B key)
 -> 200 {"items":[{"topic":"laevt…t"}]}                                  # B lists A's topics
GET  /v1/events/workspaces/<A_ws>/topics/laevt…t/messages            (B key)
 -> 200 {"messages":[{"key":"k1","value":"{\"hello\":\"world\",\"n\":42}"}]}  # B READS A's events
POST /v1/events/workspaces/<A_ws>/topics/laevt…t/publish             (B key) {value:{from:"B"}}
 -> 202 {"published":1,…"baseOffset":"1"}                                # B WRITES into A's topic
```

Sanity (proves the leak is the path override, not a shared store): with **B's own** workspace path,
B sees none of A's resources (`…/topics` → `{"items":[]}`, `…/actions` → `{"items":[]}`).
Severity CRITICAL — cross-tenant read AND write of functions and event streams; the Kafka
`evt.<ws>.<topic>` prefix model offers zero protection because the `<ws>` segment is attacker-supplied.
1-line repro: `K=$(mint_key $TB_TENANT $TB_WS service); exk GET /v1/events/workspaces/$TA_WS/topics "$K"` → lists A's topics.

## FINDING FE-2 (HIGH, tenant-isolation) — control-plane Knative function routes: no tenant scoping by resourceId (IDOR)

The kind control-plane routes (`routes.mjs:128-152`) are `auth:'authenticated'` only — **no
tenant/workspace check** — and `getFnAction(pool, resourceId)` (`tenant-store.mjs:160`) selects by
`resource_id` with **no `tenant_id` predicate**. Every resourceId route (`fnActionDetail`, `fnInvoke`,
`fnActivations`, `fnActivation`, `fnActivationLogs`, `fnActivationResult`, `fnVersions`, `fnRollback`)
returns/acts on the row for ANY tenant's resourceId. Any authenticated principal that learns a
`fn_…` id can invoke another tenant's Knative function and read its **inline source code** + activation
results/logs.
- Empirically: invoking Tenant B's `fn_27a950f2-f89` and reading its source/result/logs succeeded
  (done here with the superadmin platform JWT — platform-admin, so "allowed" — but the **code has no
  tenant filter**, so a tenant-scoped principal would be authorized identically).
- Note on testability: the control-plane verifies JWTs against the **platform realm JWKS** only
  (`server.mjs:34`), and `authenticated` accepts any valid platform-realm token; it does **not** accept
  API keys (Tenant A key → 401 `UNAUTHENTICATED`). So a second *distinct-tenant* platform JWT was not
  available to demonstrate the cross-tenant call end-to-end; the leak is established by the route
  authz (`authenticated`, no scope) + the unscoped `getFnAction` query. The `listFnActions` endpoint
  IS workspace-scoped; only the resourceId routes leak.

## Cross-tenant isolation probe — RESULT

- **Executor functions/events: LEAK (FE-1, CRITICAL).** Tenant B → invoke/list/get/consume/**publish**
  on Tenant A's functions and topics, by putting A's ws id in the path. Read + write, both directions.
- **Control-plane Knative functions: structural leak (FE-2, HIGH).** Routes authenticate but never
  scope by tenant; `getFnAction` ignores tenant — invoke/read any resourceId.

## Not-deployed (do NOT file as bugs)

- Function **triggers** and **rules** (no route on either runtime).
- **Kafka→function** binding and **Kafka→workflow** binding (no trigger consumer; no Temporal/worker).
- Function deploy on the **executor** uses the dev worker_threads backend (in-memory, single-replica,
  ephemeral) — not Knative; the Knative path is the separate control-plane runtime.

## Cleanup / residue

- Kafka topic `evt.<A_ws>.laevt<rand>t` created by the spec: left as **harmless test residue** —
  exec-write (topic delete) was out of the brief's read-only `kubectl exec` scope, and the executor
  exposes no topic-delete route. Named with the `laevt` prefix; one tiny test message.
- In-memory executor function entries (`lafn<rand>mult`, `lafn<rand>log`): process-local, vanish on
  cp-executor restart; not shared across tenants (each is workspace-scoped in the in-memory map).
- No secrets were printed or committed (keys/passwords/tokens redacted to prefixes).

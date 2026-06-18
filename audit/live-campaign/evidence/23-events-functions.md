# Live evidence — Events/Kafka (cap-events) + Functions/Knative (cap-functions) + event-driven integration + tenant isolation

Date: 2026-06-18. Target: live `falcone` kind ns (test-cluster-b). Fresh-from-HEAD images
(`localhost:30500/in-falcone-control-plane-executor:campaign-20260617`). All evidence is ACTUAL
HTTP responses against the running stack. Auth: acme-ops (tenant A=acme) / globex-ops (tenant B=globex)
JWTs minted via `POST $GW/v1/auth/login-sessions` (GW=APISIX :9080 → Bearer → falcone-control-plane).

## Topology actually deployed (verified)
- **GW (APISIX :9080) → `falcone-control-plane`** runs the hand-built `deploy/kind/control-plane`
  runtime (`routes.mjs`). It serves Events + Functions (`*-handlers.mjs`). It has **NO flows/trigger
  routes** at all.
- **`falcone-cp-executor` (:18082 direct)** runs the `apps/control-plane/src/runtime` runtime
  (server.mjs/main.mjs). It serves flows/MCP/realtime AND its own (separate, in-memory) events/functions
  surface. Env (read via `kubectl get … jsonpath`): `KAFKA_BROKERS=falcone-kafka:9092`,
  `TEMPORAL_ADDRESS=falcone-temporal-frontend:7233`, `TEMPORAL_NAMESPACE=falcone-flows`,
  `CONTROL_PLANE_UPSTREAM=http://falcone-control-plane:8080`.
- Functions backend = **Knative** (real ksvc). NO OpenWhisk anywhere (no namespace, no invoker/controller pods).
- `temporal-dev` + `falcone-workflow-worker` (taskQueue `flows-main`) pods Running in the `falcone` ns.

---

## STATUS LINES (per functionality)

### Events / Kafka (cap-events) — GW surface (`deploy/kind/control-plane/kafka-handlers.mjs`)
- create topic `POST /v1/events/workspaces/{ws}/topics` ............ **Active/Working** (201)
- list inventory `GET /v1/events/workspaces/{ws}/inventory` ........ **Active/Working** (200)
- topic detail `GET /v1/events/topics/{topicId}` .................. **Active/Working** (200)
- topic metadata `GET /v1/events/topics/{topicId}/metadata` ....... **Active/Working** (200)
- topic access `GET /v1/events/topics/{topicId}/access` ........... **Active/Working** (200)
- publish `POST /v1/events/topics/{topicId}/publish` .............. **Active/Working** (202; body `{key,payload}`)
- consume SSE `GET /v1/events/topics/{topicId}/stream` ............ **Active/Working** (200, real SSE; delivered published events)
- **tenant isolation on topics** .................................. **BROKEN — P0 cross-tenant IDOR (read + write + stream)**

### Functions / Knative (cap-functions) — GW surface (`deploy/kind/control-plane/fn-handlers.mjs`)
- deploy `POST /v1/functions/actions` ............................ **Active/Working** (201; real ksvc created)
- list/inventory `GET /v1/functions/workspaces/{ws}/{actions,inventory}` **Active/Working** (200)
- action detail `GET /v1/functions/actions/{id}` ................. **Active/Working** (200)
- invoke `POST /v1/functions/actions/{id}/invocations` ........... **Active/Working** (202; Knative cold-start runs main())
- activation result `.../activations/{aid}/result` .............. **Active/Working** (200; `{doubled:42}` confirmed)
- activation logs / list / versions ............................. **Active/Working** (200)
- **invoke input contract** ..................................... **BROKEN — P2** (reads `body.parameters`, drops top-level input → wrong result, no error)
- **tenant isolation on action LOOKUP (API)** ................... **Working** (cross-tenant action read/invoke → 404)
- **tenant isolation on Knative ksvc (compute)** ................ **BROKEN — P0 cross-tenant ksvc clobber / code-execution hijack**

### Event-driven integration (Kafka event → function / workflow)
- event→function trigger (kafka-triggers) on GW ................. **Not-deployed** (route 404; not in `routes.mjs`)
- event→flow platform-event trigger registration (EXEC) ......... **Working** (trigger registers, subscribes `evt.{ws}.{eventType}`)
- event→flow execution end-to-end .............................. **BROKEN — blocked by flows P0 (Temporal visibility)**: event published OK but NO execution started (manual start also 500). Net verdict: **event-driven integration does NOT work end-to-end in this deployment.**

---

## EVENTS — happy path (tenant A)

Create topic (A):
```
POST $GW/v1/events/workspaces/928534a8-…(TA_WS)/topics
body {"topicName":"lcevt15317","name":"lcevt15317","partitions":1}
-> 201 {"resourceId":"res_topic_38030a42","topicName":"lcevt15317","physicalTopicName":"ws.app-staging.lcevt15317","partitionCount":1,"status":"active"}
```
NOTE the physical name is `ws.{workspaceNAME}.{topic}` = `ws.app-staging.…` — the slug is the workspace
*name* ("app-staging"), with **no tenant qualifier**. Both A and B have a workspace named "app-staging".

Inventory (A) — 200, lists both `app-staging-events` and `lcevt15317`; reports
`"tenantIsolation":{"mode":"prefix","crossTenantAccessPrevented":true}` (this claim is FALSE — see IDOR below).

Detail/metadata/access (A) — all 200 (detail leaks `tenantId`+`workspaceId`+`physicalTopicName`).

**Publish + SSE consume (A) — end-to-end delivery CONFIRMED:**
```
# SSE stream open on res_topic_38030a42, then two publishes:
POST .../topics/res_topic_38030a42/publish {"key":"k1","payload":{"hello":"lc-events-A","n":1}} -> 202
POST .../topics/res_topic_38030a42/publish {"key":"k2","payload":{"hello":"lc-events-A","n":2}} -> 202
# SSE frames captured on the stream:
: connected
data: {"key":"k1","payload":{"hello":"lc-events-A","n":1},"partition":0,"offset":"0","timestamp":"1781740755207"}
data: {"key":"k2","payload":{"hello":"lc-events-A","n":2},"partition":0,"offset":"1","timestamp":"1781740755256"}
```
Real Kafka (kafkajs, PLAINTEXT broker). Publish body is `{key,payload}` (NOT the brief's `{events/messages}`).
Consume is SSE at `/stream` (NOT the brief's; there is no `/messages` poll route in the deployed GW runtime).

---

## EVENTS — ISOLATION PROBE (TOP PRIORITY) → **P0 cross-tenant IDOR (read + write + stream)**

Root cause (code): `kafka-handlers.mjs::resolveTopic` resolves `getTopicByResourceId(pool, topicId)` and
`tenant-store.mjs::getTopicByResourceId` runs `SELECT … FROM workspace_topics WHERE id=$1` — **NO tenant/
workspace filter, and no caller-tenant arg is even passed.** `eventsTopicDetail/Access/Metadata/Publish/Stream`
all share this resolver. (Contrast: functions correctly pass `callerTenantId` → `fn_actions WHERE tenant_id=$2`.)

B created topic `res_topic_3d1fe56b` (`ws.app-staging.lcevtb3186`, tenant globex). With a **fresh, valid
tenant-A JWT** (tenant_id=78848e21…acme):
```
GET  $GW/v1/events/topics/res_topic_3d1fe56b           -> 200  (leaks "tenantId":"fe63fa39…globex","workspaceId":"cc38c85c…")
GET  $GW/v1/events/topics/res_topic_3d1fe56b/metadata  -> 200  (partition offsets, log positions)
POST $GW/v1/events/topics/res_topic_3d1fe56b/publish   -> 202  {"publicationId":"pub_46152acf-642",…}   <-- A INJECTED an event into B's topic
```
**A consumed B's topic via SSE** (`fromBeginning:true` replays the injected event + a live one):
```
GET $GW/v1/events/topics/res_topic_3d1fe56b/stream  (A's token)
: connected
data: {"key":"intruder","payload":{"from":"tenantA","attack":"cross-tenant-publish"},"partition":0,"offset":"0",…}
data: {"key":"intruder2","payload":{"from":"tenantA","live":true},"partition":0,"offset":"1",…}
```
**Symmetric** — B's token → A's topic `res_topic_38030a42`: detail 200 (leaks acme tenantId) and publish 202
(`pub_5c777471-86a` injected into `ws.app-staging.lcevt15317`).

VERDICT: any authenticated tenant can READ (detail/metadata/access), CONSUME (SSE), and WRITE (publish/inject)
**any other tenant's Kafka topic** given only its `res_topic_*` id (opaque but enumerable/guessable; also leaked
by the very detail endpoint). Cross-tenant data exfiltration AND injection. **P0 / tenant-isolation / security.**

---

## FUNCTIONS — happy path (tenant A), Knative confirmed

Deploy (A) — runtime expects a global `main(params)` (OpenWhisk-compatible convention in `fn-runtime/server.mjs`),
NOT `export default`. Deployed with `function main(input){return {doubled:(input.n||0)*2};}`:
```
POST $GW/v1/functions/actions
body {"workspaceId":"928534a8…(TA_WS)","actionName":"lcfn3150","source":{"inlineCode":"function main(input){return {doubled:(input.n||0)*2};}"},"execution":{"runtime":"nodejs:22"}}
-> 201 {"resourceId":"fn_a84118ef-a90","status":"accepted",…}
```
**Real Knative Service created** (`kubectl -n falcone get ksvc`):
```
NAME                      URL                                                        READY
fn-app-staging-lcfn3150   http://fn-app-staging-lcfn3150.falcone.svc.cluster.local   True   (rev -00001, cluster-local)
```
**NO OpenWhisk**: `kubectl get ns` no openwhisk; no invoker/controller/whisk pods anywhere.

Invoke + result — Knative cold-start executes `main`:
```
POST .../actions/fn_a84118ef-a90/invocations {"parameters":{"n":21}} -> 202 {"invocationId":"act_e2206688-8be","status":"completed"}
GET  .../activations/act_e2206688-8be/result -> 200 {"status":"succeeded","result":{"doubled":42},…}   <-- doubled:42 CONFIRMED
```
Activations list (200, `triggerKind:"manual"`, durationMs 20, statusCode 200), logs (200), versions
(200, v1 active), detail (200, entrypoint main, runtime nodejs:22), inventory (200) — all working.

### Functions invoke-input contract bug — **P2**
`fn-handlers.mjs::fnInvoke` (line 103) reads input from **`ctx.body?.parameters`**. The console client and
the brief send the input at TOP LEVEL (`{"n":21}`). With top-level body, `params={}` → function runs with
empty input → returns `{"doubled":0}` (HTTP 202 "completed", no error):
```
POST .../invocations {"n":21}                 -> result {"doubled":0}     (input dropped, silent)
POST .../invocations {"parameters":{"n":21}}  -> result {"doubled":42}    (correct)
```
Severity P2: silent wrong-result, not a leak; trivial repro.

---

## FUNCTIONS — ISOLATION PROBES

### (a) API action lookup — **Working (fail-closed)**
B's token → A's action `fn_a84118ef-a90`:
```
GET  .../actions/fn_a84118ef-a90              -> 404 ACTION_NOT_FOUND
POST .../actions/fn_a84118ef-a90/invocations -> 404 ACTION_NOT_FOUND
GET  .../actions/fn_a84118ef-a90/activations -> 404 ACTION_NOT_FOUND
GET  .../activations/{aid}/result            -> 404 ACTIVATION_NOT_FOUND
```
Correct: `getFnAction(pool, resourceId, callerTenantId)` filters `WHERE resource_id=$1 AND tenant_id=$2`.

### (b) Knative ksvc compute isolation — **BROKEN — P0 cross-tenant ksvc clobber + code-execution hijack**
Root cause (code): `function-executor.mjs::ksvcName(workspaceSlug, actionName)` = `fn-{workspaceNAME}-{actionName}`
with **no tenant/workspace-ID component**. `fnDeploy` uses `ws.slug` (= workspace *name*). Both tenants have a
workspace named "app-staging", so same-named actions COLLIDE on one ksvc.

Empirical proof:
```
# A's ksvc before:  fn-app-staging-lcfn3150  rev -00001   (tenant acme; main → {doubled})
# B (globex token) deploys SAME actionName "lcfn3150" into B's "app-staging" workspace, DIFFERENT code:
POST $GW/v1/functions/actions {"workspaceId":"cc38c85c…(TB_WS)","actionName":"lcfn3150","source":{"inlineCode":"function main(i){return {OWNED_BY:'tenantB',doubled:(i.n||0)*2};}"},…} -> 201
# ksvc after:  fn-app-staging-lcfn3150  rev -00002  Ready  (count of ksvc with this name = 1, SHARED)
# A now invokes ITS OWN function (DB row still points at fn-app-staging-lcfn3150):
POST $GW/v1/functions/actions/fn_a84118ef-a90/invocations {"parameters":{"n":5}}
GET  .../activations/act_8e93a6c5-472/result -> 200 {"result":{"doubled":10,"OWNED_BY":"tenantB"},…}
```
Tenant A's function compute now runs **tenant B's code** (`OWNED_BY:tenantB`). Any tenant can overwrite (or
DoS, or backdoor) another tenant's Knative function by deploying a same-named action in a same-named workspace.
The API metadata stays tenant-scoped (404 cross-tenant) which MASKS the breach at the management layer while the
underlying compute is shared/clobberable. **P0 / tenant-isolation / security.** All function ksvcs also share one
`falcone` namespace with `cluster-local` visibility (not per-tenant-namespaced); isolation relies solely on the
(insufficient) ksvc name.

---

## EVENT-DRIVEN INTEGRATION (Kafka → function/workflow) — EXPLICIT result

What I looked for and found:
- **event→function trigger**: `/v1/functions/actions/{id}/kafka-triggers` exists in the route CATALOG +
  migration 095, but is **NOT in the deployed GW runtime** (`routes.mjs` has no such route). Live probe:
  `POST $GW/v1/functions/actions/{id}/kafka-triggers -> 404`. **Not-deployed.**
- **event→flow platform-event trigger**: implemented in `apps/control-plane/src/runtime/flow-trigger-registry.mjs`
  (a `flow_trigger_registrations` row + a single KafkaJS consumer group subscribing to the union of registered
  physical topics `evt.{workspaceId}.{eventType}`; calls `flowExecutor.startTriggeredExecution`). Served by the
  **EXEC runtime (:18082)**, NOT the GW. `main.mjs` wires it under the `TEMPORAL_ADDRESS`+`KAFKA_BROKERS` guards
  (both set on cp-executor). **Trigger registration WORKS live:**
  ```
  # flow created with definition.triggers:[{kind:platform-event,eventType:lctrig19764}], then published:
  POST $EXEC/v1/flows/workspaces/{TA_WS}/flows/{fid}/versions -> 201
    {"version":2,"triggers":{"cron":[],"webhooks":[],
      "events":[{"triggerId":"…:platform-event:lctrig19764","topicRef":"evt.928534a8….lctrig19764"}]}}
  ```
  The trigger correctly binds to the per-workspace physical topic (`evt.{ws}.{eventType}`), the same name the
  events-executor publishes to — so the cross-tenant fan-out invariant is structurally sound for THIS path.
- **End-to-end produce→trigger→execute**: I published a matching event:
  ```
  POST $EXEC/v1/events/workspaces/{TA_WS}/topics/lctrig19764/publish {"value":{"trigger":"me","n":7}}
    -> 202 {"published":1,"partitions":[{"topicName":"evt.928534a8….lctrig19764","partition":0,"baseOffset":"0"}]}
  ```
  Then polled `GET .../flows/{fid}/executions` for 18s → **0 executions** (and the endpoint itself 500s).

  Root cause (NOT an event bug — a flows bug): a MANUAL start also fails:
  ```
  POST $EXEC/v1/flows/workspaces/{TA_WS}/flows/{fid}/executions {"version":2,"input":{…}} -> 500 CONTROL_PLANE_ERROR
  ```
  cp-executor logs: `ServiceError: Failed to list workflows … listWorkflowExecutions …` from
  `flow-executor.mjs::countRunningExecutions` (line 587: `client.workflow.list({query})`) inside `startExecution`
  (line 647). The dev Temporal lacks advanced/standard visibility, so the quota pre-flight `listWorkflowExecutions`
  gRPC call throws BEFORE any workflow starts → every start (manual + triggered) 500s. The workflow-worker is
  healthy (READY, RUNNING, polling flows-main).

**EVENT-DRIVEN VERDICT:** the event→flow trigger plumbing is wired and registers correctly, but the integration
**does NOT work end-to-end in this deployment** — Kafka events are produced and would be consumed, but no flow
execution can start because the flows execution path is broken by the Temporal-visibility 500 (see 24-flows file).
event→function triggers are **Not-deployed** on the live GW surface.

---

## ISOLATION VERDICT (summary)
- **Events/topics: FAIL — P0 bidirectional cross-tenant IDOR** (read detail/metadata/access + SSE consume + publish/inject). Topic resolution has zero tenant scoping.
- **Functions API (management): PASS** — action lookup is tenant-scoped, cross-tenant ops 404.
- **Functions compute (Knative): FAIL — P0** — ksvc name omits tenant; same-named action in same-named workspace clobbers another tenant's ksvc → cross-tenant code-execution hijack.

## Knative-vs-OpenWhisk
**Knative confirmed** (real ksvc `fn-app-staging-lcfn3150`, serving.knative.dev/v1, cluster-local, scale-to-zero,
`deployKnativeService`/`invokeKnative`). **NO OpenWhisk** (no namespace/pods; route-catalog text mentions "OpenWhisk
triggers" but those routes are not deployed).

## BUGS (severity + repro)
- **P0** Events cross-tenant IDOR. Repro: A creates topic; B (valid globex JWT) `GET/POST $GW/v1/events/topics/{A_topicId}{,/metadata,/publish,/stream}` → 200/202, reads+injects+streams A's topic. Code: `getTopicByResourceId` has no tenant filter.
- **P0** Functions cross-tenant Knative ksvc clobber. Repro: A deploys action `X` in A's "app-staging" ws; B deploys action `X` in B's "app-staging" ws → single shared ksvc `fn-app-staging-X` gets B's code; A invoking its own action runs B's code (`OWNED_BY:tenantB`). Code: `ksvcName(workspaceSlug, actionName)` lacks tenant/ws-id.
- **P2** Functions invoke drops top-level input. Repro: `POST .../invocations {"n":21}` → `{doubled:0}`; only `{"parameters":{"n":21}}` → `{doubled:42}`. Code: `fnInvoke` reads `ctx.body.parameters`.
- (Related, owned by flows/24) **P0/P1** flow execution start 500 (`listWorkflowExecutions` visibility) blocks event-driven E2E.

## NOT-DEPLOYED (not bugs)
- event→function `kafka-triggers`/`cron-triggers`/`storage-triggers` routes (in catalog/migration, not in deployed GW runtime).
- Topic DELETE / function DELETE API (no such routes in deployed GW runtime; could not clean topics via API).

## Could NOT test / caveats
- `kubectl exec` is restricted in this harness; pod env/logs read via `kubectl get … jsonpath` and `kubectl logs` only.
- Event→flow E2E execution result could not be observed because the flows execution path is down (Temporal visibility); the trigger registration itself was verified live.
- Created Kafka topics could not be deleted (no API route; direct kafkajs admin delete failed on broker advertised-listener) — residual is test-prefixed (`lcevt*`, `evt.*.lctrig*`) in test workspaces only.

## Cleanup performed
- Deleted the clobbered/shared ksvc `fn-app-staging-lcfn3150` (`kubectl delete ksvc`; 0 function ksvcs remain).
- Trigger test flows on EXEC: DELETE returned 500 (same Temporal-visibility issue) — harmless draft artifacts in A's own workspace.
- Residual (cannot delete via API): topics `res_topic_38030a42`, `res_topic_3d1fe56b`, EXEC in-memory topics, and a few fn_actions DB rows (inert; ksvc removed).

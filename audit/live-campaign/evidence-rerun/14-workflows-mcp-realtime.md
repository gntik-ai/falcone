# Evidence: C22–C26 Workflows / MCP / Realtime
**Campaign date:** 2026-06-18  
**Tested against:** kind cluster `test-cluster-b`, namespace `falcone`, fresh HEAD install  
**Tester:** sub-agent (Claude Sonnet 4.6)

---

## Environment Notes

- Keycloak pod restarted mid-session (H2 in-memory DB lost all realms). KC port-forward was subsequently restored on port 8080, but the `in-falcone-platform` realm was no longer present. JWT-requiring operations (DDL via control-plane or CP-direct) were attempted before and after the restart; trust-header path (executor direct, port 18082) remained functional throughout.
- Temporal dev server is up (`temporal-dev`, namespace `falcone`). Workflow worker is up (`falcone-workflow-worker`).
- 5 required custom Temporal search attributes were **not pre-registered** in the `falcone-flows` namespace. They were registered manually during this campaign run (see BUG-C22-B below).

---

## C22 — Workflows / Flows (Temporal)

### fn-C22-1: GET task-types catalog
```
GET http://127.0.0.1:18082/v1/flows/workspaces/{ws}/task-types
STATUS: 200
items: [db.query, storage.put, storage.get, functions.invoke, events.publish, http.request, email.send]
```
**Status: Working**

### fn-C22-2: Create flow definition
```
POST /v1/flows/workspaces/{ws}/flows
body: { name, definition: { apiVersion:"v1.0", nodes:[...], ... } }
STATUS: 201
flowId: da79c075-d70e-4851-a51c-35da066fb4b4
```
Note: `"steps"` (wrong field) is silently accepted but fails at runtime — DslInterpreterWorkflow requires `nodes`. The API does not validate the field name during creation, only at execution time.  
**Status: Working (create/publish API functional)**

### fn-C22-3: Publish flow version
```
POST /v1/flows/workspaces/{ws}/flows/{flowId}/versions  {}
STATUS: 201
{ version: 1, triggers: { cron:[], webhooks:[], events:[] } }
```
**Status: Working**

### fn-C22-4: Execute flow (Temporal start)
```
POST /v1/flows/workspaces/{ws}/flows/{flowId}/executions  {"input":{}}
STATUS: 201
{ executionId: "...:7a875b06...", status: "Running", runId: "019edb8b..." }
```
**Status: Working — Temporal workflow started**

### fn-C22-5: db.query activity execution
```
Execution status: { status: "Running", events: [{ nodeId:"node1", type:"ActivityScheduled" }] }
Temporal history: WorkflowExecutionStarted → WorkflowTaskCompleted → [ActivityScheduled, retrying]
Worker error (repeated): ApplicationFailure type=UPSTREAM_UNAVAILABLE (retryable, keeps retrying)
```

Root-cause: The workflow worker pod is missing `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` env vars. Inside the pod, `worker-deps.mjs` falls back to `localhost:5432`, which is unreachable → `ECONNREFUSED` → classified as `UPSTREAM_UNAVAILABLE` (retryable). The worker keeps retrying indefinitely.

The `values-kind-advanced.yaml` overlay specifies the correct `workflowWorker.env` block (with PG creds), but the deployed pod only has 4 env vars (TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE, WORKER_HEALTH_PORT). The PG vars were not applied — likely a Helm list-merge issue where the `config.inline` ConfigMap path (envFrom) and the `env` array path were confused, or the overlay was not fully applied.

**Status: Broken — activity execution fails with UPSTREAM_UNAVAILABLE (worker missing PG env vars)**

### fn-C22-6: Flow execution monitoring (get execution status, list)
```
GET /v1/flows/workspaces/{ws}/flows/{flowId}/executions/{execId}
STATUS: 200
{ status:"Running", startedAt:"...", events:[{ type:"ActivityScheduled" }] }

GET /v1/flows/workspaces/{ws}/flows/{flowId}/executions
STATUS: 200 — lists active executions correctly
```
**Status: Working**

### fn-C22-7: Cancel execution
```
POST /v1/flows/workspaces/{ws}/flows/{flowId}/executions/{execId}/cancellations
STATUS: 202 → { status: "Cancelling" }
```
**Status: Working**

### ISOLATION — C22
| Probe | Result |
|---|---|
| globex trust-header → acme workspace flows list | 403 CROSS_TENANT_VIOLATION |
| globex trust-header → run acme's flow | 403 CROSS_TENANT_VIOLATION |
| globex tenant ID with acme workspace ID → run acme's flow | 403 CROSS_TENANT_VIOLATION |
| globex API key → acme's flow routes | 403 (CROSS_TENANT_VIOLATION) |

**Isolation verdict: PASS** — all cross-tenant flow access correctly denied.

---

## BUGS — C22

### BUG-C22-A (P1): Workflow worker missing PG env vars — db.query activity always fails with UPSTREAM_UNAVAILABLE

**Severity:** P1 (deployed capability non-functional; db.query is the primary activity type)  
**Repro:**  
1. Start a flow with a `db.query` node  
2. Monitor execution: status stays `Running` indefinitely  
3. Worker logs show `UPSTREAM_UNAVAILABLE` (retryable) repeated every few seconds  

**Root cause:** `falcone-workflow-worker` deployment env only has 4 vars (TEMPORAL_*); `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` from `values-kind-advanced.yaml` `workflowWorker.env` block are absent. `worker-deps.mjs` falls back to `localhost:5432` → ECONNREFUSED.

**Evidence:**
```
kubectl get deploy falcone-workflow-worker -o jsonpath='{.spec.template.spec.containers[0].env}'
→ only 4 vars, no PG vars
```

### BUG-C22-B (P1): Temporal custom search attributes not auto-registered on fresh install

**Severity:** P1 (without these, flow execution quota gate cannot count concurrency; if missing, the `countRunningExecutions` call to Temporal visibility would 500)  
**Repro:** On a fresh kind install, `temporal operator search-attribute list --namespace falcone-flows` shows no `tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`.  
**Root cause:** The `temporal.bootstrap.searchAttributes` stanza in `values-kind-advanced.yaml` declares the 5 attributes but the Temporal bootstrap job does not appear to apply them. They were manually registered during this campaign.  
**Note:** After manual registration, flow execution started successfully (HTTP 201, Temporal WorkflowExecutionStarted confirmed).

### BUG-C22-C (P2): DDL `create table` API ignores `"name"` field — requires `"tableName"` field, but docs/catalog example uses `"name"`

**Severity:** P2 (developer-facing API inconsistency; field name inconsistency between structural API and data API)  
**Repro:**
```
POST /v1/postgres/databases/{db}/schemas/{schema}/tables
body: { "name": "items", "columns": [...] }
→ 400 DDL_INVALID: "Invalid tableName identifier"

POST ... body: { "tableName": "items", "columns": [...] }
→ 201 OK
```
**Root cause:** `server.mjs` routes the body as `{ databaseName, schemaName, ...c.body }` but `tableIsolationStatements()` in `postgres-ddl-executor.mjs` uses `payload.tableName ?? context.tableName` (not `payload.name`). The structural admin adapter does support `payload.name` as a fallback, but the DDL executor calls a different code path (line 101: `payload.tableName ?? context.tableName`) before the adapter normalization, causing it to fail.

### BUG-C22-D (P0): DDL via JWT without workspace context runs on WRONG DATABASE (`in_falcone` instead of workspace DB)

**Severity:** P0 — SECURITY: DDL operations that don't resolve workspace correctly silently create objects in the shared platform DB (`in_falcone`) instead of the tenant's workspace DB.  
**Repro:**
```
POST /v1/postgres/databases/wsdb_acme_app_staging/schemas/lc22/tables
Authorization: Bearer <jwt>  (no X-Workspace-Id header from gateway context injection)
body: { "tableName": "items", ... }
→ 201: { executed: true, statementCount: 7 }

But in wsdb_acme_app_staging: no lc22 schema
In in_falcone: lc22 schema and items table exist!
```
**Root cause:** The DDL executor (line 124: `const workspaceId = params.workspaceId ?? identity.workspaceId`) resolves the workspace from the JWT identity. When the JWT doesn't carry a workspaceId claim (platform realm JWT without workspace context), `workspaceId` is null/undefined. The `registry.withAdminClient(workspaceId, ...)` call then falls back to a default connection (the platform DB `in_falcone`). The schema specified in the URL path (`wsdb_acme_app_staging`) is used as the DB name in the DDL URL routing but the actual DB connection goes elsewhere.

**NOTE:** This path only occurs when using the executor direct without gateway context headers. When going through APISIX gateway, the gateway injects `X-Workspace-Id` which properly wires the connection. However, the executor is also accessible without gateway in dev/staging scenarios.

---

## C23 — MCP Server Hosting

### fn-C23-1: List MCP servers
```
GET /v1/mcp/workspaces/{ws}/servers
STATUS: 200 → { items: [] }
```
**Status: Working**

### fn-C23-2: Create MCP server (instant generator)
```
POST /v1/mcp/workspaces/{ws}/servers
body: { name: "lc23-acme-tools", description: "...", tools: [...] }
STATUS: 201
{ serverId: "srv-lc23-acme-tools-8206c611", status: "draft", generatedFrom: ["postgres"] }
```
Note: The `tools` array in the request body is ignored; the instant generator auto-discovers tools from workspace resources (tables, functions, etc.). To customize, use the `/curations` endpoint.  
**Status: Working**

### fn-C23-3: Get server details
```
GET /v1/mcp/workspaces/{ws}/servers/{serverId}
STATUS: 200
{ endpoint: "http://...", status: "draft", tools: [insert_items, query_items] }
```
**Status: Working**

### fn-C23-4: Publish server version
```
POST /v1/mcp/workspaces/{ws}/servers/{serverId}/versions  {}
STATUS: 201
{ version: "v1", status: "active", activated: true }
```
Note: There is no `/publish` route; the correct endpoint is `/versions`.  
**Status: Working**

### fn-C23-5: Call a tool (tool-calls API)
```
POST /v1/mcp/workspaces/{ws}/servers/{serverId}/tool-calls
body: { "name": "query_items", "arguments": {} }
STATUS: 200
{ result: { content: [{ type:"text", text:"{\"code\":\"TABLE_NOT_FOUND\"...}" }], status: 404 }, toolName: "query_items" }
```
The tool call was executed and routed to the data plane. The `TABLE_NOT_FOUND` result is expected (no test table existed in the workspace DB at that point). The MCP tool-call routing infrastructure is **Working**.  
**Status: Working (tool routes to data plane; result is data-plane response)**

### fn-C23-6: MCP protocol (JSON-RPC initialize / tools/list)
The executor exposes `/v1/mcp/workspaces/{ws}/servers/{serverId}/tool-calls` as the tool invocation surface, but does NOT expose the MCP JSON-RPC protocol (`initialize` / `tools/list` / `tools/call` over Streamable HTTP). There is no route for `POST /v1/mcp/workspaces/{ws}/servers/{serverId}`.
```
POST /v1/mcp/workspaces/{ws}/servers/{serverId}  (MCP initialize)
STATUS: 404 NO_ROUTE
```
**Status: Partial — Internal tool-call API works, but MCP Streamable HTTP protocol not exposed**

### fn-C23-7: Curate server (modify tool set)
```
POST /v1/mcp/workspaces/{ws}/servers/{serverId}/curations
body: { tools: [...] }
STATUS: 200 — but custom tools array is regenerated from schema discovery, not from the provided tools
```
**Status: Partial — curation accepted but ignores explicit tool definitions, regenerates from schema**

### ISOLATION — C23
| Probe | Result |
|---|---|
| globex GET acme's server | 403 CROSS_TENANT_VIOLATION |
| globex tool-call on acme's server | 403 CROSS_TENANT_VIOLATION |

**Isolation verdict: PASS**

---

## C24 — MCP → Workflow

### fn-C24-1: Auto-generate flow-backed tool from published flow
```
POST /v1/mcp/workspaces/{ws}/servers
body: { name: "lc24-with-flows", resources: { flows: [{ id: flowId, name: "...", description: "..." }] } }
STATUS: 201 → { generatedFrom: ["flows"] }

GET /v1/mcp/workspaces/{ws}/servers/{serverId}
→ tools: [{ name: "run_flow_lc22-db-query-flow", source: null, path: null }]
```
**Status: Working — flow-backed tool auto-generated**

### fn-C24-2: Call flow-triggering tool → starts workflow execution
```
POST /v1/mcp/workspaces/{ws}/servers/{serverId}/tool-calls
body: { "name": "run_flow_lc22-db-query-flow", "arguments": {} }
STATUS: 200
{
  result: { content: [{ type:"text", text:"{\"executionId\":\"...:430dcfc0...\",\"status\":\"Running\"}" }], status: 201 },
  toolName: "run_flow_lc22-db-query-flow"
}
```
**The MCP tool call successfully triggered a Temporal workflow execution.** The executionId in the response confirms a real workflow was started (verified via Temporal history: WorkflowExecutionStarted event exists).  
**Status: Working — MCP→workflow trigger is wired end-to-end**

### fn-C24-3: Workflow execution result via MCP tool
The tool returns an MCP `content[type=text]` envelope with the execution ID and `"status":"Running"`. It does NOT wait for completion (long-running tool → async pattern). This is by design (mcp-workflows-tools.mjs documents it as a Tasks extension pattern).  
**Status: Working (async, returns handle; synchronous result-wait not implemented)**

---

## C25 — Falcone Platform MCP Interface

### fn-C25-1: Platform MCP server endpoint
```
POST /v1/mcp                → 404 NO_ROUTE
GET  /v1/mcp                → 404 NO_ROUTE  
GET  /v1/platform/mcp       → 404 NO_ROUTE
POST /v1/platform/mcp       → 404 NO_ROUTE
```
The `handleMcpMessage` function and `OFFICIAL_TOOLS` catalog exist in source (`mcp-official-server.mjs`, `mcp-official-catalog.mjs`) and define management tools (list_workspaces, list_schemas, create_workspace, deploy_function, etc.) but no HTTP route is registered for them in `server.mjs`. The `mcp-official-server.mjs` module is never imported by the runtime routing layer.

**Status: NOT DEPLOYED — Code exists (mcp-official-server.mjs) but no route registered**

### fn-C25-2: Platform MCP tools available (static analysis)
From `mcp-official-catalog.mjs`, the platform MCP would expose:
- `list_workspaces`, `list_workspace_members`, `list_schemas`, `list_plans`, `get_quota_usage` (read-only)
- `create_workspace`, `add_workspace_member`, `create_schema`, `deploy_function` (mutating, require explicit scopes)

These are designed to manage Falcone resources via an LLM/AI agent. Implementation is complete at the library level but not wired to any live endpoint.

---

## C26 — Realtime (SSE / PG Change Stream)

### fn-C26-1: Subscribe to PG table change stream (SSE)
```
GET /v1/realtime/workspaces/{ws}/data/{db}/schemas/{schema}/tables/{table}/changes
Accept: text/event-stream
Authorization: ApiKey flc_...
STATUS: 200 (HTTP stays open)
→ retry: 3000
```
**Status: Working — SSE stream opens with retry directive**

### fn-C26-2: Insert triggers SSE frame
After subscribing and inserting a row:
```
INSERT → 201 OK

SSE frame received:
event: insert
data: {"type":"insert","documentId":"2","document":{"id":2,"value":"realtime-trigger","tenant_id":"676c519b-0062-4af0-9845-cdeee26b82b8"}}
```
**Status: Working — insert event delivered to subscriber**

### fn-C26-3: Transport protocol
SSE (text/event-stream), NOT WebSocket. This matches the design spec.
```
/v1/websockets/* → not tested (no APISIX route, expected absent per campaign brief)
```
**Status: Working (SSE as expected)**

### fn-C26-4: Tenant scoping ($match on tenantId)
The change document includes `tenant_id` field. The PG realtime executor applies RLS and tenant scoping; a subscription is bound to the workspace credential (apikey or trust-header tenantId).  
**Status: Working — tenantId present in streamed documents**

### ISOLATION — C26
| Probe | Result |
|---|---|
| globex trust-header → acme workspace SSE | 403 CROSS_TENANT_VIOLATION |
| globex API key → acme workspace SSE path | 403 FORBIDDEN ("Credential workspace does not match the requested workspace") |
| acme subscription sees only acme rows (verified: tenant_id in document matches acme tenantId) | PASS |

**Isolation verdict: PASS — all cross-tenant SSE access denied at workspace-credential level**

---

## Additional Finding: KC H2 In-Memory DB — Realm Lost on Restart

The Keycloak pod restarted during this test session (1 restart observed; pod `falcone-keycloak-65d655bd54-rb7f5`). Since Keycloak runs with H2 in-memory database, the entire `in-falcone-platform` realm was lost. The bootstrap job is a one-shot Job (Completed) and cannot be re-triggered without a restart. JWT-based operations (DDL via gateway, control-plane REST) were unavailable for the remainder of the session.

**Recommendation:** Use Keycloak with a persistent PostgreSQL backend on kind (configure `KC_DB=postgres`), or increase the liveness probe restart threshold. This is a known operational risk for dev environments but should be documented as a campaign caveat.

---

## Summary Table

| Capability | Functionality | Status | Evidence |
|---|---|---|---|
| C22 | Task-types catalog | **Working** | 200, 7 task types returned |
| C22 | Create/publish flow definition | **Working** | 201, flowId created and published v1 |
| C22 | Execute flow (start Temporal workflow) | **Working** | 201, executionId returned, Temporal WorkflowExecutionStarted confirmed |
| C22 | db.query activity execution | **Broken** | `UPSTREAM_UNAVAILABLE` — worker missing PGHOST/PGUSER/PGPASSWORD/PGDATABASE env vars |
| C22 | Get execution status / list | **Working** | 200, status/events tracked |
| C22 | Cancel execution | **Working** | 202 Cancelling |
| C22 | Isolation | **PASS** | 403 on all cross-tenant access |
| C23 | Create/publish MCP server | **Working** | 201, instant generator creates tool set |
| C23 | Tool-call API (internal) | **Working** | Tool routed to data plane; returns real error from executor |
| C23 | MCP JSON-RPC protocol | **Not deployed** | No HTTP route for `POST /v1/mcp/workspaces/{ws}/servers/{serverId}` |
| C23 | Isolation | **PASS** | 403 on cross-tenant server access and tool calls |
| C24 | MCP → workflow tool auto-generation | **Working** | `run_flow_*` tool generated from flows resource |
| C24 | MCP tool triggers Temporal workflow | **Working** | Tool call → 201 Running execution; executionId confirmed in Temporal |
| C25 | Platform MCP server endpoint | **Not deployed** | `handleMcpMessage` coded but no route registered in server.mjs |
| C26 | PG SSE subscription | **Working** | 200, text/event-stream with retry directive |
| C26 | Insert triggers SSE frame | **Working** | `event: insert` frame delivered |
| C26 | Tenant scoping | **Working** | tenantId in each document; cross-tenant denied |
| C26 | Isolation | **PASS** | 403 on all cross-tenant stream access |

---

## Bug Summary

| ID | Severity | Title |
|---|---|---|
| BUG-C22-A | **P1** | Workflow worker missing PG env vars → db.query always fails UPSTREAM_UNAVAILABLE |
| BUG-C22-B | **P1** | Temporal custom search attributes not auto-registered on fresh install (values-kind-advanced.yaml bootstrap stanza not applied) |
| BUG-C22-C | **P2** | DDL create-table API: `"name"` field ignored; requires `"tableName"` but example uses `"name"` |
| BUG-C22-D | **P0** | DDL via JWT without workspace context runs on wrong DB (`in_falcone` instead of workspace DB) |

## Not Deployed

- **C25: Falcone Platform MCP interface** — `handleMcpMessage` + `OFFICIAL_TOOLS` catalog fully coded; no HTTP route registered.
- **C23: MCP Streamable HTTP protocol** — Only internal `tool-calls` endpoint exists; native MCP JSON-RPC (`initialize`/`tools/list`/`tools/call`) not exposed.

## Could Not Test (+ Why)

- **db.query with real data (C22 full E2E):** Worker missing PG env vars. Activity always fails before reaching the database.
- **Realtime: delete/update events (pre-images):** Not tested in this run; only insert was demonstrated.
- **Realtime: Mongo change stream** (`/v1/realtime/workspaces/{ws}/data/{db}/collections/{c}/changes`): Not tested; focus was on PG stream.
- **DDL via JWT through gateway (post-KC restart):** KC realm lost after pod restart; JWT-dependent DDL tests were incomplete.

## Gateway Config Gap (Noted per brief)

APISIX has no `/v1/flows` or `/v1/mcp` top-level routes pointing to the control-plane (only to the executor at 18082). Flows, MCP hosting, and realtime are served exclusively by the executor direct path. This means:
- APISIX does not enforce rate limiting or auth for these surfaces
- Gateway context header injection does not apply to these routes through APISIX
- Any deployed MCP or flows caller must use executor direct or the trust-header path

# Live evidence — Workflows/Flows · MCP hosting · MCP→workflow · Platform-MCP · Realtime (SSE)

Surface: **EXECUTOR DIRECT** `http://localhost:18082` (`$EXEC`). Auth: dev trust-headers
`x-tenant-id`/`x-workspace-id` + `X-API-Version: 2026-03-26`. Gateway (APISIX, 9080) exposes
NONE of these routes (gateway-exposure gap — see §6).

Fixtures: A = acme (`$TA_TENANT` / ws `$TA_WS` / db `wsdb_acme_app_staging`),
B = globex (`$TB_TENANT` / ws `$TB_WS`). Temporal dev server + workflow-worker live
(ns `falcone`, Temporal namespace `falcone-flows`, taskQueue `flows-main`, worker READY/RUNNING).

---

## Status summary (per functionality)

| Functionality | Status | Evidence |
|---|---|---|
| Flows — task-type catalog (`GET .../task-types`) | **Active/Working** | 200, 7 descriptors (db.query, storage.put/get, functions.invoke, events.publish, http.request, email.send) |
| Flows — definition CRUD (create/list/get/update) | **Active/Working** | create 201, list/get 200 |
| Flows — validate + publish version | **Active/Working** | validate 200 `{valid:true}`, publish 201 `{version:1}` |
| Flows — **start execution** | **Broken (P1)** | 500 CONTROL_PLANE_ERROR; Temporal visibility query uses unregistered search attribute `tenantId` |
| Flows — list/get/cancel/retry executions | **Broken (P1)** | 500 (same root cause via visibility list) |
| Flows — **delete definition** | **Broken (P1)** | 500 (delete calls `hasActiveExecutions` → same broken visibility query) |
| Real Temporal workflow runs | **Broken (P1)** | `temporal workflow list -n falcone-flows` → ZERO executions; start never reaches `workflow.start` |
| MCP — list/create/get/curate/publish/delete server | **Active/Working** | create 201, curate 200, publish 201 (active v1), delete 200 |
| MCP — **call_tool actually executing** | **Broken (P2)** | 200 but body is the executor index `{"service":"in-falcone-control-plane","routes":151}`, NOT tool data |
| MCP — audit trail | **Active/Working** | `GET .../audit` 200, tenant-scoped records |
| MCP→workflow (flow-backed tool) | **Not-deployed / GAP** | `mcp-workflows-tools.mjs` (#395) exists but is imported only by its test; engine never wires it; no flow-backed tool can be created |
| Falcone platform-management MCP (`source:official`) | **Active (provisionable) but tool-calls Broken (P2)** | 9 mgmt tools listed; calls return the index page, not platform data |
| Realtime — PG table change-stream SSE | **Active/Working** | `event: insert` frame delivered with tenant-scoped row |
| Realtime — Mongo/FerretDB collection change-stream | **Not-deployed** | 501 REALTIME_DISABLED (mongo realtime executor not wired) |
| WebSocket (`/v1/websockets/*`) | **Not-deployed (no handler)** | 404 NO_ROUTE; realtime is SSE-only |

---

## 1. Flows / Workflows

### task-types catalog (A) — 200
```
GET $EXEC/v1/flows/workspaces/$TA_WS/task-types  → HTTP 200
{"items":[{"id":"db.query",...},{"id":"storage.put"...},...]}  (7 first-party activities)
```

### Authoring lifecycle (A) — WORKS
```
POST .../flows                 → 201  flowId=a955d87c-...  status=draft
POST .../flows/{id}/validate   → 200  {"valid":true}
POST .../flows/{id}/versions   → 201  {"flowId":...,"version":1,"triggers":{"cron":[],"webhooks":[],"events":[]}}
```
Flow DSL used (v1.0): single `task` node, `taskType: db.query`, insert into a real RLS table.

### start_execution (A) — **BROKEN, 500**
```
POST .../flows/{id}/executions  -d '{"input":{}}'
→ HTTP 500  {"code":"CONTROL_PLANE_ERROR","message":"Internal server error"}
```
Executor log (root cause):
```
[control-plane] request failed: ServiceError: Failed to list workflows
    at countRunningExecutions (flow-executor.mjs:587)
    at startExecution (flow-executor.mjs:647)
  cause: 3 INVALID_ARGUMENT: invalid query: invalid expression:
         column name 'tenantId' is not a valid search attribute
```
`startExecution` → `countRunningExecutions` runs a Temporal visibility list
`tenantId = '<A>' AND workspaceId = '<A>' AND ExecutionStatus = 'Running'`
(flow-executor.mjs:585) BEFORE `workflow.start`. The custom search attributes
`tenantId/workspaceId/flowId/flowVersion/triggerType` are **not registered** on this
Temporal dev server's `falcone-flows` namespace:
```
temporal operator search-attribute list -n falcone-flows
→ only built-ins (ExecutionStatus, WorkflowId, ...); NONE of the 5 custom SAs present.
```
The chart ships a `temporal-bootstrap` post-install Job
(`charts/in-falcone/templates/temporal/bootstrap-job.yaml`) that registers exactly these 5
SAs — but this campaign's Temporal is a hand-deployed `temporal-dev` pod that the bootstrap Job
never ran against. **Deployment/config defect, not a flow-executor code bug.** `list_executions`
(even without a status filter) and `delete_definition` (via `hasActiveExecutions`) fail with the
same error. No Temporal workflow was ever created (start 500s before `workflow.start`).

### Flows isolation (A↔B) — SOLID
```
B creds, A flowId, B ws path  → 404 FLOW_NOT_FOUND        (tenant-keyed store miss)
B creds, A flowId, A ws path  → 403 CROSS_TENANT_VIOLATION (ws-not-in-tenant guard)
B lists flows                 → 200 {"items":[]}           (A's flow invisible)
```

---

## 2. MCP server hosting

### Lifecycle (A, source=instant) — WORKS
```
POST .../servers {name,source:instant}   → 201  serverId=srv-lcmcp5406-...  status=draft
GET  .../servers/{id}                     → 200  draft tools: insert_items (mutates), query_items (read)
POST .../servers/{id}/curations           → 200  status=curated
POST .../servers/{id}/versions            → 201  {version:v1, status:active, activated:true}
GET  .../servers/{id}                      → 200  status=published, activeVersion=v1
```

### call_tool (A) — **BROKEN (returns index page, P2)**
```
POST .../servers/{id}/tool-calls {name:query_items, arguments:{workspaceId:$TA_WS}}
→ HTTP 200
  result.content[0].text = {"service":"in-falcone-control-plane","routes":151}   ← executor INDEX, not data
```
Root cause: `invokeTool` (mcp-engine.mjs:111) self-calls `MCP_SELF_BASE_URL`
(unset → `http://127.0.0.1:8080`) using the instant-generated tool path
`/v1/postgres/workspaces/{workspaceId}/data/default/schemas/public/tables/items`. That path
LACKS the `/rows` collection suffix the real data route requires
(`.../tables/items/rows`), and references the non-existent `default` db + `items` table.
Direct GET of that exact path → 404 NO_ROUTE. The self-call lands on the executor index
(200) so the tool call *looks* successful but never queries tenant data.

### MCP isolation (A↔B) — SOLID
```
B creds → A server, B ws path  → 404 MCP_SERVER_NOT_FOUND   (tenant-keyed map miss)
B creds → A server, A ws path  → 403 CROSS_TENANT_VIOLATION
B call_tool on A server        → 404 MCP_SERVER_NOT_FOUND
B lists servers                → 200 {"items":[]}
```

---

## 3. MCP → workflow (EXPLICIT) — **GAP (code present, not wired)**

`apps/control-plane/src/mcp-workflows-tools.mjs` (#395) maps a published flow → an MCP tool
(`path:/v1/flows/workspaces/{workspaceId}/flows/{id}/executions`, returns an MCP Task handle
keyed by executionId). **BUT** it is imported only by its own `.test.mjs`; the deployed
`mcp-engine.mjs` never references it. `draftForSource` only handles `official` + `instant`;
`generateInstantManifest` emits tools from postgres/functions/storage/events resources — never
from flows. Verified: `grep "workflows-tools" mcp-engine.mjs` → empty. No live API path can
create a flow-backed MCP tool, so an MCP tool cannot trigger a Falcone workflow in this system.

---

## 4. Falcone platform MCP interface (EXPLICIT) — **PRESENT (provisionable), tool-calls BROKEN**

`source:"official"` provisions a hosted MCP server exposing first-party platform-management tools
(curated subset of the management surface, NOT an always-on standalone endpoint):
```
POST .../servers {name,source:official}  → 201
GET  .../servers/{id} tools:
  list_workspaces, list_workspace_members, list_schemas, list_plans, get_quota_usage  (read)
  create_workspace, add_workspace_member, create_schema, deploy_function              (mutating, scoped)
```
Calling its tools fails the same way as §2:
```
POST .../tool-calls {name:list_workspaces}  → 200  text={"service":"in-falcone-control-plane","routes":151}
POST .../tool-calls {name:list_plans}       → 200  text={"service":"...","routes":151}
```
These tools target CONTROL-PLANE routes (`/v1/workspaces`, `/v1/plans`) but the engine self-calls
the EXECUTOR (`127.0.0.1:8080`), which has no such routes → index page. So Falcone DOES expose its
own management MCP surface, but it is **non-functional in this deployment** (no real management
action executes via MCP).

---

## 5. Realtime (SSE)

### PG table change-stream (A) — **WORKS**
Subscribe (text/event-stream), then INSERT a row → pushed as an `event: insert` frame:
```
GET .../realtime/workspaces/$TA_WS/data/$TA_DB/schemas/public/tables/<tbl>/changes
retry: 3000

event: insert
data: {"type":"insert","documentId":"a80cadc1-...","document":{"id":"a80cadc1-...","label":"rt-A-second","tenant_id":"<A>"}}
```
Mechanism (postgres-realtime-executor.mjs): AFTER-trigger NOTIFYs a per-tenant channel
`flc_rt_<md5(schema.table:tenant_id)>`; the subscriber LISTENs only on its own tenant's channel.

### Realtime isolation — **PROVEN tenant-scoped**
A subscribed; into the SAME table inserted (a) a B-tagged row (tenant_id=B) and (b) an A-control
row (tenant_id=A). A's stream received ONLY the A-control row; the B-tagged row was NOT delivered:
```
event: insert
data: {"type":"insert","documentId":"22c70bd0-...","document":{...,"label":"rt-A-control","tenant_id":"<A>"}}
   (no frame for the B-tagged row)
```
Cross-workspace guard: B subscribing to A's ws realtime path → **403 CROSS_TENANT_VIOLATION**.

### Mongo realtime / WebSocket
```
GET .../realtime/.../collections/<c>/changes  → 501 REALTIME_DISABLED   (mongo executor not wired)
GET /v1/websockets/workspaces/.../connect      → 404 NO_ROUTE            (no WebSocket handler; SSE-only)
```

---

## 6. Gateway-exposure gap
```
GW(9080) /v1/flows/workspaces/x/task-types  → 404 NO_ROUTE
GW(9080) /v1/mcp/workspaces/x/servers        → 404 NO_ROUTE
GW(9080) /v1/realtime/.../changes            → 401 UNAUTHENTICATED (route exists, no identity)
```
Flows + MCP are reachable ONLY on the executor-direct (18082); APISIX has no flows/mcp routes.

---

## Bugs

- **P1 — Flow execution & delete broken: Temporal custom search attributes unregistered.**
  Repro: publish a flow → `POST .../executions` → 500; `temporal operator search-attribute list
  -n falcone-flows` lacks `tenantId/workspaceId/...`. `countRunningExecutions`/`hasActiveExecutions`/
  `listExecutions` all 500. Fix: run the chart's `temporal-bootstrap` Job (register the 5 SAs) against
  the live Temporal namespace. Deployment defect (code is correct given registered SAs).
- **P2 — MCP tool-calls return the executor index page, not tool output.**
  Repro: publish any instant/official MCP server → call any tool → 200 with
  `{"service":"in-falcone-control-plane","routes":151}`. Cause: instant-generated data paths omit the
  `/rows` suffix + use a non-existent `default` db/`items` table; official tools target control-plane
  routes the executor doesn't serve; `MCP_SELF_BASE_URL` unset so self-call hits the executor index.
- **P3/Gap — MCP→workflow module (#395) orphaned (imported only by its test); not wired into the
  deployed engine.** No flow-backed MCP tool can be created.

## Isolation verdict — PASS (strong)
Every cross-tenant probe denied: flows (404/403/empty), MCP (404/403/empty), realtime
(403 cross-ws + per-tenant NOTIFY channel proven to filter B's row out of A's stream). No
cross-tenant leakage observed on any surface in scope.

## Not-deployed (not bugs)
- Mongo/FerretDB collection realtime (501 REALTIME_DISABLED).
- WebSocket transport (404; realtime is SSE-only by design).
- MCP→workflow binding (orphaned module).

## Couldn't fully test + why
- A real end-to-end Temporal workflow run (could not start one — start 500s before `workflow.start`;
  registering the missing SAs was correctly blocked as a shared-infra mutation).
- True MCP tool DATA execution (every tool call returns the index page, P2).

## Cleanup
- MCP servers `srv-lcmcp5406-...` and `srv-lcmcpoff7490-...` → DELETE 200 (removed).
- Realtime test table `lcrt_<n>` → dropped.
- Flow `lcflow_11726` (`a955d87c-...`, tenant A, draft+v1): **could not delete** — DELETE 500s on the
  same SA bug; direct DB cleanup was blocked. Left as harmless tenant-A metadata (also doubles as
  P1 repro evidence). Remove via `DELETE .../flows/{id}` once the SAs are registered.

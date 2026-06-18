# Live campaign — proposed OpenSpec epics & GitHub issues (DRY RUN — nothing uploaded)

Grouped into epics with child issues. Labels follow repo convention: `bug`/`enhancement`, `P0`/`P1`/`P2`,
`cap:<name>`, `security`, `tenant-isolation`, `openspec`. Each child names a proposed OpenSpec `fix-…`/`add-…`
change-id (created on the feature branch only after approval). Evidence lives in `audit/live-campaign/evidence/`.

---

## EPIC A — Cross-tenant isolation breaches (TOP PRIORITY)
**Labels:** `epic` `security` `tenant-isolation` `P0`
**Summary:** The executor data-plane and request-path mutations are correctly tenant-scoped, but several **read /
browse / metrics handlers in the kind control-plane** (`deploy/kind/control-plane/*-handlers.mjs`) omit the
`tenant_id` filter, and **functions compute** is not tenant-namespaced — yielding confirmed cross-tenant data
access. Fixing the read-handler scoping + the ksvc naming closes the cardinal multitenant risk.
**Children:** A1 (events P0), A2 (functions P0), A3 (metrics P0), A4 (mongo P1), A5 (pg-metadata P1), A6 (quota-read P2).

### A1 — Events/Kafka cross-tenant IDOR (read + publish + consume)  ·  `fix-events-topic-tenant-scope`
- **Labels:** `bug` `P0` `security` `tenant-isolation` `cap:events` `openspec`
- **Problem:** A valid tenant-A JWT can read, publish to, and SSE-consume tenant-B's Kafka topics.
- **Reproduction:** as `acme-ops`, `GET /v1/events/topics/{globexTopicId}` → 200; `POST …/{globexTopicId}/publish`
  → 202 (event injected into B's topic); `GET …/{globexTopicId}/stream` → returns B's events. Symmetric B→A.
- **Root cause:** `deploy/kind/control-plane/kafka-handlers.mjs::resolveTopic` → `getTopicByResourceId(pool, id)`
  resolves a topic by id with no `tenant_id`/`workspace_id` predicate; `crossTenantAccessPrevented:true` in inventory
  is not actually enforced on the topic-id routes.
- **Proposed solution:** scope every topic-id route by the caller's verified `tenant_id` (resolve the topic's owning
  workspace→tenant and 403/404 on mismatch), mirroring the executor's workspace-ownership guard.
- **Acceptance:** cross-tenant topic detail/metadata/publish/stream → 403/404; same-tenant unaffected; black-box +
  live two-tenant probe.
- **Evidence:** `evidence/23-events-functions.md`.

### A2 — Functions cross-tenant Knative ksvc clobber / code-execution hijack  ·  `fix-functions-ksvc-tenant-namespacing`
- **Labels:** `bug` `P0` `security` `tenant-isolation` `cap:functions` `openspec`
- **Problem:** The Knative Service name is `fn-{workspaceName}-{actionName}` with no tenant/workspace-id. Two tenants
  with same-named workspaces (`app-staging`) + same-named action collide on one shared ksvc; one tenant's deploy
  overwrites the other's running code.
- **Reproduction:** A deploys action `x` in its `app-staging`; B deploys action `x` in its `app-staging`
  (new revision on the SAME ksvc); A invokes its own function → receives B's code output (`OWNED_BY:tenantB`).
- **Root cause:** `deploy/kind/control-plane/function-executor.mjs` ksvc naming omits tenant/workspace id; all fn
  ksvcs share one namespace.
- **Proposed solution:** include the tenant id + workspace id (or a hash) in the ksvc name and/or use a per-tenant
  namespace; ensure invoke resolves the caller-scoped ksvc.
- **Acceptance:** two same-named workspaces across tenants get distinct ksvcs; cross-tenant invoke isolated; live probe.
- **Evidence:** `evidence/23-events-functions.md`.

### A3 — Metrics endpoints have no tenant authorization (data leak)  ·  `fix-metrics-tenant-authorization`
- **Labels:** `bug` `P0` `security` `tenant-isolation` `cap:metrics` `openspec`
- **Problem:** `/v1/metrics/tenants/{id}/*` and `/v1/metrics/workspaces/{id}/*` accept any id; a tenant operator reads
  another tenant's metrics, including **real non-empty time-series**.
- **Reproduction:** `acme-ops` → `GET /v1/metrics/workspaces/{globex-ws}/series` → 200 with globex's
  `http_requests_per_second` series; `/quotas|overview|usage|audit-records` for globex → 200; non-existent id → 200.
- **Root cause:** `deploy/kind/control-plane/metrics-handlers.mjs` doesn't enforce caller `tenant_id` == path id
  (the tenant/plan routes do via a 403 guard; metrics handlers were missed).
- **Proposed solution:** apply the same own-tenant guard (tenant_owner→own only; superadmin→any) to all metrics routes.
- **Acceptance:** cross-tenant metrics → 403; own → 200; live probe.
- **Evidence:** `evidence/26-lifecycle-governance.md`, `evidence/27-console-parity.md`.

### A4 — Mongo document/browse handlers leak cross-tenant documents  ·  `fix-mongo-browse-tenant-scope`
- **Labels:** `bug` `P0` `security` `tenant-isolation` `cap:mongo-data-api` `openspec` *(bumped P1→P0: API-reachable cross-tenant document-content read)*
- **Problem:** The gateway routes `/v1/mongo/*` (JWT, no apikey) to the control-plane, whose mongo browse/list/
  document-read handlers omit the `tenantId` filter the executor adapter enforces → any tenant reads any
  database/collection/documents by name and enumerates all names.
- **Reproduction:** `acme-ops` JWT → `GET …/data/{globexDb}/collections/{c}/documents` → 200 returning globex's doc;
  `GET /v1/mongo/databases` lists all tenants' db/collection names; `?filter=` exfiltration works.
- **Root cause:** `deploy/kind/control-plane/mongo-handlers.mjs` (browse/documents) unscoped; only the executor path
  (apikey → `falcone-cp-executor`) stamps/filters `tenantId`.
- **Proposed solution:** scope the control-plane mongo handlers by the caller's tenant (filter by `tenantId`,
  restrict listable db/collection names to the caller's workspaces), or route document reads through the scoped
  executor. (Depends on EPIC G fixing executor↔FerretDB.)
- **Acceptance:** cross-tenant document read/list → empty/403; own data intact; live two-tenant probe.
- **Evidence:** `evidence/21-document-mongo.md`.

### A5 — Postgres metadata browser leaks cross-tenant schema/catalog  ·  `fix-pg-browse-tenant-scope`
- **Labels:** `bug` `P1` `security` `tenant-isolation` `cap:postgres-data-api` `openspec`
- **Problem:** `GET /v1/postgres/databases` scans `pg_database` cluster-wide → lists every tenant's `wsdb_*`
  databases AND the platform control DB `in_falcone`; schemas/tables/columns are then enumerable cross-tenant.
  (Row DATA stays RLS-protected; this is a metadata/structure leak.)
- **Reproduction:** `acme-ops` → `GET /v1/postgres/databases` shows globex DBs + `in_falcone` (23 internal tables);
  `…/{globexDb}/schemas|tables|columns` → 200.
- **Root cause:** `deploy/kind/control-plane/pg-handlers.mjs::pgListDatabases` and the schema/table browse handlers
  filter by neither `tenant_id` nor the `workspace_databases` registry.
- **Proposed solution:** restrict the database list to `workspace_databases` rows owned by the caller's tenant;
  reject browse on non-owned databases; never expose `in_falcone`.
- **Acceptance:** acme sees only acme's DBs; globex/internal DBs hidden; live probe.
- **Evidence:** `evidence/20-postgres-and-isolation.md`, `evidence/27-console-parity.md`.

### A6 — Quota read endpoints return cross-tenant 200  ·  `fix-quota-read-tenant-scope`
- **Labels:** `bug` `P2` `security` `tenant-isolation` `cap:quotas-plans` `openspec`
- **Problem:** `/v1/tenants/{id}/quota/effective-limits` and `/quota/audit` return 200 cross-tenant (payloads empty
  today, but the authz check is absent — will leak once quota state is populated).
- **Proposed solution:** add the own-tenant guard used by `/plan/*` routes. **Acceptance:** cross-tenant → 403.
- **Evidence:** `evidence/26-lifecycle-governance.md`.

---

## EPIC B — Per-tenant datastore identities (storage & document layer)
**Labels:** `epic` `security` `tenant-isolation` `P1`
**Summary:** Direct-datastore isolation relies on a single shared credential at the SeaweedFS (and FerretDB admin)
layer; anyone holding the shared secret crosses tenants beneath the API. Provision per-tenant identities.

### B1 — SeaweedFS uses one shared root S3 identity (cross-tenant at the object layer)  ·  `add-seaweedfs-per-tenant-identities`
- **Labels:** `bug`/`enhancement` `P1` `security` `tenant-isolation` `cap:storage` `openspec`
- **Problem:** Only `falcone-s3-admin` exists; with the `in-falcone-storage` keys one lists/reads/writes ALL tenants'
  buckets. Buckets are raw resourceIds with no tenant/workspace prefix.
- **Reproduction:** aws-sdk → `http://…:8333` ListBuckets shows both tenants; Get/Put on the other tenant's bucket succeeds.
- **Proposed solution:** issue per-tenant/per-workspace SeaweedFS identities (the SeaweedFS-migration tenant-identities
  work) and scope each workspace's storage credential; namespace buckets by tenant/workspace.
- **Acceptance:** a workspace credential can only access its own buckets; live cross-tenant S3 probe denied.
- **Evidence:** `evidence/22-storage-s3.md`. **Depends on / relates to:** epic-seaweedfs-migration (#430).

### B2 — Object PUT is JSON-only (not S3-compatible, no binary)  ·  `fix-storage-object-binary-put`
- **Labels:** `bug` `P2` `cap:storage` `openspec`
- **Problem:** `PUT …/objects/{key}` rejects raw/binary bodies (`400 INVALID_JSON`); only `{content,contentType}` JSON.
- **Proposed solution:** accept raw bytes (or base64) so arbitrary objects can be stored. **Acceptance:** binary
  round-trip byte-identical. **Evidence:** `evidence/22-storage-s3.md`.

---

## EPIC C — Governance: plans, quotas, audit (schema completeness + enforcement)
**Labels:** `epic` `P1` `cap:quotas-plans` `cap:audit`
**Summary:** Governance reads return empty 200s but writes/derived reads 500 on missing tables, the quota dimension
catalog is empty (limits can't be defined), and per-project quotas aren't enforced.

### C1 — Governance schema incomplete (capability-catalog / plan-assignment / scope-audit 500)  ·  `fix-governance-schema-bootstrap`
- **Labels:** `bug` `P1` `cap:quotas-plans` `openspec`
- **Problem:** `GET /v1/capability-catalog` → 500 (`boolean_capability_catalog` missing); `POST /tenants/{id}/plan` →
  500 (`tenant_plan_change_history` missing); `GET …/scope-enforcement/audit` → 500 (`scope_enforcement_denials`
  missing); `quota_dimension_catalog` empty.
- **Proposed solution:** ensure the control-plane schema bootstrap creates+seeds the full governance schema (or the
  bootstrap Job runs the governance migrations) so all `/repo` provisioning-orchestrator actions resolve.
- **Acceptance:** the four endpoints return 200; a limit can be defined against a seeded dimension. **Depends on:** D1.
- **Evidence:** `evidence/26-lifecycle-governance.md`.

### C2 — Per-project (workspace) quota not enforced  ·  `fix-workspace-quota-enforcement`
- **Labels:** `bug` `P1` `cap:quotas-plans` `cap:workspace-lifecycle` `openspec`
- **Problem:** Created 4 workspaces under `max_workspaces=3` → all 201. The create path has no quota gate (enforcement
  is wired only for flows/mcp/observability).
- **Proposed solution:** gate workspace creation on the tenant's resolved workspace-count entitlement; 4xx on breach.
- **Acceptance:** creating past the limit → 402/409 quota error; live probe. **Depends on:** C1 (dimension catalog).
- **Evidence:** `evidence/26-lifecycle-governance.md`.

### C3 — Audit logging not deployed / scope-enforcement audit broken  ·  `add-audit-write-and-scope-enforcement-store`
- **Labels:** `bug`/`enhancement` `P2` `cap:audit` `openspec`
- **Problem:** audit-records empty after real actions; no correlation entries; `scope-enforcement/audit` 500.
- **Proposed solution:** deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are
  recorded with correlation ids. **Acceptance:** an action appears in audit-records with its correlation id.
- **Evidence:** `evidence/26-lifecycle-governance.md`.

---

## EPIC D — Deployment hardening (kind profile / chart)
**Labels:** `epic` `P2` `deployment`
**Summary:** The mandated fresh-from-source install surfaced several deploy-time defects that block an unattended
bring-up of the full surface.

### D1 — Keycloak bootstrap Job fails on a cold fresh install  ·  `fix-bootstrap-job-coldstart-retry`
- **Labels:** `bug` `P2` `deployment` `cap:auth-console` `openspec`
- **Problem:** `falcone-in-falcone-bootstrap` → Failed (`backoffLimit:1`, KC not Ready on the single retry); realm +
  governance config not provisioned unless re-run. The bootstrap LOGIC is correct (re-running the pod completes).
- **Proposed solution:** raise `backoffLimit`/retry budget and/or add a KC-readiness wait init-container.
- **Acceptance:** bootstrap completes on a cold `helm install` without manual re-run.
- **Evidence:** §5 REPORT; install logs.

### D2 — cp-executor cannot reach FerretDB (NetworkPolicy label mismatch)  ·  `fix-executor-ferretdb-netpol-labels`
- **Labels:** `bug` `P1` `deployment` `cap:mongo-data-api` `openspec`
- **Problem:** `deploy/kind/executor-demo.yaml` labels the executor `app=falcone-cp-executor`, but the FerretDB
  NetworkPolicy ingress allows `app.kubernetes.io/name=control-plane-executor` → executor mongo CRUD 500 (TCP dropped).
- **Reproduction:** insert via executor mongo → 500 until the label is added; after adding it → 201.
- **Proposed solution:** set `app.kubernetes.io/name: control-plane-executor` on the executor pod template (and align
  the chart's `controlPlaneExecutor` labels with the NP contract).
- **Acceptance:** executor mongo CRUD 2xx on a clean deploy. **Evidence:** `evidence/21-document-mongo.md`, §4 REPORT.

### D3 — Gateway exposes no /v1/flows or /v1/mcp routes  ·  `add-apisix-flows-mcp-routes`
- **Labels:** `bug`/`enhancement` `P2` `deployment` `cap:flows` `cap:mcp` `openspec`
- **Problem:** APISIX (`deploy/kind/apisix/apisix.yaml`) has no `/v1/flows` or `/v1/mcp` route → both 404 via the
  gateway (executor-direct only). `/v1/websockets/*` has no handler.
- **Proposed solution:** add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes.
- **Acceptance:** `GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` 200 via the gateway.
- **Evidence:** `evidence/24-flows-mcp-realtime.md`.

### D4 — Install runs stale node-cached images (tag reuse + IfNotPresent)  ·  `fix-campaign-image-pull-policy`
- **Labels:** `bug` `P2` `deployment` `openspec`
- **Problem:** Rebuilding with the same tag + `imagePullPolicy: IfNotPresent` runs the old cached image on kind nodes;
  fixes silently don't take effect. (Also: `make-secrets.sh` pre-created `in-falcone-gateway-shared-secret` which the
  chart now self-manages → helm ownership conflict.)
- **Proposed solution:** unique per-build tags (or `imagePullPolicy: Always`) in `install.sh`/`executor-demo.yaml`/
  values; drop the gateway-secret pre-create (chart owns it). **Acceptance:** a rebuild always runs the new code.

### D5 — No workspace teardown API; Vault unwired; narrow Prometheus scrape  ·  `add-deploy-completeness-cluster` (umbrella)
- **Labels:** `enhancement` `P2` `deployment` `openspec`
- Sub-items: (a) add a workspace GET/DELETE API with cascading cleanup (currently only tenant purge cascades);
  (b) Vault either properly wired (ESO/agent + cert-manager) or documented as out-of-scope on kind;
  (c) Prometheus scrape config to cover APISIX + the other services. **Evidence:** §5 REPORT, evidence 26.

---

## EPIC E — Workflows (Temporal) & event-driven integration
**Labels:** `epic` `P1` `cap:flows`
**Summary:** The Temporal engine runs end-to-end, but the worker's data activity isn't wired and the Kafka→flow/
function path doesn't complete.

### E1 — Workflow db.query activity not wired ("postgres executor not wired")  ·  `fix-flows-worker-db-activity-wiring`
- **Labels:** `bug` `P1` `cap:flows` `openspec`
- **Problem:** A flow executes to a terminal Temporal state, but the `db.query` activity throws
  `postgres executor not wired into db.query activity` → no data operation occurs.
- **Reproduction:** create→publish→`POST …/executions` → execution `Failed`; worker log: ApplicationFailure
  "postgres executor not wired"; target row not inserted.
- **Proposed solution:** inject/configure the postgres (and mongo/storage/event) executor into the workflow-worker
  activities (DSN + tenant RLS context) via the chart `workflowWorker.config`. **Acceptance:** a `db.query` flow
  inserts/reads a tenant-scoped row and the execution completes successfully.
- **Evidence:** `evidence/24-flows-mcp-realtime.md`, §C22 REPORT.

### E2 — Event-driven integration (Kafka → function / workflow) not working E2E  ·  `add-event-trigger-integration`
- **Labels:** `bug`/`enhancement` `P1` `cap:events` `cap:flows` `cap:functions` `openspec`
- **Problem:** event→function trigger not deployed (404); event→flow trigger registers (`evt.{ws}.{type}` bound) but a
  matching published event starts no execution (blocked partly by E1 + the dev-Temporal search-attribute gap).
- **Proposed solution:** deploy/wire the event-trigger consumer so a published event invokes the bound function/flow;
  register the Temporal search attributes in the deploy (DEP-TEMPORAL-SA). **Acceptance:** publishing an event triggers
  the bound flow/function and the effect is observable. **Depends on:** E1, D-temporal-SA.
- **Evidence:** `evidence/23-events-functions.md`.

---

## EPIC F — MCP (tool execution, MCP→workflow, platform MCP)
**Labels:** `epic` `P2` `cap:mcp`
**Summary:** MCP server hosting + curation work and are tenant-scoped, but no tool actually executes.

### F1 — MCP tool-calls return the executor index instead of executing  ·  `fix-mcp-tool-call-execution`
- **Labels:** `bug` `P2` `cap:mcp` `openspec`
- **Problem:** Any published instant/official MCP server → call any tool → 200 `{"service":"in-falcone-control-plane"}`
  (the executor index). Cause: `MCP_SELF_BASE_URL` unset (self-call hits the executor index), instant tools omit the
  `/rows` suffix / reference a non-existent table, official tools target control-plane routes the executor can't serve.
- **Proposed solution:** set `MCP_SELF_BASE_URL`, fix the instant tool request templates, and route official/platform
  tools to the control-plane. **Acceptance:** a hosted tool-call performs the real action and returns its result.
- **Evidence:** `evidence/24-flows-mcp-realtime.md`.

### F2 — MCP→workflow mapping orphaned; platform MCP non-functional  ·  `add-mcp-workflow-and-platform-binding`
- **Labels:** `bug`/`enhancement` `P2` `cap:mcp` `cap:flows` `openspec`
- **Problem:** `apps/control-plane/src/mcp-workflows-tools.mjs` (#395) is imported only by its test; the MCP engine
  never wires flow-backed tools → an MCP tool cannot trigger a Falcone workflow. The platform "official" MCP server
  exposes 9 management tools but none execute (same as F1).
- **Proposed solution:** wire the flow-backed tool generator into the MCP engine; make the platform MCP tools call the
  control-plane. **Acceptance:** an MCP tool starts a workflow and returns its result; a platform MCP tool creates a
  project. **Depends on:** F1, E1. **Evidence:** `evidence/24-flows-mcp-realtime.md`.

---

## EPIC G — App end-user management & per-project auth configuration
**Labels:** `epic` `P1` `cap:iam-admin` `cap:auth-console`
**Summary:** Per-tenant realms + app end-user register→login→token work at HEAD, but the owner can't fully manage
end-users or the project's auth-method/IdP config via Falcone APIs.

### G1 — No API to disable/delete app end-users  ·  `add-enduser-lifecycle-management`
- **Labels:** `bug`/`enhancement` `P1` `cap:iam-admin` `openspec`
- **Problem:** Owner end-user routes are create+list only; `DELETE …/users/{id}` and status PATCH are in the catalog
  but return NO_ROUTE → the owner cannot disable/delete a registered app end-user.
- **Proposed solution:** implement the disable/delete (and status) end-user routes scoped to the owner's realm.
- **Acceptance:** owner disables then deletes an app end-user; the user can no longer authenticate. **Evidence:** `evidence/25-auth-enduser.md`.

### G2 — No Falcone API to manage a project's auth methods / identity providers  ·  `add-project-auth-config-api`
- **Labels:** `enhancement` `P2` `cap:auth-console` `openspec`
- **Problem:** Enabling password/social methods + provider creds is only possible via raw Keycloak admin; there is no
  Falcone owner-facing API, and the chart `tenantRealmTemplate.requiredClientScopes` aren't applied to tenant realms.
- **Proposed solution:** add owner APIs to toggle auth methods + configure social providers per project, and apply the
  template's required scopes at realm provisioning. **Acceptance:** an owner enables username/password + a social
  provider via the API and the realm's login options reflect it. **Evidence:** `evidence/25-auth-enduser.md`.

---

## EPIC H — Console operator usability & data-plane API contracts
**Labels:** `epic` `P1` `cap:web-console`
**Summary:** The console works for superadmin but is broken for tenant operators, and several data-plane contracts
diverge from the OpenAPI.

### H1 — Console shell unusable for tenant operators  ·  `fix-console-operator-tenant-context`
- **Labels:** `bug` `P1` `cap:web-console` `openspec`
- **Problem:** The tenant-switcher calls `GET /v1/tenants` (`auth:'superadmin'`) → operators get 403 → zero tenant
  context → every tenant-scoped page is empty. `GET /v1/tenant/plan` + `/limits` (My-plan) and the Members panel also
  403 for the operator's own tenant.
- **Proposed solution:** drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the
  superadmin tenant list; fix the singular `/v1/tenant/plan` route authz. **Acceptance:** an operator logs in and sees
  their own tenant/workspaces/plan. **Evidence:** `evidence/27-console-parity.md`.

### H2 — Function invoke drops top-level input  ·  `fix-functions-invoke-input-binding`
- **Labels:** `bug` `P2` `cap:functions` `openspec`
- **Problem:** `fnInvoke` reads `body.parameters`; `{"n":21}` silently → `{doubled:0}` (only `{"parameters":{…}}` works).
- **Proposed solution:** accept top-level input (or document the envelope and validate). **Acceptance:** documented
  shape returns the correct result; unexpected shape 4xx, not a silent wrong answer. **Evidence:** `evidence/23-events-functions.md`.

### H3 — Postgres data insert contract mismatch  ·  `fix-pg-insert-request-contract`
- **Labels:** `bug` `P2` `cap:postgres-data-api` `openspec`
- **Problem:** OpenAPI `PostgresDataInsertRequest` documents `{"row":{…}}` → 400 `PLAN_REJECTED Unknown column row`;
  the executor reads `values`/`changes`. **Proposed solution:** align handler with the contract (or vice-versa) +
  contract test. **Acceptance:** the documented body inserts a row. **Evidence:** `evidence/20-postgres-and-isolation.md`.

### H4 — Mongo collection-indexes on a missing collection → 500  ·  `fix-mongo-indexes-missing-collection`
- **Labels:** `bug` `P2` `cap:mongo-data-api` `openspec`
- **Problem:** `…/collections/{c}/indexes` on a nonexistent collection → 500 (Mongo code 26 leaks); the sibling detail
  returns a clean 404. **Proposed solution:** return 404. **Acceptance:** 404 not 500. **Evidence:** `evidence/21-document-mongo.md`.

---

### Scope decisions (confirmed with reviewer)
- **Upload scope:** ALL epics A–H + their child issues.
- **Fix locus = BOTH kind + product.** The deployed handlers I tested live in `deploy/kind/control-plane/*.mjs`
  (a bespoke kind runtime that re-implements the data/browse handlers). Because the same logic must ship in the
  product, every isolation/scope fix (A1–A6, B*, C*) is framed to land in **both** the kind runtime **and** the
  shippable control-plane/services (`apps/control-plane/src/runtime/*`, `services/*`) — each issue's "Proposed
  solution" applies to both, and the executor (`apps/control-plane`) already carries the correct scoping pattern to
  copy from (e.g. its workspace-ownership guard, tenant-stamped data-plane).

### Notes for the reviewer
- **Severity rationale:** P0 = cross-tenant data access reachable through the product surface (events read+write,
  function code hijack, metrics data); P1 = cross-tenant via direct-datastore creds or metadata, or a core capability
  broken (governance, workflow data, console operator); P2 = contract/usability/empty-data-conditional.
- **Not filed (corrected, not bugs):** F1/F2/F3/F4/D5/A2/A3/A4 from the prior campaign are fixed at HEAD (§6 REPORT).
- **Not filed (expected-but-absent in this profile, noted as gaps, not bugs):** CDC bridges, scheduling, backup-execute,
  pgvector/vector search, Mongo-collection realtime, WebSocket transport.
</content>

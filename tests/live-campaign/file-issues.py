#!/usr/bin/env python3
# Create the campaign epics + child issues on GitHub via `gh api` (avoids the
# Projects-classic `gh issue edit` failure). Children link to their epic; epics get a
# child checklist. Prints a number/title/URL summary. Idempotent-ish: skips a title that
# already has an open issue.
import json, subprocess, sys
REPO = "gntik-ai/falcone"
EV = "audit/live-campaign/evidence"

def gh(args, payload=None):
    p = subprocess.run(["gh","api"]+args, input=(json.dumps(payload) if payload else None),
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"gh api {' '.join(args)} -> {p.returncode}: {p.stderr[:400]}")
    return json.loads(p.stdout) if p.stdout.strip() else {}

def existing_titles():
    out = subprocess.run(["gh","issue","list","--repo",REPO,"--state","all","--limit","400",
                          "--json","number,title"],capture_output=True,text=True)
    return {i["title"]: i["number"] for i in json.loads(out.stdout or "[]")}

def create(title, body, labels):
    payload = {"title": title, "body": body, "labels": labels}
    r = gh(["-X","POST",f"/repos/{REPO}/issues","--input","-"], payload)
    return r["number"], r["html_url"]

def patch_body(number, body):
    gh(["-X","PATCH",f"/repos/{REPO}/issues/{number}","--input","-"], {"body": body})

EPICS = {
 "A": ("[EPIC] Cross-tenant isolation breaches (control-plane read/browse/metrics + functions compute)",
   ["epic","security","tenant-isolation","P0"],
   "The executor data-plane and request-path mutations are correctly tenant-scoped, but several **read/browse/"
   "metrics handlers** in the kind control-plane (`deploy/kind/control-plane/*-handlers.mjs`) omit the tenant "
   "filter the executor enforces, and **functions compute** is not tenant-namespaced — yielding confirmed "
   "cross-tenant access in a live 2-tenant test. Fix locus is **both** the kind runtime **and** the shippable "
   "product (`apps/control-plane/src/runtime/*`, `services/*`); the executor already carries the correct scoping "
   "pattern to copy. Evidence under `audit/live-campaign/`."),
 "B": ("[EPIC] Per-tenant datastore identities (storage & document layer)",
   ["epic","security","tenant-isolation","P1"],
   "Direct-datastore isolation relies on a single shared credential at the SeaweedFS (and FerretDB admin) layer; "
   "anyone holding the shared secret crosses tenants beneath the API. Provision per-tenant identities/credentials."),
 "C": ("[EPIC] Governance: plans, quotas, audit (schema completeness + enforcement)",
   ["epic","P1","cap:quotas-plans"],
   "Governance reads return empty 200s but writes/derived reads 500 on missing tables, the quota dimension catalog "
   "is empty (limits undefinable), per-project quotas are not enforced, and the audit store is empty."),
 "D": ("[EPIC] Deployment hardening (kind profile / chart)",
   ["epic","P2","deployment"],
   "The mandated fresh-from-source install surfaced deploy-time defects blocking an unattended bring-up of the "
   "full surface (bootstrap cold-start race, executor↔FerretDB NetworkPolicy label, missing gateway routes for "
   "flows/mcp, stale-image tag reuse, Vault unwired, no workspace teardown API, narrow Prometheus scrape)."),
 "E": ("[EPIC] Workflows (Temporal) & event-driven integration",
   ["epic","P1","cap:workflows"],
   "The Temporal engine runs flows end-to-end (create→publish→execute→terminal state), but the worker's data "
   "activity isn't wired and the Kafka→flow/function path doesn't complete."),
 "F": ("[EPIC] MCP: tool execution, MCP->workflow, platform MCP",
   ["epic","P2","cap:mcp"],
   "MCP server hosting + curation work and are tenant-scoped, but no tool actually executes (tool-calls return the "
   "executor index page), the MCP->workflow mapping is orphaned, and the platform management MCP is non-functional."),
 "G": ("[EPIC] App end-user management & per-project auth configuration",
   ["epic","P1","cap:iam-admin"],
   "Per-tenant realms + app end-user register->login->token work at HEAD, but the owner can't disable/delete "
   "end-users or configure a project's auth methods / identity providers via Falcone APIs."),
 "H": ("[EPIC] Console operator usability & data-plane API contracts",
   ["epic","P1","cap:web-console"],
   "The console works for superadmin but is broken for tenant operators (tenant-switcher calls a superadmin-only "
   "route), and several data-plane contracts diverge from the OpenAPI."),
}

def body(problem, repro, fix, acc, deps, ev):
    s  = f"## Problem\n{problem}\n\n## Reproduction / evidence\n{repro}\n\n"
    s += f"## Proposed solution (kind runtime **and** shippable product)\n{fix}\n\n"
    s += f"## Acceptance criteria\n{acc}\n"
    if deps: s += f"\n## Dependencies\n{deps}\n"
    s += f"\n**Affected capability / evidence:** `{EV}/{ev}`\n\n_Found by the live E2E campaign 2026-06-18 (empirical, 2-tenant)._"
    return s

CHILDREN = [
 # key, epic, title, labels, problem, repro, fix, acceptance, deps, evidence-file
 ("A1","A","Events/Kafka cross-tenant IDOR (read + publish + consume)",
  ["bug","P0","security","tenant-isolation","cap:events","openspec"],
  "A valid tenant-A JWT can read, publish to, and SSE-consume tenant-B's Kafka topics.",
  "As `acme-ops`: `GET /v1/events/topics/{globexTopicId}`→200; `POST .../{globexTopicId}/publish`→202 (event injected into B's topic); `GET .../{globexTopicId}/stream`→returns B's events. Symmetric B→A. Root: `kafka-handlers.mjs::getTopicByResourceId` resolves by id with no tenant predicate.",
  "Scope every topic-id route by the caller's verified `tenant_id` (resolve topic→workspace→tenant, 403/404 on mismatch), mirroring the executor's workspace-ownership guard, in both `deploy/kind/control-plane/kafka-handlers.mjs` and the product events handler.",
  "Cross-tenant topic detail/metadata/publish/stream → 403/404; same-tenant unaffected; covered by a black-box + live 2-tenant probe.","","23-events-functions.md"),
 ("A2","A","Functions cross-tenant Knative ksvc clobber / code-execution hijack",
  ["bug","P0","security","tenant-isolation","cap:functions","openspec"],
  "The Knative Service name `fn-{workspaceName}-{actionName}` omits tenant/workspace id; two tenants with same-named workspaces (`app-staging`) + same action collide on one shared ksvc, so one tenant's deploy overwrites the other's running code.",
  "A deploys action `x` in its `app-staging`; B deploys action `x` in its `app-staging` (new revision on the SAME ksvc); A invokes its own function → receives B's code output (`OWNED_BY:tenantB`). Root: `function-executor.mjs` ksvc naming + single shared namespace.",
  "Include tenant id + workspace id (or a hash) in the ksvc name and/or a per-tenant namespace; resolve invoke to the caller-scoped ksvc — in the kind `function-executor.mjs` and the product functions runtime.",
  "Two same-named workspaces across tenants get distinct ksvcs; cross-tenant invoke isolated; live probe.","","23-events-functions.md"),
 ("A3","A","Metrics endpoints have no tenant authorization (data leak)",
  ["bug","P0","security","tenant-isolation","cap:observability","openspec"],
  "`/v1/metrics/tenants/{id}/*` and `/v1/metrics/workspaces/{id}/*` accept any id; a tenant operator reads another tenant's metrics including real non-empty time-series.",
  "`acme-ops` → `GET /v1/metrics/workspaces/{globex-ws}/series` → 200 with globex's `http_requests_per_second` series; quotas/overview/usage/audit-records for globex → 200; a non-existent id → 200. Root: `metrics-handlers.mjs` doesn't enforce caller `tenant_id` == path id.",
  "Apply the own-tenant guard used by `/plan/*` (tenant_owner→own only, superadmin→any) to ALL metrics routes, in the kind `metrics-handlers.mjs` and the product metrics handler.",
  "Cross-tenant metrics → 403; own → 200; live probe.","","26-lifecycle-governance.md"),
 ("A4","A","Mongo document/browse handlers leak cross-tenant documents",
  ["bug","P0","security","tenant-isolation","cap:document-store","openspec"],
  "The gateway routes `/v1/mongo/*` (JWT, no apikey) to the control-plane, whose mongo browse/list/document-read handlers omit the `tenantId` filter the executor adapter enforces → any tenant reads any database/collection/documents by name and enumerates all names.",
  "`acme-ops` JWT → `GET .../data/{globexDb}/collections/{c}/documents` → 200 returning globex's doc (`secret:\"GLOBEX_PRIVATE\"`); `GET /v1/mongo/databases` lists all tenants' names; `?filter=` exfiltration works. Root: `mongo-handlers.mjs` browse/documents unscoped (executor path scopes correctly).",
  "Scope the control-plane mongo handlers by the caller's tenant (filter by `tenantId`, restrict listable names to the caller's workspaces) or route document reads through the scoped executor — kind `mongo-handlers.mjs` + product handler.",
  "Cross-tenant document read/list → empty/403; own data intact; live 2-tenant probe.","Relates to D2 (executor↔FerretDB).","21-document-mongo.md"),
 ("A5","A","Postgres metadata browser leaks cross-tenant schema/catalog",
  ["bug","P1","security","tenant-isolation","cap:database","openspec"],
  "`GET /v1/postgres/databases` scans `pg_database` cluster-wide → lists every tenant's `wsdb_*` databases AND the platform control DB `in_falcone`; schemas/tables/columns are then enumerable cross-tenant. (Row DATA stays RLS-protected; this is a metadata/structure leak.)",
  "`acme-ops` → `GET /v1/postgres/databases` shows globex DBs + `in_falcone` (23 internal tables); `.../{globexDb}/schemas|tables|columns` → 200. Root: `pg-handlers.mjs::pgListDatabases` + browse handlers filter by neither `tenant_id` nor `workspace_databases`.",
  "Restrict the database list to `workspace_databases` rows owned by the caller's tenant; reject browse on non-owned DBs; never expose `in_falcone` — kind `pg-handlers.mjs` + product handler.",
  "acme sees only acme's DBs; globex/internal DBs hidden; live probe.","","20-postgres-and-isolation.md"),
 ("A6","A","Quota read endpoints return cross-tenant 200",
  ["bug","P2","security","tenant-isolation","cap:quotas-plans","openspec"],
  "`/v1/tenants/{id}/quota/effective-limits` and `/quota/audit` return 200 cross-tenant (payloads empty today, but the authz check is absent — leaks once quota state is populated).",
  "`acme-ops` → `GET /v1/tenants/{globex}/quota/effective-limits|audit` → 200 (no 403).",
  "Add the own-tenant guard used by `/plan/*` to the quota read routes (kind + product).",
  "Cross-tenant quota reads → 403.","","26-lifecycle-governance.md"),
 ("B1","B","SeaweedFS uses one shared root S3 identity (cross-tenant at the object layer)",
  ["enhancement","P1","security","tenant-isolation","cap:storage","openspec"],
  "Only `falcone-s3-admin` exists; with the `in-falcone-storage` keys one lists/reads/writes ALL tenants' buckets. Buckets are raw resourceIds with no tenant/workspace prefix.",
  "aws-sdk → `http://...:8333` ListBuckets shows both tenants; Get/Put on the other tenant's bucket succeeds; the written object appears in the victim's own REST listing.",
  "Issue per-tenant/per-workspace SeaweedFS identities (the SeaweedFS-migration tenant-identities work) and scope each workspace's storage credential; namespace buckets by tenant/workspace.",
  "A workspace credential can only access its own buckets; live cross-tenant S3 probe denied.","Relates to epic-seaweedfs-migration (#430).","22-storage-s3.md"),
 ("B2","B","Object PUT is JSON-only (not S3-compatible, no binary)",
  ["bug","P2","cap:storage","openspec"],
  "`PUT .../objects/{key}` rejects raw/binary bodies (`400 INVALID_JSON`); only `{content,contentType}` JSON is accepted → faithful binary storage impossible via REST.",
  "PUT a binary body → 400 INVALID_JSON; only JSON `{content}` works.",
  "Accept raw bytes (or base64) so arbitrary objects can be stored — kind `storage-handlers.mjs` + product storage handler.",
  "Binary round-trip is byte-identical.","","22-storage-s3.md"),
 ("C1","C","Governance schema incomplete (capability-catalog / plan-assignment / scope-audit 500)",
  ["bug","P1","cap:quotas-plans","openspec"],
  "`GET /v1/capability-catalog` → 500 (`boolean_capability_catalog` missing); `POST /tenants/{id}/plan` → 500 (`tenant_plan_change_history` missing); `GET .../scope-enforcement/audit` → 500 (`scope_enforcement_denials` missing); `quota_dimension_catalog` empty.",
  "Live: the three endpoints 500 with PostgreSQL 42P01; the dimension catalog returns 0 rows so limits can't be defined.",
  "Ensure the control-plane schema bootstrap creates+seeds the full governance schema (or the bootstrap Job runs the governance migrations) so all provisioning-orchestrator actions resolve — kind control-plane schema + product migrations.",
  "The four endpoints return 200; a limit can be defined against a seeded dimension.","Depends on D1 (bootstrap).","26-lifecycle-governance.md"),
 ("C2","C","Per-project (workspace) quota not enforced",
  ["bug","P1","cap:quotas-plans","openspec"],
  "Created 4 workspaces under `max_workspaces=3` → all 201. The create path has no quota gate (enforcement is wired only for flows/mcp/observability).",
  "Live: `POST /v1/tenants/{id}/workspaces` succeeds past the tenant's workspace limit.",
  "Gate workspace creation on the tenant's resolved workspace-count entitlement; 4xx on breach — kind `b-handlers.mjs::createWorkspace` + product workspace command.",
  "Creating past the limit → 402/409 quota error; live probe.","Depends on C1 (dimension catalog).","26-lifecycle-governance.md"),
 ("C3","C","Audit logging not deployed / scope-enforcement audit broken",
  ["enhancement","P2","cap:audit","openspec"],
  "audit-records empty after real actions; no correlation entries; `scope-enforcement/audit` 500.",
  "Live: created users/workspaces then queried audit → 0 entries; scope-enforcement audit → 500 (missing table).",
  "Deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are recorded with correlation ids — kind + product.",
  "An action appears in audit-records with its correlation id.","","26-lifecycle-governance.md"),
 ("D1","D","Keycloak bootstrap Job fails on a cold fresh install",
  ["bug","P2","deployment","cap:tenant-provisioning","openspec"],
  "`falcone-in-falcone-bootstrap` → Failed (`backoffLimit:1`, KC not Ready on the single retry); realm + governance config not provisioned unless re-run. The bootstrap LOGIC is correct (re-running the pod completes).",
  "Live: Job BackoffLimitExceeded on first install; manually running the same pod a minute later provisions realm+roles+clients+superadmin and exits 0.",
  "Raise `backoffLimit`/retry budget and/or add a Keycloak-readiness wait init-container to the bootstrap Job (chart).",
  "Bootstrap completes on a cold `helm install` without manual re-run.","","../REPORT.md"),
 ("D2","D","cp-executor cannot reach FerretDB (NetworkPolicy label mismatch)",
  ["bug","P1","deployment","cap:document-store","openspec"],
  "`deploy/kind/executor-demo.yaml` labels the executor `app=falcone-cp-executor`, but the FerretDB NetworkPolicy ingress allows `app.kubernetes.io/name=control-plane-executor` → executor mongo CRUD 500 (TCP dropped by kindnet).",
  "Live: executor mongo insert → 500 (timeout); after adding `app.kubernetes.io/name: control-plane-executor` to the pod → 201. Control-plane (correct label) connects in ~2ms.",
  "Set `app.kubernetes.io/name: control-plane-executor` on the executor pod template; align the chart `controlPlaneExecutor` labels with the NetworkPolicy contract.",
  "Executor mongo CRUD 2xx on a clean deploy.","","21-document-mongo.md"),
 ("D3","D","Gateway exposes no /v1/flows or /v1/mcp routes",
  ["enhancement","P2","deployment","cap:workflows","cap:mcp","openspec"],
  "APISIX (`deploy/kind/apisix/apisix.yaml`) has no `/v1/flows` or `/v1/mcp` route → both 404 via the gateway (executor-direct only). `/v1/websockets/*` has no handler.",
  "Live: `GET /v1/flows/.../task-types` and `/v1/mcp/.../servers` → 404 NO_ROUTE at the gateway; 200 against the executor directly.",
  "Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes (standalone APISIX config + gateway-config).",
  "`GET /v1/flows/workspaces/{ws}/task-types` and `/v1/mcp/workspaces/{ws}/servers` → 200 via the gateway.","","24-flows-mcp-realtime.md"),
 ("D4","D","Install runs stale node-cached images (tag reuse + IfNotPresent)",
  ["bug","P2","deployment","openspec"],
  "Rebuilding with the same image tag + `imagePullPolicy: IfNotPresent` runs the old cached image on kind nodes; fixes silently don't take effect. Also `make-secrets.sh` pre-created `in-falcone-gateway-shared-secret` which the chart now self-manages → helm ownership conflict.",
  "Live: rebuilt executor (with the #517 fix) but the node kept the 9h-old image → F1 looked unfixed until `imagePullPolicy: Always` forced a re-pull.",
  "Use unique per-build tags (or `imagePullPolicy: Always`) in install.sh/executor-demo.yaml/values; drop the gateway-secret pre-create (chart owns it).",
  "A rebuild always runs the new code on the next deploy.","","../REPORT.md"),
 ("D5","D","No workspace teardown API; Vault unwired; narrow Prometheus scrape",
  ["enhancement","P2","deployment","openspec"],
  "(a) No workspace GET/DELETE API (only tenant purge cascades) → a single project can't be torn down. (b) Vault is not viable on kind (cert-manager absent → enabling it aborts the release) and no component reads from Vault. (c) Prometheus scrapes only 3 targets (APISIX down).",
  "Live: no `DELETE /v1/workspaces/{id}` route; Vault pod absent; Prometheus targets = 3.",
  "Add a workspace GET/DELETE API with cascading cleanup; either wire Vault (ESO/agent + cert-manager) or document it out-of-scope on kind; widen the Prometheus scrape config.",
  "A workspace can be deleted via API with full cleanup; scrape covers APISIX + services.","","26-lifecycle-governance.md"),
 ("E1","E","Workflow db.query activity not wired ('postgres executor not wired')",
  ["bug","P1","cap:workflows","openspec"],
  "A flow executes to a terminal Temporal state, but the `db.query` activity throws `postgres executor not wired into db.query activity` → no data operation occurs.",
  "Live: create→publish→`POST .../executions` → execution `Failed`; worker log: ApplicationFailure 'postgres executor not wired'; target row not inserted.",
  "Inject/configure the postgres (and mongo/storage/event) executor into the workflow-worker activities (DSN + tenant RLS context) via the chart `workflowWorker.config`.",
  "A `db.query` flow inserts/reads a tenant-scoped row and the execution completes successfully.","","24-flows-mcp-realtime.md"),
 ("E2","E","Event-driven integration (Kafka -> function / workflow) not working E2E",
  ["enhancement","P1","cap:events","cap:workflows","cap:functions","openspec"],
  "event->function trigger not deployed (404); event->flow trigger registers (`evt.{ws}.{type}` bound) but a matching published event starts no execution.",
  "Live: published a matching event (202) → no flow execution started; the manual start path was also blocked by E1 + the dev-Temporal search-attribute gap (the chart's temporal-bootstrap registers the 5 custom SAs).",
  "Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow; ensure the Temporal custom search attributes are registered by the deploy.",
  "Publishing an event triggers the bound flow/function and the effect is observable.","Depends on E1.","23-events-functions.md"),
 ("F1","F","MCP tool-calls return the executor index instead of executing",
  ["bug","P2","cap:mcp","openspec"],
  "Any published instant/official MCP server → call any tool → 200 `{\"service\":\"in-falcone-control-plane\"}` (the executor index). Cause: `MCP_SELF_BASE_URL` unset (self-call hits the executor index), instant tools omit the `/rows` suffix / reference a non-existent table, official tools target control-plane routes the executor can't serve.",
  "Live: create+publish an instant server → call a tool → returns the executor index JSON, not tool data.",
  "Set `MCP_SELF_BASE_URL`, fix the instant tool request templates, and route official/platform tools to the control-plane — `apps/control-plane` mcp-engine + deploy env.",
  "A hosted tool-call performs the real action and returns its result.","","24-flows-mcp-realtime.md"),
 ("F2","F","MCP->workflow mapping orphaned; platform MCP non-functional",
  ["enhancement","P2","cap:mcp","cap:workflows","openspec"],
  "`apps/control-plane/src/mcp-workflows-tools.mjs` (#395) is imported only by its test; the MCP engine never wires flow-backed tools → an MCP tool cannot trigger a Falcone workflow. The platform 'official' MCP server exposes 9 management tools but none execute (same as F1).",
  "Live: no live API path creates a flow-backed MCP tool; platform MCP tool-calls return the executor index.",
  "Wire the flow-backed tool generator into the MCP engine; make the platform MCP tools call the control-plane.",
  "An MCP tool starts a workflow and returns its result; a platform MCP tool creates a project.","Depends on F1, E1.","24-flows-mcp-realtime.md"),
 ("G1","G","No API to disable/delete app end-users",
  ["enhancement","P1","cap:iam-admin","openspec"],
  "Owner end-user routes are create+list only; `DELETE .../users/{id}` and status PATCH are in the catalog but return NO_ROUTE → the owner cannot disable/delete a registered app end-user.",
  "Live: `DELETE /v1/iam/realms/{realm}/users/{id}` and status PATCH → 404 NO_ROUTE.",
  "Implement the disable/delete (and status) end-user routes scoped to the owner's realm — kind `b-handlers.mjs` (iam) + product IAM service.",
  "Owner disables then deletes an app end-user; the user can no longer authenticate.","","25-auth-enduser.md"),
 ("G2","G","No Falcone API to manage a project's auth methods / identity providers",
  ["enhancement","P2","cap:access-control","openspec"],
  "Enabling password/social methods + provider creds is only possible via raw Keycloak admin; there is no Falcone owner-facing API, and the chart `tenantRealmTemplate.requiredClientScopes` aren't applied to tenant realms.",
  "Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/...` route exposes it; tenant realms lack the template's required scopes.",
  "Add owner APIs to toggle auth methods + configure social providers per project, and apply the template's required scopes at realm provisioning — kind `kc-admin.mjs`/`b-handlers.mjs` + product provisioner.",
  "An owner enables username/password + a social provider via the API and the realm's login options reflect it.","","25-auth-enduser.md"),
 ("H1","H","Console shell unusable for tenant operators",
  ["bug","P1","cap:web-console","openspec"],
  "The tenant-switcher calls `GET /v1/tenants` (`auth:'superadmin'`) → operators get 403 → zero tenant context → every tenant-scoped page is empty. `GET /v1/tenant/plan`+`/limits` (My-plan) and the Members panel also 403 for the operator's own tenant.",
  "Live: logged in as `acme-ops` (tenant_owner), the console loads no tenant context; My-plan/Members 403.",
  "Drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the superadmin tenant list; fix the singular `/v1/tenant/plan` route authz — `apps/web-console` + the control-plane plan routes.",
  "An operator logs in and sees their own tenant/workspaces/plan.","","27-console-parity.md"),
 ("H2","H","Function invoke drops top-level input",
  ["bug","P2","cap:functions","openspec"],
  "`fnInvoke` reads `body.parameters`; `{\"n\":21}` silently → `{doubled:0}` (only `{\"parameters\":{...}}` works).",
  "Live: invoke with `{n:21}` → `{doubled:0}`; with `{parameters:{n:21}}` → `{doubled:42}`.",
  "Accept top-level input (or document the envelope and validate) — kind `fn-handlers.mjs` + product functions invoke.",
  "The documented shape returns the correct result; an unexpected shape 4xx, not a silent wrong answer.","","23-events-functions.md"),
 ("H3","H","Postgres data insert contract mismatch",
  ["bug","P2","cap:database","openspec"],
  "OpenAPI `PostgresDataInsertRequest` documents `{\"row\":{...}}` → 400 `PLAN_REJECTED Unknown column row`; the executor reads `values`/`changes`.",
  "Live: insert `{row:{...}}` → 400; `{values:{...}}` works.",
  "Align the handler with the contract (or vice-versa) + a contract test — `apps/control-plane` executor + OpenAPI.",
  "The documented body inserts a row.","","20-postgres-and-isolation.md"),
 ("H4","H","Mongo collection-indexes on a missing collection -> 500",
  ["bug","P2","cap:document-store","openspec"],
  "`.../collections/{c}/indexes` on a nonexistent collection → 500 (Mongo code 26 leaks); the sibling detail returns a clean 404.",
  "Live: indexes on a missing collection → 500.",
  "Return 404 for a missing collection — kind `mongo-handlers.mjs` + product handler.",
  "404 not 500.","","21-document-mongo.md"),
]

def main():
    have = existing_titles()
    epic_num = {}
    print("== EPICS ==")
    for k,(title,labels,desc) in EPICS.items():
        if title in have:
            epic_num[k]=have[title]; print(f"  (exists) #{have[title]} {title}"); continue
        n,url = create(title, desc+"\n\n### Child issues\n_populated below_", labels)
        epic_num[k]=n; print(f"  #{n} {title}\n    {url}")
    print("== CHILDREN ==")
    child_by_epic = {}
    results = []
    for (k,ek,title,labels,prob,repro,fix,acc,deps,ev) in CHILDREN:
        ft = f"{title}"
        if ft in have:
            n=have[ft]; print(f"  (exists) #{n} {ft}")
        else:
            b = body(prob,repro,fix,acc,deps,ev) + f"\n\n---\nPart of #{epic_num[ek]} ({ek})."
            n,url = create(ft, b, labels)
            print(f"  #{n} [{','.join(labels[:3])}] {ft}\n    {url}")
        child_by_epic.setdefault(ek,[]).append((n,ft))
        results.append((ek,n,ft))
    print("== LINK epics -> children ==")
    for k,(title,labels,desc) in EPICS.items():
        kids = child_by_epic.get(k,[])
        lst = "\n".join(f"- [ ] #{n} {t}" for n,t in kids)
        patch_body(epic_num[k], desc+f"\n\n### Child issues\n{lst}")
        print(f"  epic #{epic_num[k]} ({k}) linked {len(kids)} children")
    print("== SUMMARY ==")
    for k in EPICS: print(f"EPIC {k}: #{epic_num[k]}")
    for ek,n,t in results: print(f"  {ek} #{n} {t}")

if __name__=="__main__":
    main()

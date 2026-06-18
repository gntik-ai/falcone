#!/usr/bin/env python3
# Live campaign RE-RUN 2026-06-18 — create epics + child issues on GitHub via `gh api`
# (Projects-classic makes `gh issue edit` fail; `gh api` works). Children link to their
# epic; epics get a child checklist. Idempotent: skips a title that already has an issue.
import json, subprocess, sys
REPO = "gntik-ai/falcone"
EV = "audit/live-campaign/evidence-rerun"

def gh(args, payload=None):
    p = subprocess.run(["gh","api"]+args, input=(json.dumps(payload) if payload else None),
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"gh api {' '.join(args)} -> {p.returncode}: {p.stderr[:400]}")
    return json.loads(p.stdout) if p.stdout.strip() else {}

def existing_titles():
    out = subprocess.run(["gh","issue","list","--repo",REPO,"--state","all","--limit","600",
                          "--json","number,title"],capture_output=True,text=True)
    return {i["title"]: i["number"] for i in json.loads(out.stdout or "[]")}

def create(title, body, labels):
    r = gh(["-X","POST",f"/repos/{REPO}/issues","--input","-"], {"title": title, "body": body, "labels": labels})
    return r["number"], r["html_url"]

def patch_body(number, body):
    gh(["-X","PATCH",f"/repos/{REPO}/issues/{number}","--input","-"], {"body": body})

EPICS = {
 "A": ("[EPIC] Keycloak has no persistence — realm loss on restart (auth-plane SPOF)",
   ["epic","infra","P0","cap:iam-admin","security"],
   "Keycloak runs H2 in-memory with no PVC/external DB; it was OOMKilled mid-campaign and lost every realm (platform + "
   "all tenant realms) — a total auth outage and data loss on any pod restart. No `KC_DB` is configured in any chart "
   "profile. Re-run 2026-06-18 (empirical)."),
 "B": ("[EPIC] Residual cross-tenant structural defects (slug collisions + datastore identities)",
   ["epic","security","tenant-isolation","P1"],
   "The prior API-reachable data-leak P0s (#547-#550, #534) are fixed and hold. Residual issues: physical resource "
   "names derive from the NON-UNIQUE workspace slug (events, storage) causing cross-tenant collisions; the executor "
   "DDL trust path can reach the platform DB; and per-tenant S3 identities are inactive. Re-run 2026-06-18."),
 "C": ("[EPIC] Governance, lifecycle & flows defects (plans, scheduling, triggers, audit)",
   ["epic","P1","cap:quotas-plans"],
   "Plan assignment 500s on an INTEGER overflow (no tenant can hold a plan); scheduling 500s (handler not in image); "
   "flow/webhook triggers 502 (missing tables); workflow data activity unwired; enforcement audit logs never written."),
 "D": ("[EPIC] App auth-as-a-service & IAM completeness",
   ["epic","P1","cap:iam-admin"],
   "Per-tenant realms + app client + app end-user login (un-forgeable tenant_id) work, but the register API drops the "
   "password, tenant owners cannot manage their own end-users, several catalogued IAM routes are unwired, and there is "
   "no Falcone API to configure a project's auth methods / identity providers."),
 "E": ("[EPIC] Data-plane API contract mismatches",
   ["epic","P2","cap:database"],
   "Several executor data-plane contracts diverge from the documented OpenAPI (DDL column shape + primary key, mongo "
   "db-provision field, function inlineCode, bulk path, apikey field casing)."),
 "F": ("[EPIC] Console operator usability & deployment robustness",
   ["epic","P1","deployment","cap:web-console"],
   "The console works for superadmin but breaks for tenant operators (superadmin-only routes, dead session route); and "
   "the mandated from-scratch install surfaced deploy defects (seaweedfs netpol blocks the bucket-hook, health-gate "
   "false negatives, APISIX metrics target down)."),
 "G": ("[EPIC] Advanced-capability completion (platform MCP, MCP protocol, gateway routes, event-driven)",
   ["epic","P2","cap:mcp"],
   "MCP hosting + MCP->workflow work, but the platform MCP has no HTTP route, the standard MCP wire protocol isn't "
   "exposed, the gateway has no flows/mcp routes, and the Kafka->function/flow trigger path isn't complete."),
}

def body(problem, repro, fix, acc, deps, ev):
    s  = f"## Problem\n{problem}\n\n## Reproduction / evidence\n{repro}\n\n"
    s += f"## Proposed solution\n{fix}\n\n## Acceptance criteria\n{acc}\n"
    if deps: s += f"\n## Dependencies\n{deps}\n"
    s += f"\n**Affected capability / evidence:** `{EV}/{ev}`\n\n_Found by the live E2E campaign RE-RUN 2026-06-18 (empirical, 2-tenant, fresh HEAD install)._"
    return s

CHILDREN = [
 # key, epic, title, labels, problem, repro, fix, acceptance, deps, evidence-file
 ("A1","A","Keycloak persistent store + resource sizing (realms must survive restart)",
  ["bug","P0","infra","security","cap:iam-admin","openspec"],
  "`falcone-keycloak` has no `KC_DB` config and no PVC -> H2 in-memory; any restart wipes all realms (platform + tenant). Memory limit 2Gi.",
  "Pod `lastState.terminated.exitCode=137` (OOMKilled) ~26min in; `kubectl get pvc` shows no keycloak PVC; no `KC_DB*` env in any profile; after restart `.../realms/in-falcone-platform/.well-known` -> 404 (all realms gone); sub-agents lost JWT auth mid-run.",
  "Back Keycloak with the bundled Postgres (or a dedicated PVC for H2-file) so realms persist; raise memory request/limit; ensure every profile (incl. kind) configures persistence.",
  "Killing the KC pod preserves the platform + a seeded tenant realm; login works post-restart with no re-bootstrap; KC does not OOM under multi-tenant load.","","11-auth-iam-appauth-keys.md"),

 ("B1","B","Events: derive the physical Kafka topic from the workspace id, not the slug",
  ["bug","P1","security","tenant-isolation","cap:events","openspec"],
  "The control-plane events path names the physical topic `ws.${ws.slug}.${topic}`; slugs are not globally unique, so two tenants' same-slug workspaces + same topic name collide on one physical topic + one store record, and the second tenant is locked out (404). The executor path correctly uses `evt.<workspaceId>.<topic>`.",
  "acme & globex each POST `{name:collide-events}` to their `app-staging` ws -> identical `res_topic_80c2db4e` + identical physical `ws.app-staging.collide-events`; Kafka shows ONE such topic; globex then 404s on its own topic. `deploy/kind/control-plane/kafka-handlers.mjs:90`.",
  "Derive the control-plane physical name from the unique workspace id (align with `events-executor.mjs`); key `workspace_topics` by `(workspace_id, topic_name)`.",
  "Two same-slug workspaces across tenants get distinct physical topics + distinct resourceIds; both tenants can use their topic; JWT and apiKey paths resolve to the same physical topic.","","EVENTS-isolation.md"),
 ("B2","B","Storage: scope the bucket registry by workspace (slug-name collision hijacks tenant_id)",
  ["bug","P1","security","tenant-isolation","cap:storage","openspec"],
  "Two tenants' default slug-derived bucket name `ws-app-staging-assets` collide; `insertBucket` `ON CONFLICT (bucket_name) DO UPDATE SET tenant_id=EXCLUDED.tenant_id` overwrites the first tenant's registry row, so their bucket disappears from their list.",
  "Two tenants `POST /v1/storage/workspaces/{ws}/buckets` with no explicit name (both ws slug `app-staging`) -> second create hijacks the first's registry row; first tenant's bucket list drops to 0. `tenant-store.mjs::insertBucket`.",
  "Include the workspace id in the physical bucket name; key the registry by `(workspace_id, bucket_name)`; never let `ON CONFLICT` cross tenant_id.",
  "Same-slug workspaces across tenants get distinct buckets; neither can hijack the other's registry row.","","13-storage-events-functions.md"),
 ("B3","B","Executor DDL must validate target-DB ownership + close the trust-header boundary",
  ["bug","P1","security","tenant-isolation","cap:database","openspec"],
  "The executor DDL path executes against the literal URL `{db}` without checking it belongs to the caller's workspace/tenant. Via the gateway-BYPASS trust-header path (no workspace; `GATEWAY_SHARED_SECRET` unset on the executor) this reaches the platform control DB `in_falcone`. The tenant-facing apiKey path IS confined (no tenant-to-tenant leak).",
  "Trust-header `POST /v1/postgres/databases/in_falcone/schemas` -> schema created in `in_falcone` (verified). ApiKey path targeting `in_falcone`/globex lands in the caller's OWN ws DB (no leak). `apps/control-plane/src/runtime/postgres-ddl-executor.mjs`.",
  "Resolve/validate the target DB against the caller's workspace ownership; reject `in_falcone` and non-owned DBs (fail-closed); set `GATEWAY_SHARED_SECRET` on the executor so it does not openly honor trust headers.",
  "DDL on a non-owned DB or `in_falcone` -> 403; own-workspace DDL unaffected; the executor rejects unsigned trust headers.","","12-pg-mongo-data-and-direct.md"),
 ("B4","B","Activate per-tenant SeaweedFS identities (single shared admin S3 credential)",
  ["bug","P1","security","tenant-isolation","cap:storage","infra","openspec"],
  "`STORAGE_TENANT_IDENTITIES` is absent from the deployed control-plane env (the values overlay's full-list env replace drops it); every storage provision returns `storageCredential:null`; a single shared admin S3 identity reads/writes all tenants' buckets. (#553 shipped the mechanism but it is gated off here.)",
  "Deployed control-plane pod env has only STORAGE_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY (no STORAGE_TENANT_IDENTITIES); direct S3 admin cred lists/reads/writes both tenants' buckets.",
  "Ensure the flag is set in every profile (or default-on); verify the per-workspace identity provision/rotate/revoke path issues real per-tenant SeaweedFS credentials and the storage API vends them.",
  "Each workspace gets a distinct S3 identity scoped to its bucket prefix; tenant A's S3 credential cannot access tenant B's buckets.","Relates to epic-seaweedfs-migration (#430).","13-storage-events-functions.md"),

 ("C1","C","Plan-impact usage column overflows INTEGER (no tenant can be assigned a plan)",
  ["bug","P1","cap:quotas-plans","openspec"],
  "`POST /v1/tenants/{id}/plan` -> 500; `tenant_plan_quota_impacts.observed_usage` is INTEGER but usage is reported in bytes (e.g. 5 GB) -> overflow.",
  "Live: every plan assignment returns 500; both seeded tenants ended with plan=None. Migration `100-plan-change-impact-history.sql`.",
  "Change `observed_usage` (and sibling usage columns) to BIGINT.",
  "Plan assign -> 2xx; entitlements reflect the plan; large byte usage stored without error.","","10-tenant-project-quota-provisioning-audit.md"),
 ("C2","C","Scheduling handler missing from the control-plane image",
  ["bug","P1","cap:scheduling","deployment","openspec"],
  "Every `/v1/scheduling/*` -> 500 ERR_MODULE_NOT_FOUND; `services/scheduling-engine/actions/scheduling-management.mjs` is in `route-map.runtime.json` but not COPY'd in `apps/control-plane/Dockerfile`.",
  "Live: any `/v1/scheduling/*` request crashes 500 before business logic; the .mjs exists in the source tree but not the image.",
  "Add the COPY for the scheduling handler (and a startup check that every route-map handler resolves).",
  "`/v1/scheduling/*` returns business responses; the image build fails if a route-map handler is missing.","","15-secrets-metrics-cdc-console-backup.md"),
 ("C3","C","Flow/webhook trigger schema missing (event->flow + webhook publish 502)",
  ["bug","P1","cap:workflows","cap:webhooks","openspec"],
  "Publishing a flow with a platform-event or webhook trigger -> 502 TRIGGER_REGISTRATION_FAILED; executor log: `relation \"flow_trigger_registrations\" does not exist` (also `flow_trigger_secrets`). The governance schema bootstrap omits these tables.",
  "Live: flow publish with `kind:webhook`/platform-event trigger -> 502; executor logs the missing relation.",
  "Add the trigger tables to the governance migration set.",
  "Event/webhook trigger registration succeeds; an event->flow path runs end-to-end.","","13-storage-events-functions.md"),
 ("C4","C","Flows worker DB wiring + Temporal search-attribute bootstrap",
  ["bug","P1","cap:workflows","deployment","openspec"],
  "The workflow `db.query` activity -> UPSTREAM_UNAVAILABLE because the worker deployment lacks PGHOST/PGUSER/PGPASSWORD/PGDATABASE; and the dev Temporal namespace's custom search attributes are not auto-registered on a fresh install.",
  "Live: flow create->publish->execute reaches a terminal Temporal state, but `db.query` returns UPSTREAM_UNAVAILABLE; worker env has no PG vars.",
  "Inject the PG env into the worker; run a search-attribute bootstrap step on deploy.",
  "A flow's `db.query` activity returns rows; flow execution does not 500 on a missing search attribute.","","14-workflows-mcp-realtime.md"),
 ("C5","C","Enforcement audit logs never written (quota + scope denials)",
  ["bug","P2","cap:audit","security","openspec"],
  "Quota denials (402) and cross-tenant denials (403) fire but `quota_enforcement_log` and `scope_enforcement_denials` stay empty.",
  "Live: a 4th-workspace create -> 402 QUOTA_EXCEEDED and a cross-tenant access -> 403, yet both tables have 0 rows.",
  "Write an audit record at each enforcement point with the correlation id.",
  "A 402/403 produces a correlated audit row.","","10-tenant-project-quota-provisioning-audit.md"),
 ("C6","C","Backup scope API 500s on missing schema tables",
  ["bug","P1","cap:backup-restore","openspec"],
  "`GET /v1/admin/backup/scope` and `/v1/tenants/{id}/backup/scope` reach the handler (superadmin) but 500 with PostgreSQL `42P01` (undefined_table) — `deployment_profile_registry`/`backup_scope_entries` are not created. The `services/backup-status` service + the routes exist; only the schema is missing. (Capability was initially mis-reported as not-deployed; it is deployed-but-broken.)",
  "Live: superadmin `GET /v1/admin/backup/scope` -> 500 `{code:42P01}`; acme-ops `GET /v1/tenants/{globex}/backup/scope` -> 403 (isolation holds).",
  "Add the backup-scope schema (deployment_profile_registry + backup_scope_entries) to the governance/backup migration set.",
  "Backup scope returns 2xx for an authorized caller; cross-tenant stays 403.","","15-secrets-metrics-cdc-console-backup.md"),

 ("D1","D","IAM user creation drops the credentials (app end-users created without a password)",
  ["bug","P1","cap:iam-admin","openspec"],
  "`POST /v1/iam/realms/{realm}/users` with `credentials:[{type:password,...}]` creates the user but no password is set -> the end-user cannot log in.",
  "Live: register -> 201, but `GET .../users/{id}/credentials` -> [] (credentialTypes empty) -> ROPC login `invalid_grant`. After a KC-admin password set, login -> 200 with an un-forgeable tenant_id claim.",
  "Pass the credentials through to Keycloak on create (or expose a set-password sub-route).",
  "A user created with a password can immediately log in.","","11-auth-iam-appauth-keys.md"),
 ("D2","D","Tenant-owner app-end-user management API",
  ["enhancement","P1","cap:iam-admin","openspec"],
  "A tenant_owner cannot list its own app end-users (`GET /v1/iam/realms/{id}/users` -> 403 superadmin-only); there is no owner-facing end-user management API (list/view/disable/delete).",
  "Live: as a tenant_owner, listing the project's end-users -> 403; disable/delete are superadmin-only.",
  "A project-scoped end-user management API authorized for the owning tenant.",
  "An owner lists/disables/deletes only its own project's end-users; cross-tenant denied.","","11-auth-iam-appauth-keys.md"),
 ("D3","D","Wire the catalogued IAM routes (getIamUser / role-by-name / realm CRUD)",
  ["bug","P2","cap:iam-admin","openspec"],
  "`getIamUser`, `getIamRole`/`deleteIamRole`, and realm CRUD are in the route catalog but return 404 in the deployed runtime.",
  "Live: `GET /v1/iam/realms/{id}/users/{userId}`, `GET/DELETE .../roles/{name}`, and realm CRUD -> 404 NO_ROUTE.",
  "Register the handlers (or remove them from the catalog).",
  "Catalogued IAM routes resolve to their handlers.","","11-auth-iam-appauth-keys.md"),
 ("D4","D","Project auth-method / identity-provider configuration API",
  ["enhancement","P2","cap:iam-admin","openspec"],
  "The per-tenant realm + `{slug}-app` client + auth-method templates exist, but enabling username/email vs social IdPs is only doable via raw Keycloak admin — no Falcone API.",
  "Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/...` route exposes it.",
  "A project-scoped API to toggle auth methods + configure social providers (credentials redacted).",
  "An owner enables/disables a method via the API and the app's login options reflect it.","","11-auth-iam-appauth-keys.md"),

 ("E1","E","Postgres DDL column contract + primary key",
  ["bug","P2","cap:database","openspec"],
  "Create-table requires `columnName/dataType` (not the documented `name/type`), and `primaryKey:true` emits no PK constraint (tables become unusable for by-PK CRUD).",
  "Live: `columns:[{name,type}]` -> 400 DDL_INVALID; `primaryKey:true` creates no `pg_index` entry. `postgresql-structural-admin.mjs` / `postgres-ddl-executor.mjs`.",
  "Accept the documented `name/type` shape (or fix the OpenAPI), and emit a PRIMARY KEY constraint when `primaryKey:true`.",
  "The documented create-table body works and `primaryKey` creates a usable PK.","","12-pg-mongo-data-and-direct.md"),
 ("E2","E","Data-API field/path mismatches (mongo provision, fn inlineCode, bulk path, apikey casing)",
  ["bug","P2","cap:database","cap:document-store","cap:functions","openspec"],
  "Mongo db-provision needs body `name` not `databaseName` (400); executor function deploy `{source:{inlineCode}}` fails at invoke (source object not unwrapped); route-catalog bulk path `.../bulk/insert` vs executor `.../rows/bulk/insert`; apikey list snake_case vs mint camelCase.",
  "Live: each mismatch reproduced against the executor (400 / invoke error / 404 / inconsistent JSON).",
  "Align the handlers with the OpenAPI-documented shapes (or correct the catalog/docs) + contract tests.",
  "The documented shapes work; the catalog path resolves; response casing is consistent.","","12-pg-mongo-data-and-direct.md"),
 ("E3","E","Vector search requires the pgvector image (kind profile uses a non-pgvector Postgres)",
  ["bug","P2","cap:database","deployment","openspec"],
  "`CREATE EXTENSION vector` fails with 'extension vector is not available' on the deployed bitnami Postgres; the chart ships a `pgvector/pgvector` image (operator contract) but the kind/campaign profile uses bitnami, so vector/KNN search is unavailable. (Initially mis-reported as not-deployed; the chart DOES support it.)",
  "Live: direct `CREATE EXTENSION IF NOT EXISTS vector` on `wsdb_acme_app_staging` -> ERROR extension not available; chart `values.yaml` documents `pgvector/pgvector` as the vector-capable image.",
  "Use the `pgvector/pgvector` image for the shared (or dedicated) Postgres in profiles that must support vector search; verify `CREATE EXTENSION vector` + a KNN query through the data API.",
  "A workspace creates the vector extension and runs a KNN similarity query.","","12-pg-mongo-data-and-direct.md"),

 ("F1","F","Console operator shell role-gating (superadmin-only routes + dead session route)",
  ["bug","P1","cap:web-console","openspec"],
  "`/console/my-plan` (and plans/tenants) call superadmin-only routes -> 403 for tenant_owners (no role gate); `/v1/console/session` is referenced in the SPA bundle but returns 404.",
  "Live: as `acme-ops` (tenant_owner), my-plan/plans/tenants -> 403; `/v1/console/session` -> 404.",
  "Drive operator pages from operator-authorized routes (own-scope) or hide them by role; remove/implement `/v1/console/session`.",
  "An operator logs in and sees their own tenant/plan/workspaces; no dead session route.","","15-secrets-metrics-cdc-console-backup.md"),
 ("F2","F","SeaweedFS netpol blocks the bucket-provisioning hook (fresh install hangs)",
  ["bug","P1","infra","deployment","cap:storage","openspec"],
  "The `seaweedfs-internal-only` NetworkPolicy restricts master/filer ports to `app.kubernetes.io/name: seaweedfs`, but the upstream bucket-hook pod has no such label -> on any NetworkPolicy-enforcing CNI the hook's `wget /cluster/status` is dropped, hanging the post-install hook chain and the whole `helm install`. The chart comment wrongly assumes kind does not enforce NetworkPolicy.",
  "Live: bucket-hook stuck 'Service not ready'; `curl master:9333` from an unlabeled pod -> 000; `wget localhost:9333/cluster/status` inside the master -> `{IsLeader:true}`. install hung until `seaweedfs.networkPolicy.enabled=false`.",
  "Allow the bucket-hook in the netpol (label it `app.kubernetes.io/name: seaweedfs` or add an ingress rule); update the chart comment.",
  "A from-scratch install on a NetworkPolicy-enforcing cluster completes without disabling the netpol.","","00-stack-and-install.md"),
 ("F3","F","Install health-gate probes report false negatives",
  ["bug","P2","deployment","openspec"],
  "`install.sh` probes `apisix /health` (404 — the gateway proxies it to an upstream path that 404s; `/v1/*` routing works) and `ferretdb:27017` from an unlabeled smoke pod (netpol-blocked though reachable from the executor) -> false health-gate failures.",
  "Live: gate FAILs on apisix /health (but POST /v1/auth/login-sessions -> 400, GET /v1/tenants -> 401) and ferretdb TCP (but ferretdb TCP OK from the executor pod).",
  "Probe paths/clients that reflect real health (e.g. a known-routed `/v1/*` path; an allowed client for ferretdb).",
  "The health gate passes when the platform is actually healthy.","","00-stack-and-install.md"),
 ("F4","F","Prometheus APISIX scrape target is down",
  ["bug","P2","cap:observability","openspec"],
  "The APISIX Prometheus target is DOWN (returns HTML, not Prometheus exposition) -> 4/5 targets UP.",
  "Live: `/api/v1/targets` shows the APISIX target DOWN; other targets UP; Grafana dashboards otherwise show real data.",
  "Expose an APISIX metrics endpoint and point the scrape config at it.",
  "The APISIX scrape target is UP.","","15-secrets-metrics-cdc-console-backup.md"),

 ("G1","G","Expose the platform MCP server over HTTP",
  ["enhancement","P2","cap:mcp","openspec"],
  "`mcp-official-server.mjs` (the platform management MCP, ~9 tools) exists but has no HTTP route in `server.mjs` -> the platform MCP interface (C25) is unreachable.",
  "Live: no HTTP route serves the platform MCP; MCP hosting + MCP->workflow otherwise work.",
  "Register an HTTP route for the platform MCP server (tenant-scoped).",
  "An MCP client connects to the platform MCP and manages projects/resources, tenant-scoped.","","14-workflows-mcp-realtime.md"),
 ("G2","G","Expose the standard MCP wire protocol (JSON-RPC / Streamable-HTTP)",
  ["enhancement","P2","cap:mcp","openspec"],
  "MCP server hosting works via the internal management API, but the standard MCP wire protocol is not exposed for external MCP clients.",
  "Live: tool list/call work through the internal API; no JSON-RPC/Streamable-HTTP endpoint for a standard client.",
  "Expose the MCP protocol surface so a standard MCP client can list+call tools.",
  "A standard MCP client lists and calls a hosted tool over the protocol.","","14-workflows-mcp-realtime.md"),
 ("G3","G","Gateway routes for flows + MCP",
  ["enhancement","P2","cap:gateway","cap:workflows","cap:mcp","openspec"],
  "APISIX has no `/v1/flows` or `/v1/mcp` route (executor-direct only); `/v1/websockets/*` has no handler.",
  "Live: `GET /v1/flows/.../task-types` and `/v1/mcp/.../servers` -> 404 at the gateway; 200 against the executor directly.",
  "Add gateway routes to the executor for flows + mcp (apikey/JWT), mirroring the data-plane routes.",
  "`/v1/flows/...` and `/v1/mcp/...` -> 200 via the gateway.","","14-workflows-mcp-realtime.md"),
 ("G4","G","Event-driven triggers end-to-end (Kafka -> function / flow)",
  ["enhancement","P2","cap:events","cap:workflows","cap:functions","openspec"],
  "Kafka->function trigger is not deployed (404); event->flow is blocked by the missing trigger schema (see C3).",
  "Live: event->function trigger 404 on GW+EXEC; event->flow trigger registration 502 (missing tables).",
  "Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow.",
  "Publishing an event invokes a function and/or starts a workflow end-to-end.","Depends on C3.","13-storage-events-functions.md"),
 ("G5","G","Gateway omits identity-header injection for /v1/realtime/* (CDC captures) and /v1/admin/config/* -> 401",
  ["bug","P1","cap:gateway","cap:change-data-capture","openspec"],
  "The CDC capture handler (`/v1/realtime/workspaces/{ws}/pg-captures`) and the tenant config-mgmt routes (`/v1/admin/config/*`) require BOTH a verified JWT AND gateway-injected identity headers. APISIX routes these paths but does not run the identity-injection plugin for them -> every call 401 ('missing identity headers'); the executor/CP direct path -> 401 ('missing Bearer token'). The handlers are deployed and unreachable. (Initially mis-reported as not-deployed.)",
  "Live: superadmin JWT -> `GET /v1/realtime/workspaces/{ws}/pg-captures` -> 401 'missing identity headers'; trust-header direct -> 401 'Missing or invalid Bearer token'; the realtime change-stream (a different, wired route) works.",
  "Wire the APISIX identity-injection plugin for `/v1/realtime/*` (captures) and `/v1/admin/config/*`, mirroring the working data-plane routes (relates to the flows/mcp gateway-route gap G3).",
  "`GET /v1/realtime/workspaces/{ws}/pg-captures` and `/v1/admin/config/*` return business responses for an authorized caller; cross-tenant denied.","Relates to G3.","15-secrets-metrics-cdc-console-backup.md"),
 ("G6","G","Vault is deployable on kind but no component consumes it (secrets-as-a-service unwired)",
  ["enhancement","P2","cap:secrets","openspec"],
  "Vault can be deployed on kind via `vault.tls.mode` (no cert-manager needed), but no Falcone component reads secrets from Vault — every app/datastore reads native k8s Secrets (ESO disabled, no agent injection). 'Secrets via Vault' is unwired regardless of whether the Vault pod runs. (Initially treated as an expected gap; the chart supports Vault, so the gap is the missing consumer.)",
  "Live: `vault.enabled=false` in the campaign; the vault subchart supports a non-cert-manager `tls.mode`; app source has no Vault/VAULT_ADDR consumer; provisioning-orchestrator secret-rotation actions read k8s secrets.",
  "Wire a secrets backend (ESO/agent injection or a Vault client in the control-plane) so per-tenant/per-env secrets resolve from Vault; enable Vault in the kind profile via the non-cert-manager tls.mode for testing.",
  "A secret set via the API is stored in Vault and made available (isolated per env) to a function/service.","","15-secrets-metrics-cdc-console-backup.md"),
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
    child_by_epic = {}; results = []
    for (k,ek,title,labels,prob,repro,fix,acc,deps,ev) in CHILDREN:
        if title in have:
            n=have[title]; print(f"  (exists) #{n} {title}")
        else:
            b = body(prob,repro,fix,acc,deps,ev) + f"\n\n---\nPart of #{epic_num[ek]} (epic {ek})."
            n,url = create(title, b, labels)
            print(f"  #{n} [{','.join(labels[:3])}] {title}\n    {url}")
        child_by_epic.setdefault(ek,[]).append((n,title)); results.append((ek,n,title))
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

# Live campaign RE-RUN 2026-06-18 — proposed OpenSpec epics & GitHub issues (DRY RUN — nothing uploaded)

Grouped into epics with child issues. Labels follow repo convention: `bug`/`enhancement`, `P0`/`P1`/`P2`, `cap:<name>`,
`security`, `tenant-isolation`, `openspec`, `infra`/`deployment`. Each child names a proposed OpenSpec `fix-…`/`add-…`
change-id (created on the feature branch only after approval). Evidence: `audit/live-campaign/evidence-rerun/`.
"[verified]" = reproduced directly by the lead during synthesis; "[agent]" = captured by a capability sub-agent.

> Scope note: the prior campaign's API-reachable data-leak P0s (#547–#550, #534) were re-verified as **fixed** on clean
> HEAD and are NOT re-filed. These issues are NEW or residual.

---

## EPIC A — Keycloak has no persistence: realm loss on restart (TOP infra risk)
**Labels:** `epic` `infra` `P0` `cap:iam-admin` `security`
**Summary:** Keycloak runs H2 in-memory with no PVC/external DB; it was OOMKilled mid-campaign and lost every realm
(platform + all tenant realms) — a total auth-plane outage and data loss on any restart.

### A1 — Keycloak persistent store + resource sizing · `fix-keycloak-persistent-store`
- **Labels:** `bug` `P0` `infra` `cap:iam-admin` `security` `openspec`
- **Problem:** `falcone-keycloak` has **no `KC_DB` config, no PVC** → defaults to H2 in-memory. Memory limit 2Gi.
- **Repro/evidence [verified]:** pod `lastState.terminated.exitCode=137` at 16:15:11Z (started 15:49:31Z, ~26min);
  `kubectl get pvc` → no keycloak PVC; no `KC_DB*` env; after restart `…/realms/in-falcone-platform/.well-known` → 404
  (all realms gone). Multiple sub-agents lost JWT auth mid-run as a result.
- **Root cause:** dev-mode Keycloak (ephemeral H2) in the kind profile; no realm persistence + under-provisioned heap.
- **Proposed solution:** back Keycloak with the bundled Postgres (or a dedicated PVC for H2-file) so realms survive
  restarts; raise memory request/limit; confirm the production/HA profile already persists (and gate kind likewise).
- **Acceptance:** kill the KC pod → realms (platform + a seeded tenant) survive; login works post-restart with no
  re-bootstrap; KC does not OOM under the campaign's multi-tenant load.

---

## EPIC B — Residual cross-tenant structural defects (slug collisions + datastore identities)
**Labels:** `epic` `security` `tenant-isolation` `P1`
**Summary:** No API-reachable tenant-to-tenant data leak remains, but several resources collide across tenants because
physical names derive from the **non-unique workspace slug**, and datastore identities are shared/inactive.

### B1 — Events: physical Kafka topic keyed by workspace id, not slug · `fix-events-physical-topic-workspace-id`
- **Labels:** `bug` `P1` `security` `tenant-isolation` `cap:events` `openspec`
- **Problem:** the control-plane events path names the physical topic `ws.${ws.slug}.${topic}`; slugs are not globally
  unique, so two tenants' same-slug workspaces + same topic name collide on one physical topic + one store record. The
  second tenant is then locked out (404) of its own topic. The executor path correctly uses `evt.<workspaceId>.<topic>`.
- **Repro/evidence [verified]:** acme & globex each `POST {name:collide-events}` to their `app-staging` ws → identical
  `res_topic_80c2db4e` + identical physical `ws.app-staging.collide-events`; Kafka shows ONE such topic; globex then
  404s on it. `deploy/kind/control-plane/kafka-handlers.mjs:90`.
- **Proposed solution:** derive the control-plane physical name from the unique workspace id (align with
  `events-executor.mjs`); key `workspace_topics` by `(workspace_id, topic_name)`.
- **Acceptance:** two same-slug workspaces across tenants get distinct physical topics + distinct resourceIds; both
  tenants can provision & use their topic; JWT and apiKey paths resolve to the same physical topic.

### B2 — Storage: bucket registry hijack via slug-derived name collision · `fix-storage-bucket-tenant-scope`
- **Labels:** `bug` `P1` `security` `tenant-isolation` `cap:storage` `openspec`
- **Problem [agent]:** two tenants' default bucket name `ws-app-staging-assets` (slug-derived) collide;
  `insertBucket` `ON CONFLICT (bucket_name) DO UPDATE SET tenant_id=EXCLUDED.tenant_id` silently overwrites the first
  tenant's registry row → their bucket disappears from their list. `tenant-store.mjs::insertBucket`.
- **Proposed solution:** include the workspace id in the physical bucket name; key the registry by `(workspace_id,
  bucket_name)`; never let `ON CONFLICT` cross tenant_id.
- **Acceptance:** same-slug workspaces across tenants get distinct buckets; neither can hijack the other's registry row.

### B3 — Executor DDL must validate target-DB ownership + close the trust boundary · `fix-executor-ddl-db-ownership-guard`
- **Labels:** `bug` `P1` `security` `tenant-isolation` `cap:database` `openspec`
- **Problem:** the executor DDL path executes against the literal URL `{db}` without checking it belongs to the caller's
  workspace/tenant. Via the **gateway-bypass trust-header** path (no workspace, `GATEWAY_SHARED_SECRET` unset on the
  executor) this reaches the platform DB `in_falcone`. The tenant-facing **apiKey path is confined** (no tenant leak).
- **Repro/evidence [verified]:** trust-header `POST /v1/postgres/databases/in_falcone/schemas` → schema created in
  `in_falcone`. ApiKey path targeting `in_falcone`/globex lands in the caller's own ws DB (no leak). `postgres-ddl-executor.mjs` ~line 124.
- **Proposed solution:** resolve/validate the target DB against the caller's workspace ownership; reject `in_falcone`
  and non-owned DBs (fail-closed); set `GATEWAY_SHARED_SECRET` on the executor so it does not openly honor trust headers.
- **Acceptance:** DDL on a non-owned DB or `in_falcone` → 403; own-workspace DDL unaffected; executor rejects unsigned
  trust headers.

### B4 — Activate per-tenant SeaweedFS identities · `fix-activate-seaweedfs-tenant-identities`
- **Labels:** `bug` `P1` `security` `tenant-isolation` `cap:storage` `infra` `openspec`
- **Problem [verified]:** `STORAGE_TENANT_IDENTITIES` is absent from the deployed control-plane env (the campaign
  values overlay's full-list env replace drops it); every storage provision returns `storageCredential:null`; a single
  shared admin S3 identity reads/writes all tenants' buckets. (#553 shipped the mechanism but it is gated off here.)
- **Proposed solution:** ensure the flag is set in every profile (or default-on); verify the per-workspace identity
  provision/rotate/revoke path issues real per-tenant SeaweedFS credentials and the storage API vends them.
- **Acceptance:** each workspace gets a distinct S3 identity scoped to its bucket prefix; tenant A's S3 credential
  cannot list/read/write tenant B's buckets.

---

## EPIC C — Governance, lifecycle & flows defects
**Labels:** `epic` `bug` `P1`
### C1 — Plan-impact usage column overflow · `fix-plan-impact-usage-bigint`
- **Labels:** `bug` `P1` `cap:quotas-plans` `openspec`
- **Problem/evidence [agent]:** `POST /v1/tenants/{id}/plan` → 500; `tenant_plan_quota_impacts.observed_usage` is
  `INTEGER` but usage is reported in bytes (e.g. 5 GB) → overflow. No tenant can be assigned a plan (campaign saw
  `plan=None` for both). Migration `100-plan-change-impact-history.sql`.
- **Solution:** change `observed_usage` (and sibling usage columns) to `BIGINT`. **Acceptance:** plan assign → 2xx;
  entitlements reflect the plan; large byte usage stored without error.

### C2 — Scheduling handler missing from the control-plane image · `fix-scheduling-handler-dockerfile`
- **Labels:** `bug` `P1` `cap:scheduling` `deployment` `openspec`
- **Problem/evidence [agent]:** every `/v1/scheduling/*` → 500 `ERR_MODULE_NOT_FOUND`;
  `services/scheduling-engine/actions/scheduling-management.mjs` is in `route-map.runtime.json` but **not COPY'd** in
  `apps/control-plane/Dockerfile`. **Solution:** add the COPY (and a startup check that every route-map handler
  resolves). **Acceptance:** `/v1/scheduling/*` returns business responses; image build fails if a handler is missing.

### C3 — Flow/webhook trigger schema missing · `fix-flow-trigger-schema`
- **Labels:** `bug` `P1` `cap:workflows` `cap:webhooks` `openspec`
- **Problem/evidence [agent]:** publishing a flow with a platform-event or webhook trigger → 502
  `TRIGGER_REGISTRATION_FAILED`; executor log: `relation "flow_trigger_registrations" does not exist` (also
  `flow_trigger_secrets`). The governance schema bootstrap omits these tables. **Solution:** add the trigger tables to
  the governance migration set. **Acceptance:** event/webhook trigger registration succeeds; event→flow runs E2E.

### C4 — Flows worker DB wiring + Temporal search attributes · `fix-flows-worker-pg-env-and-search-attrs`
- **Labels:** `bug` `P1` `cap:workflows` `deployment` `openspec`
- **Problem/evidence [agent]:** the workflow `db.query` activity → UPSTREAM_UNAVAILABLE because the worker deployment
  lacks PGHOST/PGUSER/PGPASSWORD/PGDATABASE; and the dev Temporal namespace's 5 custom search attributes are not
  auto-registered on a fresh install. **Solution:** inject the PG env into the worker; run a search-attribute bootstrap
  step. **Acceptance:** a flow's `db.query` activity returns rows; flow execution does not 500 on a missing search attr.

### C5 — Audit enforcement logging · `fix-audit-enforcement-logging`
- **Labels:** `bug` `P2` `cap:audit` `security` `openspec`
- **Problem/evidence [agent]:** quota denials (402) and cross-tenant denials (403) fire but `quota_enforcement_log` and
  `scope_enforcement_denials` stay empty. **Solution:** write an audit record at each enforcement point.
  **Acceptance:** a 402/403 produces a correlated audit row.

---

## EPIC D — App auth-as-a-service & IAM completeness
**Labels:** `epic` `P1` `cap:iam-admin`
### D1 — IAM user creation drops credentials · `fix-iam-user-credentials`
- **Labels:** `bug` `P1` `cap:iam-admin` `openspec`
- **Problem/evidence [verified]:** `POST /v1/iam/realms/{realm}/users` with `credentials:[{type:password,…}]` creates
  the user but `GET …/users/{id}/credentials` → `[]` (no password) → ROPC login `invalid_grant`. After a KC-admin
  password set, login works (200) and the token carries an un-forgeable `tenant_id`. **Solution:** pass the credentials
  through to Keycloak on create (or expose a set-password sub-route). **Acceptance:** a user created with a password can
  immediately log in.

### D2 — Tenant-owner app-end-user management · `add-tenant-owner-enduser-management`
- **Labels:** `enhancement` `P1` `cap:iam-admin` `openspec`
- **Problem/evidence [agent/verified]:** a tenant_owner cannot list its own app end-users (`GET /v1/iam/realms/{id}/users`
  → 403 superadmin-only); there is no owner-facing end-user management API (list/view/disable/delete). **Solution:** a
  project-scoped end-user management API authorized for the owning tenant. **Acceptance:** owner lists/disables/deletes
  only its own project's end-users; cross-tenant denied.

### D3 — Wire the catalogued IAM routes · `fix-iam-route-wiring`
- **Labels:** `bug` `P2` `cap:iam-admin` `openspec`
- **Problem/evidence [agent]:** `getIamUser`, `getIamRole`/`deleteIamRole`, and realm-CRUD are in the route catalog but
  return 404 in the deployed runtime. **Solution:** register the handlers (or remove from the catalog). **Acceptance:**
  catalogued IAM routes resolve.

### D4 — Project auth-method / IdP configuration API · `add-project-auth-method-config-api`
- **Labels:** `enhancement` `P2` `cap:iam-admin` `openspec`
- **Problem/evidence [agent]:** the per-tenant realm + `{slug}-app` client + auth-method templates exist, but
  enabling username/email vs social IdPs is only doable via raw Keycloak admin — no Falcone API. **Solution:** a
  project-scoped API to toggle auth methods + configure social providers (credentials redacted). **Acceptance:** owner
  enables/disables a method via the API and the app's login options reflect it.

---

## EPIC E — Data-plane API contract mismatches (P2)
**Labels:** `epic` `bug` `P2` `cap:database` `cap:document-store` `cap:functions`
### E1 — Postgres DDL column contract + primary key · `fix-ddl-column-contract-and-pk`
- **[agent]** create-table requires `columnName/dataType` (not `name/type`), and `primaryKey:true` emits no PK
  constraint (tables unusable for by-PK CRUD). **Acceptance:** documented contract accepted; `primaryKey` creates a PK.
### E2 — Data-API field/path mismatches · `fix-data-api-contract-mismatches`
- **[agent]** mongo db-provision needs `name` not `databaseName` (400); executor function deploy `{source:{inlineCode}}`
  fails at invoke; route-catalog bulk path `…/bulk/insert` vs executor `…/rows/bulk/insert`; apikey list snake_case vs
  mint camelCase. **Acceptance:** the OpenAPI-documented shapes work, or the catalog/docs are corrected to match.

---

## EPIC F — Console & deployment robustness
**Labels:** `epic` `P1` `deployment` `cap:web-console`
### F1 — Console operator shell role-gating · `fix-console-operator-shell`
- **Labels:** `bug` `P1` `cap:web-console` `openspec`
- **[agent]** `/console/my-plan` (and plans/tenants) call superadmin-only routes → 403 for tenant_owners (no role gate);
  `/v1/console/session` referenced in the bundle → 404. **Acceptance:** operator pages use operator-authorized routes
  or are hidden by role; no dead `/v1/console/session`.
### F2 — SeaweedFS netpol must allow the bucket-provisioning hook · `fix-seaweedfs-netpol-bucket-hook`
- **Labels:** `bug` `P1` `infra` `deployment` `cap:storage` `openspec`
- **[verified]** the `seaweedfs-internal-only` netpol restricts master/filer ports to `app.kubernetes.io/name:
  seaweedfs`, but the upstream bucket-hook pod has no such label → on enforcing CNIs the hook hangs → `helm install`
  hangs. The chart comment wrongly assumes "kind does not enforce NetworkPolicy." **Acceptance:** a from-scratch install
  on a NetworkPolicy-enforcing cluster completes without disabling the netpol.
### F3 — Install health-gate probe accuracy · `fix-install-health-gate-probes`
- **Labels:** `bug` `P2` `deployment` `openspec`
- **[verified]** health gate probes `apisix /health` (404 — `/v1/*` routing is fine) and `ferretdb:27017` from an
  unlabeled smoke pod (netpol-blocked though reachable from the executor) → false failures. **Acceptance:** the gate
  probes paths/clients that reflect real health.
### F4 — Prometheus APISIX scrape target · `fix-apisix-metrics-target`
- **Labels:** `bug` `P2` `cap:observability` `openspec`
- **[agent]** the APISIX Prometheus target is DOWN (returns HTML, not metrics). **Acceptance:** APISIX exposes a metrics
  endpoint and the target is UP.

---

## EPIC G — Advanced-capability completion (mostly enhancement)
**Labels:** `epic` `P2` `cap:mcp` `cap:workflows` `cap:gateway`
### G1 — Expose the platform MCP server over HTTP · `add-platform-mcp-http-route`
- **[agent]** `mcp-official-server.mjs` (9 mgmt tools) exists but has no HTTP route in `server.mjs` → C25 not reachable.
  **Acceptance:** an MCP client connects to the platform MCP and manages projects/resources (tenant-scoped).
### G2 — MCP JSON-RPC / Streamable-HTTP protocol surface · `add-mcp-jsonrpc-protocol`
- **[agent]** MCP server hosting works via the internal mgmt API, but the standard MCP wire protocol is not exposed for
  external clients. **Acceptance:** a standard MCP client lists+calls tools over the protocol.
### G3 — Gateway routes for flows + MCP · `add-gateway-flows-mcp-routes`
- **[agent]** APISIX has no `/v1/flows` or `/v1/mcp` route (executor-direct only). **Acceptance:** flows/MCP reachable
  through the gateway with auth.
### G4 — Event→function/flow triggers end-to-end · `add-event-driven-triggers`
- **[agent]** Kafka→function trigger not-deployed; event→flow blocked by the missing trigger schema (EPIC C3).
  **Acceptance:** a Kafka event invokes a function and/or starts a workflow E2E.

---

### Severity roll-up
- **P0 (1):** A1 Keycloak persistence.
- **P1 (12):** B1 events-collision, B2 storage-collision, B3 DDL-trust-boundary, B4 S3-identities, C1 plan-overflow,
  C2 scheduling-dockerfile, C3 flow-trigger-schema, C4 worker-pg-env, D1 iam-credentials, D2 owner-enduser-mgmt,
  F1 console-operator, F2 swfs-netpol.
- **P2 (≈11):** C5 audit-logging, D3 iam-routes, D4 auth-method-api, E1/E2 contracts, F3 health-gate, F4 apisix-metrics,
  G1–G4 advanced-caps.

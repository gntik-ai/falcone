# Falcone — Live End-to-End Test Campaign Report

**Date:** 2026-06-17 · **Cluster:** kind `test-cluster-b` (remote, API-server access only) · **Branch:** `test/live-e2e-campaign-2026-06-17`
**Method:** Empirical only — every result below comes from an actual call against the running system, not code review. Evidence (HTTP statuses, logs, claims) is inline.

> Scope note: this campaign **rebuilt all app images from current `main` HEAD**, did a **full namespace teardown + fresh install** of the current chart with **freshly-authored secrets**, on the **post-migration stack** (FerretDB/DocumentDB, SeaweedFS, Knative; Vault as the intended — but unwired — secrets backend). Getting to a usable platform required working around **~12 deployment/auth defects** (themselves findings, §3). Once up, two tenants (`acme`, `globex`) with users, projects, app end-users, topics and API keys were seeded and exercised.

---

## 1. Headline results

- **TOP PRIORITY — tenant isolation: MIXED.** Control-plane cross-tenant access is correctly denied (403 across tenant/workspace/metrics/entitlements). **BUT a verified P0 cross-tenant IDOR exists** in the data-plane: a tenant owner of one tenant can mint an API key in **another tenant's** workspace and use it to reach that tenant's data-plane (§4, F1).
- **The current running deployment (pre-campaign) was mid-migration** — it still ran a MongoDB StatefulSet, a MinIO-named NodePort and an OpenWhisk svc-stub, and its control-plane/executor pointed at **MongoDB, not FerretDB** (§3, D8). The fresh install from current source removes these.
- **FerretDB / Mongo data API is broken** in this build — neither the control-plane nor a direct Mongo client can authenticate to FerretDB (§4, F2).
- **The chart cannot be installed unattended** on kind from current source: ferretdb host bug, `--wait` deadlock, missing `GATEWAY_SHARED_SECRET`, a bootstrap Job that fails, console clients missing the `roles` scope, and a control-plane that never retries DB migrations (§3).
- **Vault is not a functioning secrets backend** (cert-manager absent → enabling it aborts the release; and no component reads from Vault) (§3, D7).
- Many advanced capabilities are **not deployed in the kind profile** (realtime, workflows/Temporal, MCP, CDC, webhooks, backup-execute, audit-write) — see §5.

---

## 2. Functionality status matrix

Legend: **Active/Working** = exercised end-to-end with passing assertions · **Broken** = deployed but errored · **Inactive/Not-deployed** = no live backing in this profile · **Partial** = some paths work.

| Capability | Surface(s) exercised | Status | Evidence |
|---|---|---|---|
| Tenant lifecycle (create/list/get/delete) | REST (superadmin) | **Active/Working** | `POST /v1/tenants`→201 (acme,globex); `GET /v1/tenants`→200; delete probe→2xx |
| Workspaces / projects (create/list) | REST (ops token) | **Active/Working** | `POST /v1/tenants/{id}/workspaces`→201; `GET …/workspaces`→200 |
| Environments | REST | **Partial** | workspace `environment` validated to `{dev,staging,prod,sandbox,preview}` (400 on `production`); no first-class env CRUD surface |
| Tenant users | REST | **Active/Working** | `POST /v1/tenants/{id}/users`→201 (in tenant realm) |
| App end-users (auth-as-a-service) | REST + Keycloak | **Partial/Broken** | signup→201 into tenant realm; but **no tenant-realm login endpoint** and data-plane rejects tenant-realm tokens (§3 A3) |
| Console auth (superadmin/platform) | REST→Keycloak | **Active/Working (after fixes)** | `POST /v1/auth/login-sessions`→201 with `tokenSet`; required A1/A2 fixes |
| AuthZ (roles) | REST | **Active/Working (after fix)** | superadmin role enforced (403→201 after adding `roles` scope, A2) |
| Quotas / plans / entitlements | REST | **Partial** | entitlements + cross-tenant 403 guard work; `GET /v1/plans`→**500** (F3) |
| Metrics (console) | REST | **Broken** | `GET /v1/metrics/tenants/{id}/quotas`→**500** (`Forbidden` + `42P01`) (F4) |
| Metrics (Prometheus) | `/metrics` scrape | **Active** | Prometheus + Grafana pods Running; scrape endpoints served |
| Object storage (REST + direct S3) | REST + aws-cli→SeaweedFS | **Active/Working** | `GET /v1/storage/buckets`→200; `aws s3 ls`→OK (direct SeaweedFS) |
| PostgreSQL data API | REST (browse) + executor (apikey DDL) | **Partial/Working** | browse→200; DDL create schema (apikey)→201; table-create body/row-CRUD unconfirmed |
| PostgreSQL (direct) | psql/pg via port-forward | **Active in-cluster** | control-plane connects (schema ready, `tenants` table); external client cred path unverified |
| Mongo / FerretDB data API | REST + executor + direct | **Broken** | browse→500; insert/list docs→500; direct mongo→`Authentication failed`; control-plane log `HandshakeError` (F2) |
| Events / Kafka | REST + executor (apikey) | **Active/Working** | inventory→200; create topic (apikey)→201 |
| Functions (Knative) | REST | **Partial** | inventory→200; Knative Serving live + fn RBAC applied; deploy/invoke not exercised end-to-end this run |
| Realtime (PG SSE / Mongo SSE) | — | **Inactive/Partial** | PG-table SSE has no env gate; Mongo SSE needs FerretDB (broken). Not exercised |
| Workflows (Temporal) | — | **Not-deployed** | `temporal`/`workflowWorker` disabled; `TEMPORAL_ADDRESS` unset → `/v1/flows/*` 501 |
| MCP hosting / MCP→workflow / platform MCP | — | **Not-deployed** | `mcp` component disabled; `MCP_ENABLED` unset → `/v1/mcp/*` not registered |
| CDC (pg / mongo) | — | **Not-deployed** | no cdc-bridge pods in kind profile |
| Webhooks | — | **Not-deployed** | only the flows webhook-trigger route exists; dead without Temporal |
| Scheduling / cron | — | **Unverified** | `ANY /v1/scheduling/*` present; requires schema + tenant/workspace headers |
| Backup / restore | — | **Partial** | read-only scope routes only; no execute/restore route live |
| Audit (write side) | — | **Not-deployed** | no audit store; `metrics …/audit-records` empty |
| Secrets backend (Vault) | — | **Not-wired** | secrets are plain k8s Secrets; Vault non-viable on kind (D7) |
| Web console (admin surface) | SPA served | **Served, not driven** | console pod Running + served; Playwright drive-through not run this campaign (budget) |
| MongoDB / MinIO / OpenWhisk present? | cluster | **Finding (pre-campaign)** | present in the *running* release; **absent** after fresh install from current source (D8) |

---

## 3. Deployment & auth-model findings (surfaced by the mandated fresh install)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| D1 | High | ferretdb init container hardcodes documentdb host `in-falcone-documentdb` (chart-name prefix); for release `falcone` the service is `falcone-documentdb` → pod stuck `Init:0/1` forever | `charts/in-falcone/values.yaml:2129`; pod log `in-falcone-documentdb:5432 - no response` |
| D2 | High | Keycloak bootstrap Job **fails** on a fresh kind install (its APISIX-standalone reconciliation phase), so the platform realm is never provisioned | Job `falcone-in-falcone-bootstrap` → `Failed`; realm POSTs fine manually (201) so the realm payload is valid → failure is the reconcile phase |
| D3 | High | APISIX standalone config references `${{GATEWAY_SHARED_SECRET}}` but the chart/kind values never set it → APISIX CrashLoop | pod log `can't find environment variable GATEWAY_SHARED_SECRET` |
| D4 | High | `helm install --wait` **deadlocks**: ferretdb (main resource) waits on the `documentdb_api` schema created by a *post-install hook* | helm: `falcone-ferretdb not ready … Progress deadline exceeded` |
| D5 | High | control-plane runs DB migrations once on boot and **never retries** on `ECONNREFUSED`; if Postgres isn't ready, `tenants` table is missing and every tenant op 500s | log `schema/recovery failed: connect ECONNREFUSED …:5432`; `relation "tenants" does not exist`; fixed by pod restart |
| D6 | Medium | Platform secrets are hand-created and referenced as `existingSecret`; the chart regenerates only the SeaweedFS creds → a namespace delete is unrecoverable without external secret tooling | `helm get … secrets` show `managed-by: <none>` for all but seaweedfs |
| D7 | High | **Vault is not a working secrets backend**: vault subchart's TLS cert is a `cert-manager.io/v1 Certificate` but cert-manager is absent → `vault.enabled=true` aborts the release; and **no Falcone component reads from Vault** (ESO disabled) | render shows vault Certificate; all apps use `envFromSecrets`/`secretKeyRef` |
| D8 | High | **Incomplete migration in the *running* (pre-campaign) deployment**: live release still had a `falcone-mongodb` StatefulSet, a `lan-minio-console` NodePort, an `openwhisk` svc-stub, and control-plane/executor env pointed at **MongoDB** (not FerretDB) | `helm get values` (rev 47): `MONGO_HOST: falcone-mongodb`, `mongodb`/`openwhisk`/`storage(minio)` stanzas |
| A1 | Medium | superadmin user created **disabled** by the bootstrap payload → cannot log in until enabled | login→401 `Account disabled`; PUT enabled→login 201 |
| A2 | High | `in-falcone-console`/`in-falcone-gateway` clients created **without the standard `roles`/`basic`/`profile` default scopes** → tokens carry no `realm_access.roles` → all role-based authz 403s | token claims had only `openid` scope, no roles; adding `roles` scope → `superadmin` appears → 403→201 |
| A3 | High | **Realm-per-tenant auth is unusable as shipped**: tenant users land in the tenant realm, but (a) the tenant realm gets **no client / no `tenant_id` mapper**, and (b) the executor verifies JWTs only against the **platform realm JWKS** → tenant tokens are rejected `Missing tenant identity` | owner ROPC token (tenant realm) → api-key issuance 401 `Missing tenant identity` even with `tenant_id` claim |
| A4 | Medium | Platform realm declarative user profile **drops the `tenant_id` attribute** (unmanaged-attr policy off) → even platform users can't carry tenant scope without enabling unmanaged attributes | setting `tenant_id` attr → absent from token until `unmanagedAttributePolicy=ENABLED` |

> These were worked around in the campaign harness (`tests/live-campaign/provision-platform-realm.sh`, `provision-tenant-auth.sh`, secret/env fixes in `install.sh`/`make-secrets.sh`/`values-campaign.yaml`) — the platform was made to function, then tested.

---

## 4. Functional defects (capabilities deployed but broken)

### F1 — P0 cross-tenant IDOR: data-plane API-key issuance ignores workspace↔tenant ownership
**Surface:** `POST /v1/workspaces/{workspaceId}/api-keys` (executor). **Severity: P0 (cross-tenant data exposure).**
**Reproduction (verified):**
1. As `acme-ops` (token `tenant_id = <acme>`), call `POST /v1/workspaces/<GLOBEX_workspace>/api-keys` → **201**, returns `flc_anon_…` key.
2. Use that acme-minted key against globex's workspace data: `GET /v1/postgres/workspaces/<GLOBEX_workspace>/data/postgres/schemas/public/tables/x/rows` → **404 `TABLE_NOT_FOUND`** (i.e. *authorized to globex's database*, not denied).
**Contrast:** acme's *own* key against globex's workspace → **403** (correctly denied). So per-key scoping is fine; the **issuance route fails to check that `{workspaceId}` belongs to the caller's tenant**.
**Expected:** issuance in another tenant's workspace → 403/404. **Acceptance:** the api-keys route must resolve the workspace's owning tenant and reject if it ≠ caller's `tenant_id`.

### F2 — Mongo/FerretDB data API broken (authentication to FerretDB fails)
**Surface:** `/v1/mongo/*` (browse + data), direct Mongo driver. **Severity: High.**
**Evidence:** `GET /v1/mongo/databases`→500; insert/list documents→500 `CONTROL_PLANE_ERROR`; control-plane log `MongoServerError … HandshakeError`; direct `mongosh`-equivalent with documentdb creds → `Authentication failed`. The control-plane's `MONGO_USER=falcone` + documentdb password does not authenticate against the FerretDB gateway.

### F3 — `GET /v1/plans` (superadmin) → 500
Provisioning-orchestrator `plan-list` action errors. (Entitlement/consumption sub-routes do respond.)

### F4 — `GET /v1/metrics/tenants/{id}/quotas` → 500
`metrics-handlers.mjs:49 tenantLimits` throws `Forbidden`; a related path returns `42P01` (missing relation). Console metrics quota view is non-functional.

### F5 — Mongo database provisioning → 400
`POST /v1/workspaces/{w}/databases {engine:mongodb}` → 400 (consistent with F2; the document engine path is unhealthy).

---

## 5. Isolation results (Phase 3 — top priority)

| Probe | Expected | Actual | Verdict |
|---|---|---|---|
| `acme-ops` → `GET /v1/tenants/{globex}` | deny | **403** | PASS |
| `acme-ops` → `GET /v1/tenants/{globex}/workspaces` | deny | **403** | PASS |
| `acme-ops` → `GET /v1/tenants/{globex}/plan/effective-entitlements` | deny | **403** | PASS |
| `acme-ops` → `GET /v1/metrics/tenants/{globex}/quotas` | deny | **403** | PASS |
| acme's **own** API key → globex workspace data | deny | **403** | PASS |
| **`acme-ops` → `POST /v1/workspaces/{globex-ws}/api-keys`** | **deny** | **201** | **FAIL (F1)** |
| acme-minted key → read globex workspace data | deny | **404 (authorized)** | **FAIL (F1)** |
| Direct S3 (SeaweedFS) scoping | — | creds list buckets; per-tenant bucket scoping not deep-probed (budget) | Partial |

**Conclusion:** control-plane request-path isolation holds; the data-plane key-issuance path has a confirmed cross-tenant breach (F1).

---

## 6. What could NOT be fully tested (and why)

- **Web console Playwright drive-through, API↔console parity** — console served & reachable; full UI automation deferred (budget consumed by the deployment defects). Recommend a follow-up `/build-e2e` run now that the platform is up.
- **Functions deploy→invoke, Kafka→workflow/function, realtime WS push** — functions inventory works and Knative is live, but FerretDB being broken + Temporal/MCP not deployed blocks the event→workflow and realtime-Mongo paths.
- **Workflows / MCP hosting / MCP→workflow / platform MCP** — **not deployed in the kind profile** (components disabled, env flags unset). These are *expected-but-absent* in this deployment, not silently skipped.
- **Social OAuth end-user login** — no external IdP credentials (per pre-campaign decision); auth-config wiring was the target, but A3 blocks the tenant-realm login path.
- **Direct PostgreSQL from an external client** — the platform connects in-cluster (proven), but the external client credential path returned an auth failure that looks like a harness cred-capture issue, not a platform defect; flagged for follow-up.
- **Vault** — intentionally not enabled in the core install (D7: would abort the release); confirmed not wired.

---

## 7. Reproducibility / harness

All campaign scripts are on the feature branch under `tests/live-campaign/` (see §8 of the task list): `build-images.sh`, `push-images.sh`, `teardown.sh`, `make-secrets.sh`, `values-campaign.yaml`, `registry.yaml`, `install.sh`, `provision-platform-realm.sh`, `provision-tenant-auth.sh`, `seed.mjs`, `run-tests.mjs`, `lib/{client.mjs,creds.sh,portforward.sh}`. Seeded fixtures (`/.fixtures.json`) and any secret-bearing files are gitignored. Raw enumeration in `audit/live-campaign/01-…03-…md`; machine results in `audit/live-campaign/results.json`.
</content>

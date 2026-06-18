# Phase 0 — Full test matrix (live campaign 2026-06-18)

Derived from: the live REST surface (`01-rest-surface.md`), the web-console surface
(`02-console-surface.md`), the deployed-services map (`03-services-and-harness.md`),
the public route catalog (`services/internal-contracts/src/public-route-catalog.json`),
the chart component toggles (`charts/in-falcone/values.yaml`), the advanced-caps overlay
(`deploy/kind/values-kind-advanced.yaml`), and the operator's mandatory baseline.

Surfaces under test: **GW** = APISIX gateway (real-user path, `:9080`) · **CP** = control-plane
direct · **EXEC** = cp-executor direct (data-plane / trust-header) · **KC** = Keycloak OIDC ·
**PG/MONGO/S3** = direct datastore clients · **Console** = web-console (Playwright) ·
**Promethe./Grafana** = metrics.

Status vocabulary: **Active/Working** · **Broken** (deployed but errors) · **Inactive/Not-deployed**
(no live backing) · **Partial**.

| # | Capability / functionality | Surfaces to exercise | Isolation probe? | Mandatory? |
|---|---|---|---|---|
| C1 | Tenant lifecycle: create / list / get / delete / purge-cascade | GW+CP (superadmin), Console | cross-tenant GET/list/delete | yes |
| C2 | Tenant users (company users) create/list | GW+CP, Console | A-user cannot see B-users | yes |
| C3 | Projects (workspaces) create/list/get; **quota enforcement on project limit** | GW+CP (ops), Console | A cannot list/get B workspaces | yes |
| C4 | Environments (prod/staging/dev) relation to project | GW+CP, Console | per-env resource scoping | yes |
| C5 | Plans / quotas / entitlements / consumption / overrides | GW+CP (superadmin+ops) | cross-tenant 403 on entitlements/quotas | yes |
| C6 | Console auth (platform/superadmin) login-sessions + refresh + logout | GW→KC, Console | — | yes |
| C7 | AuthZ roles (superadmin vs tenant_owner vs authenticated) | GW+CP | role escalation denied | yes |
| C8 | IAM admin (realms/users/roles/groups/clients/role-assignments) | GW+CP (superadmin) | A realm-admin cannot touch B realm | yes |
| C9 | App auth-as-a-service: predefined KC auth-method **templates** preloaded per project; enable username/password (username **or** email); enable social OAuth provider(s); toggle → login options change | KC realms, GW, Console | per-project auth config isolated | yes |
| C10 | App end-user: register → login (pwd) → token → authorized call; login via social provider | KC, GW | end-user of A cannot reach B | yes |
| C11 | App end-user management by owner (list/view/disable/delete) | GW+CP/IAM, Console | owner A cannot manage B's end-users | yes |
| C12 | Service accounts + API keys / credentials (issue/rotate/revoke) | GW+EXEC (admin JWT) | **A cannot mint key in B's ws (F1 re-test)** | yes |
| C13 | PostgreSQL data API: DDL (schema/table/col/index) + CRUD rows + vector search | GW+EXEC (apikey), Console browse | A key → B ws data denied; shared-DB leak probe | yes |
| C14 | Direct PostgreSQL connection (psql), scoped per project/env | PG (port-forward) | direct cross-tenant read attempt | yes |
| C15 | Mongo/Document data API (FerretDB): DDL/collections + document CRUD | GW+EXEC (apikey), Console browse | A key → B ws docs denied | yes |
| C16 | Direct NoSQL/FerretDB connection (mongo driver), scoped | MONGO (port-forward) | direct cross-tenant read attempt | yes |
| C17 | Object storage REST: buckets provision/list, object put/get/list/delete, usage | GW+CP, Console | A → B bucket/object denied | yes |
| C18 | Direct S3/SeaweedFS access (S3 client), scoped per project | S3 (port-forward) | direct cross-tenant bucket access | yes |
| C19 | Events/Kafka: topic create/list/publish/consume(SSE) | GW+CP+EXEC, Console | A → B topic denied | yes |
| C20 | Functions (Knative): deploy + invoke (API) + result + logs + activations | GW+CP (Knative), Console | A → B function denied; per-project ns | yes |
| C21 | **Event-driven**: produce Kafka event → consumed by workflow engine and/or a function (end-to-end) | GW+Kafka+Temporal/fn | event-handler tenant-scoped | yes |
| C22 | **Workflows (Temporal/Flows)**: define/publish/run flow, observe execution + result | GW+EXEC (`/v1/flows/*`), Temporal | A → B flow denied | yes |
| C23 | **MCP server hosting**: create/host MCP server, connect client, list+call tools; tenant-scoped | GW+EXEC (`/v1/mcp/*`), MCP client | A → B MCP server denied | yes |
| C24 | **MCP → workflow**: MCP tool call triggers a Falcone workflow and returns its result | MCP client → flow | — | yes |
| C25 | **Falcone platform MCP interface**: connect MCP client to platform MCP, manage Falcone (projects/resources) | platform MCP server | tenant-scoped | yes |
| C26 | **Realtime**: subscribe (SSE; note: not WS) → DB change → push delivered | GW+EXEC (`/v1/realtime/*/changes`) | A subscription sees only A data | yes |
| C27 | Secrets/config: set secret/env; available to fn/service; isolated per env (never print value) | GW+EXEC, Vault status | per-env isolation | yes |
| C28 | Quotas / plan governance enforcement (project cap, rate-limit 429) | GW (limit-count), CP | per-tenant limits | yes |
| C29 | Audit logging: actions logged with correlation | GW+CP (audit-records/quota-audit/scope-enforcement) | per-tenant audit scope | yes |
| C30 | Provisioning lifecycle: create + delete project/env; resources provisioned + fully cleaned up | GW+CP, datastores | no orphaned cross-tenant data | yes |
| C31 | Metrics: Prometheus scrape + Grafana dashboards show real data | `/metrics`, Grafana | — | yes |
| C32 | **API ↔ Console parity & completeness**: resource via API appears complete in console & vice-versa; lists/fields match | GW+Console | — | yes |
| C33 | Web console admin surface: every page/action works | Console (Playwright) | console respects tenant scope | yes |
| C34 | CDC bridges (pg-cdc / mongo-cdc) | GW (`/pg-captures`, `/mongo-captures`) | tenant-scoped | derived |
| C35 | Webhooks (flow webhook ingestion) | GW (`/triggers/webhooks/{id}`) | — | derived |
| C36 | Scheduling / cron jobs | GW (`/v1/scheduling/*`) | tenant-scoped | derived |
| C37 | Backup / restore | GW (`/v1/admin/backup/*`, `/tenants/{t}/backup/*`) | tenant-scoped | derived |

## Stack-under-test verification (any old component = a finding)

| S# | Check | Expect | Finding if… |
|---|---|---|---|
| S1 | Document DB engine | **FerretDB/DocumentDB** pods; Mongo-wire compatible | a **MongoDB server** workload exists |
| S2 | Object storage | **SeaweedFS** pods (master/volume/filer/s3) | a **MinIO** workload exists |
| S3 | Functions runtime | **Knative** Serving (per-fn ksvc) | an **OpenWhisk** workload/svc exists |
| S4 | Secrets backend | **Vault** (expected; OpenBao migration not done) | — (Vault is current, NOT a finding) |

## Phase 3 — Isolation probe surfaces (top priority; every "yes" above + these)

Across **≥2 tenants (acme/globex)**, multiple users + projects (prod/staging envs), attempt cross
access and confirm DENY on: REST mgmt, REST data (apikey), console, **direct PG**, **direct FerretDB**,
**direct S3**, functions, events, secrets, realtime SSE, app-end-user/auth scope (an end-user of one
project must not reach another), and tenant↔tenant. Capture each empirical result (status + body).

## Execution surfaces / harness

- Gateway path (real-user): campaign `tests/live-campaign/lib/client.mjs` (`:9080`).
- Direct CP/EXEC + trust-header + apikey + direct datastores: `tests/live-audit/lib/lib.sh`
  (`cp`/`exk`/`exh`/`mint_key`/`sa_token`/`ksecret`) + per-capability specs under
  `tests/live-audit/specs/`.
- Port-forwards: CP 18080 · KC 18081 · EXEC 18082 · PG 15432 · ferretdb 17017 ·
  seaweedfs-s3 18333 · apisix(GW) 9080 · prometheus/grafana as needed.
</content>
</invoke>

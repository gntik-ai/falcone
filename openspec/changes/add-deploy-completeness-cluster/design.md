# Design — add-deploy-completeness-cluster (#562)

Three independent deployment-completeness gaps surfaced by the live 2-tenant E2E campaign
(2026-06-18). Each is resolved below; the cardinal multitenant rule (tenant isolation) governs (a).

## (a) Single-workspace cascading teardown API — the main deliverable

**Gap:** only the TENANT purge cascaded (`POST /v1/tenants/{tenantId}/purge`); a single
project/workspace could not be torn down. `DELETE /v1/workspaces/{workspaceId}` was NO_ROUTE, so a
retired workspace's `wsdb_*` database, bucket(s), topic(s), and service-account/api-key rows leaked.

**Decision:** mirror the tenant-purge cascade for ONE workspace. The building blocks already exist:
the kind runtime's `purgeTenant` (collect physical resources → delete rows) and the teardown ops
`dropWorkspaceDatabase` / `deleteBucket` / `deleteTopics`.

- **Kind runtime** (`deploy/kind/control-plane/`):
  - `tenant-store.mjs::purgeWorkspace(pool, workspaceId)` — collects the workspace's owned physical
    resources (its `wsdb_*` database, bucket(s), topic(s), ksvc names) then deletes its child rows
    and finally the workspace row, all keyed by `workspace_id`. Best-effort per table (`42P01`
    ignored), idempotent. A workspace-scoped sibling of `purgeTenant`.
  - `b-handlers.mjs::deleteWorkspace(ctx)` — resolves the workspace FIRST, then gates ownership
    (`canManageTenantId`): superadmin/internal may delete any; a tenant owner/admin only a workspace
    whose `tenant_id` matches their verified identity. A missing OR cross-tenant workspace returns
    `404` with NO teardown (no existence leak — matching the storage/kafka resolve-then-gate idiom,
    `404` rather than `403`). Then runs `purgeWorkspace` and best-effort physical teardown (DB drop,
    bucket/topic delete), reporting what was removed. Teardown ops are injectable via `ctx` for
    black-box testing (defaulting to the real module functions, the `ctx.kcAdmin ?? kcAdmin` idiom).
  - `routes.mjs` — registers `DELETE /v1/workspaces/{workspaceId}` (auth `authenticated`; the handler
    authorizes own-tenant). No new `*.mjs` module → no Dockerfile COPY change needed.

- **Shippable product** (`apps/control-plane/src/workspace-management.mjs`):
  - `handleWorkspaceDeleteRequest({ workspace, actorUserId, actorTenantId, actorType, dispatchTeardown })`
    — a pure ownership-gated handler wired to the existing public route `deleteWorkspace`
    (`DELETE /v1/workspaces/{workspaceId}`, already in `public-route-catalog.json`). Same isolation
    rule (cross-tenant → `404`, no dispatch); mirrors `tenant-management.mjs::handleTenantPurgeRequest`.

**Isolation note:** every teardown delete is scoped to the resolved workspace id; the ownership gate
runs before any side effect, so a foreign tenant can neither delete nor probe another tenant's
workspaces.

## (b) Vault — documented out-of-scope on the kind/campaign profile

**Decision: out-of-scope (opt-out), do NOT wire cert-manager.** Verified from code:

1. The Vault subchart's server TLS is a `cert-manager.io/v1` Certificate. cert-manager (and its CRDs)
   are NOT installed on the kind/campaign cluster, so `vault.enabled=true` renders a resource that
   cannot be applied and aborts `helm upgrade`.
2. NO Falcone component reads secrets FROM Vault — every app/datastore reads native Kubernetes
   Secrets (`envFromSecrets` / `secretKeyRef`); ESO is disabled and there is no agent injection. So
   "secrets via Vault" is unwired regardless of whether the pod runs.

Resolution: keep Vault DISABLED on the kind/campaign profile (`vault.enabled: false` in
`tests/live-campaign/values-campaign.yaml`; the base chart and `deploy/kind/values-kind.yaml`
inherit the chart default `vault.enabled: false`). Enabling Vault is a deliberate, separate decision
(the cert-manager-free self-signed path from `fix-vault-secrets-backend-on-kind` exists for operators
who opt in). Rendering on the kind profile produces no Vault workload and no cert-manager resource.

## (c) Widened Prometheus scrape config

**Gap:** the scrape config (`#499`) covered only three static targets: control-plane, cp-executor,
APISIX. On the live install (executor applied out-of-band of the chart) only 3 targets appeared.

**Code audit of which chart-deployed components expose a Prometheus `/metrics` endpoint:**

| Component | `/metrics`? | Evidence |
| --- | --- | --- |
| control-plane | yes | already scraped (#499) |
| cp-executor | yes | `apps/control-plane/src/runtime/server.mjs` (`GET /metrics`) — already scraped |
| apisix | yes | already scraped (#499) |
| workflow-worker | **no** | `services/workflow-worker/src/worker.ts` serves ONLY `/livez` + `/readyz` |
| web-console | no | static file server (`apps/web-console/static-server.mjs`) |
| keycloak / postgresql / documentdb / ferretdb / kafka / observability | no | no Falcone `/metrics` endpoint |

The proposal's example (workflow-worker) does NOT expose `/metrics` — adding a job for it would
create a dead target, so it is **deliberately skipped** (and asserted not to be scrape-annotated).
The CDC bridges + event-gateway DO expose `/metrics` in source but are NOT chart components (no
Deployment/Service), so they cannot be scraped from this chart.

**Decision:** rather than add more brittle per-target static jobs, widen with a namespace-scoped
**Kubernetes pod service-discovery** scrape job (`kubernetes_sd_configs`, `role: pod`, namespace
restricted to the release namespace) keyed on the `prometheus.io/scrape: "true"` annotation, reading
each pod's metrics port/path from `prometheus.io/port` / `prometheus.io/path`. This covers every
current AND future metrics-exposing component without hardcoding, and picks up the cp-executor even
when applied out-of-band (as long as it runs in the release namespace with the annotation).

Supporting changes:
- annotate the metrics-exposing wrappers (`controlPlane`, `controlPlaneExecutor`) with
  `prometheus.io/{scrape,port,path}` via `podAnnotations`;
- `templates/observability-prometheus-rbac.yaml` — a namespaced Role + RoleBinding granting the
  Prometheus SA pod-list/watch (required for SD); namespaced (not cluster-wide) so Prometheus never
  sees other namespaces/tenants;
- the base chart keeps `observability.serviceAccount.automountToken: false` (security-hardening
  default enforced by `scripts/lib/deployment-chart.mjs`); the kind/campaign overlay
  (`deploy/kind/values-kind.yaml`) opts in (`automountToken: true`) so SD can authenticate.

The three existing static jobs are retained (belt-and-suspenders, and the executor static job already
carries a `component` label).

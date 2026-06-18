# control-plane-runtime — spec delta for add-deploy-completeness-cluster

## ADDED Requirements

### Requirement: Single-workspace cascading teardown API

The system SHALL expose `DELETE /v1/workspaces/{workspaceId}` that tears down everything a single
workspace owns — its per-workspace `wsdb_*` database, its bucket(s), its Kafka topic(s), and its
registry rows (workspace + service-account / api-key / database / bucket / topic / function rows) —
the per-workspace counterpart of the tenant purge cascade. Physical teardown (database drop, bucket
and topic deletion) SHALL be best-effort (failures are tolerated and the removed resources are
reported); registry-row teardown SHALL be reliable so no orphaned rows remain.

The teardown SHALL be tenant-scoped: the workspace is resolved first, then the caller's ownership is
gated from the verified identity — a tenant owner/admin MAY delete ONLY a workspace whose
`tenant_id` matches their identity; superadmin/internal MAY delete any workspace. A request for a
workspace owned by another tenant (or a non-existent workspace) SHALL be rejected with `404` and
SHALL perform NO teardown (no existence leak). The shippable product (`apps/control-plane`) SHALL
provide the equivalent ownership-gated handler wired to the existing public route `deleteWorkspace`.

#### Scenario: owner deletes own workspace with full cascade

- **WHEN** a tenant owner issues `DELETE /v1/workspaces/{workspaceId}` for a workspace their tenant owns
- **THEN** the response is `200`, the workspace's `wsdb_*` database is dropped, its bucket(s) and
  topic(s) are deleted, and the workspace + its child registry rows are removed

#### Scenario: cross-tenant deletion is denied with no teardown

- **WHEN** a tenant owner issues `DELETE /v1/workspaces/{workspaceId}` for a workspace owned by a different tenant
- **THEN** the response is `404` (no existence leak) and NO database/bucket/topic or registry-row teardown is performed

#### Scenario: superadmin deletes any workspace

- **WHEN** a superadmin/internal caller issues `DELETE /v1/workspaces/{workspaceId}` for any tenant's workspace
- **THEN** the response is `200` and the full per-workspace cascade runs

#### Scenario: physical teardown is best-effort

- **WHEN** the workspace is deleted but the physical database/bucket/topic teardown fails
- **THEN** the response is still `200`, the registry rows are still removed, and no orphaned rows remain

### Requirement: Vault is out-of-scope (opt-out) on the kind/campaign profile

The system SHALL keep Vault DISABLED on the kind/campaign deployment profile, because cert-manager is
absent on that cluster (enabling Vault renders a `cert-manager.io/v1` resource that aborts the
release) and no Falcone component reads secrets FROM Vault (every component reads native Kubernetes
Secrets). Enabling Vault SHALL be a deliberate, separate decision (an explicit values opt-in), and
rendering the chart on the kind profile SHALL produce no Vault workload and no cert-manager resource.

#### Scenario: kind/campaign profile keeps Vault disabled

- **WHEN** the chart is rendered with the kind/campaign values
- **THEN** `vault.enabled` is `false`, no Vault server workload renders, and no `cert-manager.io/v1` resource renders

### Requirement: Widened Prometheus scrape coverage

The system SHALL widen the Prometheus scrape configuration beyond the three static targets
(control-plane, cp-executor, APISIX) to cover any Falcone component that exposes a Prometheus
`/metrics` endpoint, via a namespace-scoped Kubernetes pod service-discovery scrape job that selects
pods annotated `prometheus.io/scrape: "true"` and reads their metrics port/path from
`prometheus.io/port` / `prometheus.io/path`. Components that expose `/metrics` (control-plane,
cp-executor) SHALL carry the scrape annotation; components without a `/metrics` endpoint (e.g.
workflow-worker, which serves only `/livez` + `/readyz`) SHALL NOT be annotated and SHALL NOT be
scraped. The discovery SHALL be scoped to the release namespace only.

#### Scenario: scrape config covers metrics-exposing components, not just three static targets

- **WHEN** the chart's Prometheus ConfigMap is rendered
- **THEN** it retains the control-plane, cp-executor, and APISIX targets AND adds a namespace-scoped
  Kubernetes pod-discovery job keyed on the `prometheus.io/scrape` annotation, and the
  metrics-exposing components are annotated while workflow-worker (no `/metrics`) is not

## Context

Falcone's existing Postgres deployment (`charts/in-falcone/values.yaml:1694-1791`,
`docker.io/bitnami/postgresql:17.2.0`, 1 replica, ClusterIP on port 5432, 20 Gi PVC)
hosts schema-per-tenant relational data and enforces Row-Level Security via the
`falcone_app` non-BYPASSRLS role. Extensions are validated at runtime by
`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:111`
(`SELECT 1 FROM pg_available_extensions WHERE name = $1`) before `CREATE EXTENSION`
is issued; this path works for image-bundled extensions like `pgvector` but cannot
handle extensions that require `shared_preload_libraries` because those must be set
before Postgres starts.

DocumentDB (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`,
digest `sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`,
PostgreSQL 17.6) is a Postgres 17 image with `pg_cron`, `pg_documentdb_core`, and
`pg_documentdb` pre-bundled and already preloaded via the image's own default config.
Bundled extensions: `documentdb 0.107-0`, `documentdb_core 0.107-0`, `pg_cron 1.6`,
`postgis 3.6.0`, `rum 1.3`, `vector (pgvector) 0.8.1`, `tsm_system_rows`.
The startup requirements confirmed by the ADR spike (ADR-14, #455) are exactly:
- `shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` — a SERVER-START
  GUC, not session-settable; must be in `postgresql.conf` / `conf.d` before postmaster
  starts. The engine image already preloads these; the ConfigMap makes the setting
  explicit and Helm-managed.
- `cron.database_name='postgres'` — anchors the pg_cron background worker.
- No additional mandatory `documentdb.*` GUCs are required at startup.
- `CREATE EXTENSION IF NOT EXISTS documentdb` run in the target database after first boot.

The ADR spike (#455) confirmed the decision: **dedicated Postgres instance** for
DocumentDB. RLS coexists cleanly on the DocumentDB engine (non-BYPASSRLS `falcone_app`
role + `app.tenant_id` GUC enforcement work as-is); RLS is NOT a reason for separation.

The FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`, separate change
`add-ferretdb-gateway`) connects to this engine instance; tenants never reach the
engine port directly.

## Goals / Non-Goals

**Goals:**
- Deploy the DocumentDB engine as a dedicated StatefulSet + PVC via the umbrella chart,
  gated by `documentdb.enabled`.
- Apply `shared_preload_libraries`, `cron.database_name`, and `documentdb.*` GUCs via
  a chart-managed ConfigMap mounted before Postgres starts; settings survive pod restart.
- Create the `documentdb` extension in the target database via a Helm init Job (or
  initContainer), guarded by `pg_available_extensions` consistent with the existing
  `postgres-applier.mjs` pattern.
- Expose the engine as ClusterIP-only (port 5432); no tenant-reachable path.
- Comply with OpenShift restricted-v2 SCC using the existing chart pattern:
  `podSecurityContext.fsGroup: 1001`, `securityContext.runAsNonRoot: true`,
  `fsGroupChangePolicy: OnRootMismatch`.
- Add a `documentdb` service to `tests/env/docker-compose.yml` for real-stack tests.
- Support HA via StatefulSet replica count and pod anti-affinity in the HA profile.

**Non-Goals:**
- FerretDB gateway deployment (separate change `add-ferretdb-gateway`).
- Per-tenant credentials / Postgres role provisioning (separate change
  `add-ferretdb-tenant-isolation-credentials`).
- Data migration from MongoDB to DocumentDB (separate child).
- Removing the MongoDB StatefulSet from the chart (separate cutover change).
- Deep observability dashboards.

## Decisions

### D1: Dedicated Postgres instance (not colocated with the relational Postgres)

**Decision:** deploy a second StatefulSet using the DocumentDB image; do not modify the
existing `postgresql` StatefulSet or add `shared_preload_libraries` to it.

**Rationale:** the ADR spike (#455, ADR-14) confirmed three blockers for colocation:
1. `pg_documentdb` ships only in the engine image (`ghcr.io/ferretdb/postgres-documentdb`);
   it is absent from `docker.io/bitnami/postgresql:17.2.0` — the relational Postgres
   image cannot load it regardless of configuration.
2. `shared_preload_libraries` is a SERVER-START GUC; changing it on the running
   relational Postgres requires a full restart, which would disrupt all relational tenants
   and cannot be applied at session scope.
3. The engine image ships an extended extension surface (PostGIS 3.6.0, RUM 1.3,
   pgvector 0.8.1, pg_cron 1.6, tsm_system_rows) that is unwanted on the relational tier
   and increases the attack/bug surface.
RLS coexistence is confirmed CLEAN on the DocumentDB engine — the non-BYPASSRLS
`falcone_app` role and `app.tenant_id` GUC enforcement are fully compatible; RLS is NOT
a reason for the dedicated-instance decision.
A dedicated instance keeps concerns separated and matches the colocated-vs-dedicated
decision recorded in ADR-14.

**Alternatives considered:** colocated (single Postgres, two extension sets) — rejected
for the three reasons above (image mismatch, restart requirement, extension surface).
External managed DocumentDB (e.g. AWS DocumentDB) — out of scope for in-cluster chart
deployment.

---

### D2: GUC delivery via ConfigMap mounted as postgresql.conf override directory (startup-time only)

**Decision:** a chart-managed ConfigMap holds a `custom.conf` snippet with exactly
`shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` and
`cron.database_name='postgres'`; it is mounted into the container at the Postgres
`conf.d` override directory **before postmaster starts** (not as a session-level or
`POSTGRES_EXTRA_ARGS` injection). The ConfigMap is updated by `helm upgrade` and a pod
restart picks up the new GUCs. No `POSTGRES_EXTRA_ARGS` environment variable is used
for GUC delivery — `shared_preload_libraries` is SERVER-START and cannot be overridden
at session scope.

**Rationale:** `shared_preload_libraries` is a `context=postmaster` GUC in Postgres;
it is evaluated once at startup and cannot be changed without a restart. ConfigMap-based
`conf.d` delivery is declarative, Helm-manageable, and applies before the postmaster
process reads its configuration. The engine image already preloads
`pg_cron,pg_documentdb_core,pg_documentdb` via its bundled config; the ConfigMap entry
is an explicit, auditable declaration that survives image upgrades. The spike (ADR-14)
confirmed that only `shared_preload_libraries` and `cron.database_name` are mandatory
at startup; no additional `documentdb.*` GUCs are required.

---

### D3: Extension creation via Helm init Job

**Decision:** a Helm pre-install/pre-upgrade hook Job runs
`SELECT 1 FROM pg_available_extensions WHERE name = 'documentdb'` (consistent with
`postgres-applier.mjs:111`) and, if present, `CREATE EXTENSION IF NOT EXISTS documentdb`
in the target database. The Job waits for `pg_isready` before executing.

**Rationale:** mirrors the existing extension validation guard in
`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`; keeps the chart
self-contained without requiring the provisioning orchestrator to know about a new
engine at chart-install time.

---

### D4: OpenShift SCC compliance — mirror existing Postgres pattern

**Decision:** set `podSecurityContext.fsGroup: 1001` and
`securityContext.runAsNonRoot: true` in base values (matching
`charts/in-falcone/values.yaml:1759-1767`). Add `fsGroupChangePolicy: OnRootMismatch`
to match the existing pattern. In the OpenShift overlay
(`deploy/openshift/values-openshift.yaml`) set `podSecurityContext.fsGroup: null`
(SCC injects from namespace annotation) and add
`seccompProfile: { type: RuntimeDefault }`.

---

### D5: Internal-only networking

**Decision:** the DocumentDB engine Service is ClusterIP-only (port 5432). No Ingress,
Route, NodePort, or LoadBalancer is created. The FerretDB gateway (separate change) is
the only in-cluster consumer; tenants have no direct path to the engine.

---

### D6: tests/env integration

**Decision:** add a `documentdb` service to `tests/env/docker-compose.yml` using the
pinned image (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`),
mapped to host port 5433 to avoid colliding with the shared Postgres on 5432. The
service exposes the same GUC environment variables (via `POSTGRES_INITDB_ARGS` and
an init-sql mount) so real-stack tests can connect without a K8s cluster.

---

### D7: HA topology

**Decision:** the StatefulSet defaults to 1 replica (dev). The HA profile overrides to
2 replicas with pod anti-affinity (`requiredDuringSchedulingIgnoredDuringExecution`,
hostname topology key) to ensure no two replicas land on the same node. Primary
selection is handled by a sidecar (e.g. Patroni) or deferred to a streaming-replication
Helm sub-chart; the base change delivers the StatefulSet + PVC foundation.

---

### D8: Startup order — engine before gateway

**Decision:** the DocumentDB engine MUST be fully ready (postmaster up, `documentdb`
extension installed, `documentdb_api` schema present) before any FerretDB gateway Pod
sends its first wire-protocol handshake. The `add-ferretdb-gateway` change MUST
implement an initContainer or readiness gate that waits for `pg_isready` on the engine
Service and confirms the `documentdb_api` schema exists.

**Rationale:** the ADR spike (ADR-14) confirmed that a gateway-first start fails the
first wire handshake because `documentdb_api` is loaded as part of `CREATE EXTENSION
documentdb` — which runs in the init Job after the engine's first boot. If the gateway
connects before that Job completes, the connection is rejected. The fix is enforced at
the chart level (Helm hook ordering + gateway init-container probe) rather than relying
on timing.

## Risks / Trade-offs

- [Risk: DocumentDB image GUC surface changes between patch versions] The pinned image
  tag `17-0.107.0-ferretdb-2.7.0` fixes this for the initial deployment; upgrading
  requires re-running the ADR spike validation for new GUCs.
- [Risk: init Job races with DocumentDB startup] If the Job runs before the StatefulSet
  Pod is Ready, `pg_isready` will loop and the Job will eventually time out.
  Mitigation: Job `backoffLimit: 5` with exponential retry; liveness probe on the
  StatefulSet Pod gates readiness before downstream consumers start.
- [Risk: OpenShift restricted-v2 SCC rejects the DocumentDB image's entrypoint uid]
  The `postgres:17` upstream entrypoint defaults to uid 999 (postgres). With
  `runAsNonRoot: true` and no explicit `runAsUser`, the SCC will inject the namespace
  annotation uid. The image must tolerate an arbitrary uid for data directory ownership
  (fsGroup 1001 / fsGroupChangePolicy OnRootMismatch handles the PVC mount).
  Mitigation: verified against existing Postgres StatefulSet pattern in
  `charts/in-falcone/values.yaml:1759-1791`; same image family.

## Open Questions

- OQ-1: Which `documentdb.*` GUCs are mandatory vs optional at startup? **RESOLVED by
  ADR spike (ADR-14, #455):** only `shared_preload_libraries='pg_cron,pg_documentdb_core,
  pg_documentdb'` and `cron.database_name='postgres'` are required at startup. No
  `documentdb.*` GUCs are mandatory. Optional tuning GUCs (e.g. memory limits) may be
  added as chart-value overrides but carry no default obligation.
- OQ-2: Should the HA replica use Patroni for primary selection, or streaming
  replication only? **Deferred**; base change delivers single-replica StatefulSet +
  PVC. HA primary-selection is a follow-up change.

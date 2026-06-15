## Context

Falcone's control-plane resolves its MongoDB connection string in
`apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33-41): it returns
`process.env.MONGO_URI` when set, otherwise constructs a URI from `MONGO_HOST`,
`MONGO_USER`, `MONGO_PASSWORD`, and `MONGO_AUTH_SOURCE`. The executor at line 89
creates the Mongo client only when `mongoUri()` is non-undefined.

FerretDB v2 (image `ghcr.io/ferretdb/ferretdb:2.7.0`) is a stateless proxy: it
accepts connections on the MongoDB wire protocol (port 27017) and translates them to
SQL queries against a PostgreSQL 17 backend running the DocumentDB extension
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`). The gateway
holds no data of its own, so it can be deployed as a multi-replica Deployment with
no PVC and no StatefulSet semantics.

The DocumentDB engine is deployed by the separate child change
`add-ferretdb-documentdb-engine`. This change only deploys the FerretDB gateway that
sits in front of it.

OpenShift security constraints are already established for all components:
`charts/in-falcone/values.yaml` lines 18-22 (control-plane) and 137-138
(executor) set `runAsNonRoot: true`, `seccompProfile.type: RuntimeDefault`.
The OpenShift overlay at `deploy/openshift/values-openshift.yaml` nulls `fsGroup`
for MinIO (lines 135-139). The FerretDB gateway must follow the same pattern.

## Goals / Non-Goals

**Goals:**
- Deploy the FerretDB gateway as a stateless Kubernetes Deployment (>=2 replicas)
  in the umbrella chart, gated by `ferretdb.enabled`.
- Expose a ClusterIP Service on port 27017 (MongoDB wire protocol) reachable only
  inside the cluster by Falcone's control-plane and CDC services.
- Configure TLS for in-cluster transport where the cluster supports it.
- Satisfy OpenShift restricted-v2 SCC (non-root, no fsGroup, RuntimeDefault
  seccomp) without a custom SCC.
- Enforce the version-coupling rule: gateway image tag `2.7.0` must match the
  DocumentDB engine version `0.107.0-ferretdb-2.7.0`.

**Non-Goals:**
- Repointing `MONGO_URI` to the FerretDB Service (deferred to
  `add-ferretdb-data-access-cutover`).
- Deploying the DocumentDB engine itself (deferred to
  `add-ferretdb-documentdb-engine`).
- Per-tenant database and role provisioning inside DocumentDB (owned by
  `add-ferretdb-tenant-isolation-credentials`).
- Data migration from MongoDB to FerretDB/DocumentDB.
- Realtime / CDC remediation (deferred to `add-ferretdb-realtime-cdc-remediation`).
- **CRITICAL NON-GOAL — DB-level tenant isolation via FerretDB roles:** at
  FerretDB v2.7.0 per-database role scoping is NOT enforced — an authenticated
  MongoDB user can read other Mongo databases.  The per-tenant Mongo user / Postgres
  role provisioned by `add-ferretdb-tenant-isolation-credentials` does NOT constitute
  a DB-level isolation boundary at this version.  Tenant isolation MUST remain
  enforced at the application layer (`mongodb-data-api.mjs` `tenantId` scoping).
  See `add-ferretdb-tenant-isolation-credentials` for the credential model.

## Decisions

### D1: Stateless Deployment, no PVC

**Decision:** deploy FerretDB as a Kubernetes `Deployment` (not a StatefulSet) with
a minimum of 2 replicas and no PersistentVolumeClaim.

**Rationale:** FerretDB 2.x holds no local state — all document data is stored in
the DocumentDB/PostgreSQL backend and all session state is per-connection. A
Deployment gives simple horizontal scaling and rolling updates. A StatefulSet and PVC
would add unnecessary operational complexity.

---

### D2: Internal-only ClusterIP Service on port 27017

**Decision:** expose the gateway via a single ClusterIP Service on port 27017
(MongoDB standard). No Ingress, Route, NodePort, or LoadBalancer is created.

**Rationale:** tenants must never reach FerretDB directly. The only consumers are
Falcone's control-plane (via `MONGO_URI`) and the CDC bridge. Keeping the Service
ClusterIP-only is the simplest enforcement of this constraint and matches the
SeaweedFS internal-only networking posture already in the chart.

---

### D3: Version-coupling rule and startup order — engine first, then gateway

**Decision:** the gateway image tag (`2.7.0`) is pinned by tag AND by digest
(`sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`) in chart
values, referenced as
`ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`.
The gateway image corresponds to MongoDB wire protocol 7.0 (maxWireVersion 21,
buildInfo `7.0.77`).

**Startup order (mandatory):** the DocumentDB engine (PostgreSQL + DocumentDB
extension) MUST be fully initialised — `CREATE EXTENSION documentdb` applied,
`documentdb_api` schema created — BEFORE the FerretDB gateway process starts.
Starting the gateway before the engine is initialised causes the first MongoDB wire
handshake to fail because the gateway cannot establish its backend Postgres connection.
This ordering is enforced via Kubernetes init-container or `initdb` Job completion
gate (in `add-ferretdb-documentdb-engine`); the Helm dependency order must reflect
it.

When upgrading, the DocumentDB engine must be upgraded first; the gateway image tag
(and digest) must then be updated to the corresponding FerretDB release.

**Rationale:** FerretDB and DocumentDB are developed in lockstep; mismatched versions
can produce protocol or SQL translation errors. Digest pinning prevents silent image
drift between environments. The ADR spike (`add-ferretdb-adr-spike`) confirmed this
pairing. A chart-level comment and this spec requirement encode the upgrade and
startup order so it cannot be overlooked.

---

### D4: Health and readiness probes

**Decision:** configure a `livenessProbe` and `readinessProbe` on the FerretDB
container using either a TCP socket check on port 27017 or an HTTP GET to the
FerretDB debug endpoint `/debug/healthz` (port 8088 by default in FerretDB 2.x).

**Rationale:** probes gate traffic routing by kube-proxy and prevent the Deployment
from reporting `Available` before the gateway is actually accepting MongoDB wire
connections. Without probes, a crashlooping gateway would silently receive traffic.

---

### D5: OpenShift SCC compliance

**Decision:** in the OpenShift overlay (`deploy/openshift/values-openshift.yaml`),
set `podSecurityContext.fsGroup: null`, `runAsNonRoot: true`, and
`seccompProfile.type: RuntimeDefault` for the FerretDB gateway Pod, following the
MinIO pattern at lines 135-139 of that file.

**Rationale:** OpenShift restricted-v2 SCC requires non-root and rejects explicit
`fsGroup` values that conflict with the namespace annotation injection. The FerretDB
binary runs as a non-root user by default in the official image, so no `runAsUser`
override is needed.

---

### D6: TLS strategy

**Decision:** TLS between the FerretDB gateway and the DocumentDB PostgreSQL backend
is enabled via `FERRETDB_POSTGRESQL_URL` with `sslmode=require`. In-cluster
MongoDB-protocol TLS (gateway -> Falcone client) is deferred: the ClusterIP boundary
and internal-only exposure make plaintext acceptable for the initial deployment;
mTLS can be layered via a service mesh in a follow-on change.

**Rationale:** PostgreSQL TLS (`sslmode=require`) protects the more sensitive
SQL-bearing connection. MongoDB-protocol TLS between the gateway and Falcone's
control-plane is less critical given the ClusterIP-only exposure and the absence of
tenant-facing network paths.

---

### D7: Authentication — bootstrap superuser vs. per-tenant Postgres roles

**Decision:** `FERRETDB_POSTGRESQL_URL` uses the DocumentDB bootstrap / superuser
Postgres role for the gateway's own connection to the backend.  MongoDB-level users
created via `db.runCommand({createUser})` each map to a **real, non-superuser,
non-BYPASSRLS Postgres login role** in the DocumentDB backend.  Per-tenant Mongo
user / Postgres role pairs are provisioned by the separate change
`add-ferretdb-tenant-isolation-credentials`.

**Important limitation at v2.7.0:** per-database role scoping is NOT enforced by
FerretDB.  An authenticated MongoDB user can query databases other than their own.
Tenant isolation therefore remains authoritative at the application layer
(`mongodb-data-api.mjs` `tenantId` field scoping) rather than at the FerretDB
credential layer.  This limitation is documented as a Critical Non-Goal above and in
the spec requirements; it must be re-evaluated when FerretDB adds role-scoped
database enforcement.

**Rationale:** using the bootstrap role for the gateway's Postgres connection is
required so FerretDB can create and manage the Postgres schema on behalf of all
tenants.  Non-superuser, non-BYPASSRLS roles for tenants protect against Row-Level
Security bypass when RLS is later applied to the DocumentDB tables.

## Risks / Trade-offs

- [Risk: gateway started before engine is initialised] Starting the FerretDB gateway
  before `CREATE EXTENSION documentdb` has been applied and the `documentdb_api`
  schema created causes the first MongoDB wire handshake to fail.  Mitigation:
  enforce startup order via Kubernetes init-container or Job completion gate;
  document in chart and spec (D3 above).
- [Risk: DocumentDB engine not yet deployed] If `add-ferretdb-documentdb-engine` has
  not landed, the gateway will fail to connect and crash-loop. Mitigation: the
  readiness probe prevents the gateway from being marked Ready until the connection
  succeeds; Helm dependency ordering is documented.
- [Risk: FerretDB per-database role scoping not enforced at v2.7.0] An authenticated
  MongoDB user can access databases beyond their own; the per-tenant credential
  boundary is NOT a DB-level isolation boundary at this version.  Mitigation:
  application-layer `tenantId` scoping in `mongodb-data-api.mjs` remains
  authoritative; re-evaluate when FerretDB enforces database-scoped roles.  Cross-ref
  `add-ferretdb-tenant-isolation-credentials`.
- [Risk: image drift between environments] Pulling by tag only allows the registry
  to serve a different digest.  Mitigation: pin the image by digest in chart values
  (`tag@sha256:…`).
- [Risk: FerretDB image availability in airgap / Harbor] The gateway image must be
  mirrored to the Harbor registry for OpenShift air-gap deployments. Mitigation:
  apply the same image-rewrite stanza already used for other components.
- [Risk: OpenShift init-container root user] FerretDB's official image may set a
  non-root UID; verify with `docker inspect`. If a root UID is declared, add a
  `securityContext.runAsUser` override in the OpenShift overlay. Mitigation: static
  analysis of the rendered PodSpec before merge.

## Implementation Reconciliation (code-verified)

The proposal/tasks assumed hand-written `templates/ferretdb-deployment.yaml` /
`ferretdb-service.yaml`. The umbrella chart does not work that way — every component is a
`component-wrapper` sub-chart alias. The implementation follows the code (same pattern as
the merged `add-ferretdb-documentdb-engine`):

- **Wrapper alias, not bespoke templates.** New `ferretdb` alias in `Chart.yaml`
  (`condition: ferretdb.enabled`) + a `ferretdb:` values stanza. The wrapper renders the
  Deployment (`workload.kind: Deployment`), ClusterIP Service, and ServiceAccount, and
  applies global image-registry rewrite + imagePullSecrets + pod-security merge. The
  wrapper key is **`replicas`** (the tasks' `replicaCount` does not exist here).
- **Engine-gate via `initContainers` values, not a separate template.** The
  `wait-for-documentdb` initContainer (`pg_isready` + `documentdb_api` schema check, using
  the version-coupled engine image) is delivered through `ferretdb.initContainers`. This
  is the authoritative engine-first gate (D3); the readiness probe is secondary.
- **NetworkPolicy is the only hand-written umbrella template**
  (`templates/ferretdb-networkpolicy.yaml`), gated `ferretdb.enabled &&
  ferretdb.networkPolicy.enabled` (seaweedfs precedent).
- **Component-alias contract sync (4 places).** Registering the alias required updating
  `scripts/lib/deployment-chart.mjs` + `scripts/lib/deployment-topology.mjs`
  (REQUIRED_COMPONENT_ALIASES), `services/internal-contracts/src/deployment-topology.json`
  (`packaging_guidance.component_aliases`), and
  `tests/contracts/deployment-topology.contract.test.mjs` — order-sensitive
  (`ferretdb` after `documentdb`), or CI `quality` fails.
- **Backend DSN Secret.** `FERRETDB_POSTGRESQL_URL` is sourced from the externally
  provisioned `in-falcone-ferretdb` Secret (key `postgresql-url`), carrying the
  `sslmode=require` bootstrap DSN — the engine change references an external admin Secret
  rather than provisioning one, so the gateway uses the same external-Secret pattern.
- **FERRETDB_DEBUG_ADDR=:8088** is set so the debug/health server binds all interfaces
  (default 127.0.0.1 would make the kubelet HTTP probe fail).
- **Live checks deferred** (tasks 1.2/8.3/8.4): no container runtime in the audit
  workspace. Render-level verification (helm lint/template base+OpenShift, the chart
  validators, unit/contract suites, `openspec validate --strict`) is complete.

## Why

Falcone's document store reaches MongoDB via `MONGO_URI`, resolved in
`apps/control-plane/src/runtime/main.mjs::mongoUri` (line 33). MongoDB's SSPL
licence is incompatible with Falcone's open-source model. FerretDB v2 is the
selected replacement (ADR-14, `add-ferretdb-adr-spike`): it speaks the MongoDB wire
protocol and translates to SQL against a PostgreSQL 17 + DocumentDB engine backend,
carrying an Apache-2.0 licence. Before Falcone's client can be repointed, the
FerretDB gateway process must be deployed in-cluster as a stateless, horizontally
scalable component that is reachable only by Falcone's control-plane and CDC services
and never by tenants directly.

## What Changes

- Add a Kubernetes Deployment for the FerretDB gateway image
  `ghcr.io/ferretdb/ferretdb:2.7.0` (digest
  `sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`)
  to the umbrella chart (`charts/in-falcone/`), gated by a `ferretdb.enabled`
  boolean so the gateway can be deployed alongside MongoDB during the cutover window.
- Configure the Deployment with a minimum of 2 replicas, no PVC (stateless), and
  HPA-ready resource requests/limits so the gateway scales horizontally under load.
- Expose an internal `mongodb://` ClusterIP Service (port 27017) for consumption by
  Falcone via the `MONGO_URI` environment variable; no Ingress, Route, NodePort, or
  LoadBalancer is created.
- Point the gateway at the DocumentDB-on-Postgres backend deployed by
  `add-ferretdb-documentdb-engine` (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`)
  via the `FERRETDB_POSTGRESQL_URL` environment variable.
- Configure health and readiness probes on the FerretDB process (TCP or HTTP
  `/debug/healthz`).
- Pin the gateway image tag `2.7.0` (with digest
  `sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`) to
  match the DocumentDB engine version `0.107.0-ferretdb-2.7.0`; enforce the
  version-coupling rule (engine-first startup and upgrade order) in chart values and
  the spec.  The chart MUST reference the image as
  `ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`
  so image drift is detected by the registry at pull time.
- Configure the gateway startup so the DocumentDB engine is started (and its
  extensions initialised) BEFORE the FerretDB gateway process; starting the gateway
  first causes the first wire handshake to fail because the `documentdb` extension
  and the `documentdb_api` schema must already exist in the PostgreSQL backend.
- Configure `FERRETDB_POSTGRESQL_URL` to use a bootstrap/superuser Postgres role for
  the gateway's own backend connection; per-tenant Mongo users map to distinct
  non-superuser, non-BYPASSRLS Postgres login roles provisioned by
  `add-ferretdb-tenant-isolation-credentials`.
- Apply OpenShift restricted-v2 SCC compliance (`runAsNonRoot: true`,
  `seccompProfile.type: RuntimeDefault`, no `fsGroup`) in the OpenShift values
  overlay, following the existing pattern in `charts/in-falcone/values.yaml` (lines
  18-22 and 137-138).
- The repoint of `MONGO_URI` to the FerretDB Service is out of scope; that is the
  separate child change `add-ferretdb-data-access-cutover`.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `data-api`: ADDED requirements for the FerretDB gateway platform component —
  stateless Deployment (>=2 replicas, no PVC, HPA-ready), MongoDB wire-protocol
  Service (ClusterIP, port 27017, internal-only), TLS, health/readiness probes,
  OpenShift SCC compliance (non-root), version-coupling rule (gateway tag matches
  engine), and engine-first upgrade order.

## Impact

- `charts/in-falcone/Chart.yaml` or `charts/in-falcone/templates/` — new FerretDB
  gateway Deployment and Service templates, gated by `ferretdb.enabled`.
- `charts/in-falcone/values.yaml` — new `ferretdb.*` stanza with image, replicas,
  resources, DSN reference, probe config, and `enabled: false` default.
- `deploy/openshift/values-openshift.yaml` — SCC overlay entries for the FerretDB
  gateway Pod.
- No app-layer code changes in this change; `MONGO_URI` repoint is deferred to
  `add-ferretdb-data-access-cutover`.
- DEPENDS ON: `add-ferretdb-documentdb-engine` (DocumentDB backend must be running
  and extensions initialised before the gateway can start).
- BLOCKS: `add-ferretdb-data-access-cutover` (client repoint), per-tenant
  DocumentDB role provisioning.
- CRITICAL NON-GOAL — tenant isolation boundary: the FerretDB gateway at v2.7.0
  does NOT enforce per-database role scoping.  An authenticated Mongo user can read
  other Mongo databases; the per-tenant DB+role provisioned by
  `add-ferretdb-tenant-isolation-credentials` is NOT a DB-level isolation boundary
  at this version.  Tenant isolation MUST remain enforced at the application layer
  (`mongodb-data-api.mjs` tenantId scoping).  See also
  `add-ferretdb-tenant-isolation-credentials`.

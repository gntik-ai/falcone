## ADDED Requirements

### Requirement: FerretDB gateway deployed as a stateless Deployment via chart toggle

The system SHALL deploy the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) as
a stateless Kubernetes Deployment — with a minimum of 2 replicas, no
PersistentVolumeClaim, and HPA-ready resource requests and limits — controlled by a
`ferretdb.enabled` boolean value in the umbrella Helm chart, so that the gateway can
be deployed alongside the existing MongoDB instance during the cutover window without
either being removed from the chart.

#### Scenario: FerretDB gateway Deployment has no PVC and at least 2 replicas

- **WHEN** the umbrella chart is installed with `ferretdb.enabled=true`
- **THEN** a Deployment for the FerretDB gateway exists with `replicas` >= 2, no
  `volumeClaimTemplates`, no PersistentVolumeClaim bound to any gateway Pod, and
  all gateway Pods reach the Ready state

#### Scenario: FerretDB disabled by default produces no gateway resources

- **WHEN** the umbrella chart is installed without overriding `ferretdb.enabled`
- **THEN** no FerretDB Deployment, Service, or ConfigMap is created and the
  existing MongoDB connection path is unaffected

### Requirement: FerretDB gateway exposes MongoDB wire protocol on internal-only ClusterIP Service

The system SHALL expose the FerretDB gateway exclusively via a ClusterIP Service on
port 27017 (MongoDB wire protocol), with no Ingress, Route, NodePort, or
LoadBalancer service type, so that tenant-facing network paths cannot reach the
FerretDB gateway directly and only Falcone's control-plane and CDC services can
consume the `mongodb://` endpoint via `MONGO_URI`.

#### Scenario: MongoDB wire-protocol Service is ClusterIP-only

- **WHEN** the umbrella chart is installed with `ferretdb.enabled=true`
- **THEN** exactly one Service exists for the FerretDB gateway, its type is
  `ClusterIP`, it exposes port 27017, and no Ingress resource, OpenShift Route,
  NodePort, or LoadBalancer Service exists for the gateway

#### Scenario: In-cluster MongoDB connection succeeds and wire-protocol version is as expected

- **WHEN** a Pod inside the cluster connects to the FerretDB ClusterIP Service on
  port 27017 using a MongoDB wire-protocol driver and issues a `hello` (or
  `isMaster`) command
- **THEN** the handshake completes successfully, the gateway returns a `hello`
  response with `maxWireVersion` equal to `21` and `buildInfo.version` equal to
  `7.0.77`, and the connection is usable for document operations; a response with any
  other `maxWireVersion` indicates image drift and MUST be treated as a contract
  failure

### Requirement: FerretDB gateway translates wire protocol to DocumentDB-on-Postgres backend

The system SHALL configure the FerretDB gateway to connect to the DocumentDB
PostgreSQL backend (deployed by `add-ferretdb-documentdb-engine`) via
`FERRETDB_POSTGRESQL_URL` with `sslmode=require`, so that all MongoDB wire-protocol
operations received by the gateway are translated to SQL and executed against the
DocumentDB extension without plaintext PostgreSQL connections.

#### Scenario: Gateway connects to DocumentDB backend with TLS

- **WHEN** the FerretDB gateway Pod starts with `ferretdb.enabled=true`
- **THEN** the gateway establishes a TLS-protected connection to the DocumentDB
  PostgreSQL backend (`sslmode=require`) and the gateway startup logs confirm a
  successful backend connection with no TLS errors

#### Scenario: Document write through gateway persists in DocumentDB

- **WHEN** a MongoDB wire-protocol client issues an `insertOne` command to the
  FerretDB gateway ClusterIP on port 27017
- **THEN** the document is stored in the DocumentDB PostgreSQL backend and a
  subsequent `findOne` via the same gateway returns the inserted document

### Requirement: FerretDB gateway health and readiness probes gate Service endpoint registration

The system SHALL configure a `livenessProbe` and a `readinessProbe` on the FerretDB
gateway container, targeting the FerretDB debug health endpoint or a TCP socket on
port 27017, so that gateway Pods are not added to the ClusterIP Service endpoints
until they are ready to accept MongoDB wire-protocol connections and a crashlooping
gateway is restarted automatically.

#### Scenario: Readiness probe prevents traffic before gateway is ready

- **WHEN** a FerretDB gateway Pod is starting and has not yet established a
  connection to the DocumentDB backend
- **THEN** the Pod's readiness probe fails, the Pod is excluded from the ClusterIP
  Service endpoints, and no MongoDB traffic is routed to it until the probe passes

#### Scenario: Liveness probe triggers restart of a crashed gateway

- **WHEN** the FerretDB gateway process inside a Pod stops responding to the
  liveness probe
- **THEN** Kubernetes restarts the container and the Pod returns to Ready state
  after a successful restart

### Requirement: FerretDB gateway image version must be pinned by tag and digest to match the DocumentDB engine version

The system SHALL pin the FerretDB gateway image to
`ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`
— the release corresponding to DocumentDB engine
`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` (MongoDB wire
protocol 7.0, maxWireVersion 21, buildInfo `7.0.77`) — and the chart values MUST
document that the engine must be upgraded before the gateway and that both the image
tag and digest must be updated to the matching FerretDB release when the engine is
upgraded, so that protocol and SQL-translation compatibility is guaranteed and image
drift between environments is detected at pull time.

#### Scenario: Chart renders gateway with the correct pinned image tag and digest

- **WHEN** the umbrella chart is rendered with `ferretdb.enabled=true` and default
  values
- **THEN** the FerretDB gateway Deployment specifies image
  `ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`
  and the chart values contain a comment linking this tag and digest to the
  DocumentDB engine version `0.107.0-ferretdb-2.7.0`

#### Scenario: Engine-first upgrade order is documented in chart values

- **WHEN** an operator inspects the `ferretdb.image.tag` value in
  `charts/in-falcone/values.yaml`
- **THEN** a comment is present stating that the DocumentDB engine must be upgraded
  before the gateway image tag is changed and identifying the paired engine image

### Requirement: FerretDB gateway Pods comply with OpenShift restricted-v2 SCC

The system SHALL configure all FerretDB gateway Pods in the OpenShift values overlay
with `runAsNonRoot: true`, `seccompProfile.type: RuntimeDefault`, and no explicit
non-null `fsGroup`, so that the restricted-v2 Security Context Constraint admits the
gateway Pods without a custom SCC assignment and the injected uid/gid from the
namespace annotation is used.

#### Scenario: FerretDB gateway Pods pass restricted-v2 SCC admission on OpenShift

- **WHEN** the umbrella chart is installed in an OpenShift namespace governed by
  the restricted-v2 SCC with `ferretdb.enabled=true` and the OpenShift overlay
  (`deploy/openshift/values-openshift.yaml`) applied
- **THEN** all FerretDB gateway Pods are admitted without SCC violation events,
  reach the Running state, and no privilege-escalation warnings appear in the
  namespace event log

#### Scenario: FerretDB gateway PodSpec contains no explicit fsGroup in the OpenShift overlay

- **WHEN** the OpenShift overlay is applied with `ferretdb.enabled=true`
- **THEN** the FerretDB gateway PodSpec does not contain a non-null `fsGroup` field
  and both `runAsNonRoot: true` and `seccompProfile.type: RuntimeDefault` are
  present in the Pod security context

### Requirement: FerretDB gateway MUST NOT become Ready before the DocumentDB engine extensions are initialised

The system SHALL ensure the FerretDB gateway Deployment does not start (or, if
started, does not pass its readiness probe) until the DocumentDB engine PostgreSQL
instance has had `CREATE EXTENSION documentdb` applied and the `documentdb_api`
schema created, because starting the gateway before extension initialisation causes
the first MongoDB wire handshake to fail.

#### Scenario: Gateway Pod readiness probe fails when engine extensions are not yet initialised

- **WHEN** the FerretDB gateway Pod starts and the DocumentDB engine PostgreSQL
  backend does not yet have the `documentdb` extension loaded or the `documentdb_api`
  schema created
- **THEN** the gateway Pod's readiness probe fails and the Pod is NOT added to the
  ClusterIP Service endpoints, so no MongoDB traffic is routed to it

#### Scenario: Gateway becomes Ready only after engine initialisation completes

- **WHEN** the DocumentDB engine PostgreSQL backend has `CREATE EXTENSION documentdb`
  applied and the `documentdb_api` schema exists, and the FerretDB gateway Pod then
  starts
- **THEN** the gateway Pod passes its readiness probe and is added to the ClusterIP
  Service endpoints, and a `hello` command returns `maxWireVersion` 21

### Requirement: FerretDB gateway backend connection uses bootstrap superuser role; per-tenant MongoDB users map to non-superuser Postgres login roles

The system SHALL configure `FERRETDB_POSTGRESQL_URL` with the DocumentDB
bootstrap/superuser Postgres role so the gateway can manage the backend schema, and
MUST ensure that each MongoDB-level user created via `db.runCommand({createUser})`
maps to a real, non-superuser, non-BYPASSRLS Postgres login role in the DocumentDB
backend, so that per-tenant Postgres roles cannot bypass Row-Level Security policies
applied to DocumentDB tables.  Per-tenant credential provisioning is owned by
`add-ferretdb-tenant-isolation-credentials`.

#### Scenario: Per-tenant MongoDB user maps to a non-superuser non-BYPASSRLS Postgres role

- **WHEN** a per-tenant MongoDB user is created via `db.runCommand({createUser})`
  against the FerretDB gateway
- **THEN** the corresponding Postgres login role in the DocumentDB backend has
  neither `SUPERUSER` nor `BYPASSRLS` privileges, as verified by querying
  `pg_roles` in the DocumentDB PostgreSQL instance

### Requirement: FerretDB gateway v2.7.0 does NOT provide a tenant isolation boundary — application-layer tenantId scoping is authoritative

The system SHALL NOT rely on the FerretDB gateway's per-tenant MongoDB database or
Postgres role assignment as a tenant isolation boundary, because at FerretDB v2.7.0
per-database role scoping is NOT enforced — an authenticated MongoDB user can read
data from other Mongo databases.  Tenant isolation MUST remain enforced exclusively
at the application layer via `tenantId` field scoping in
`apps/control-plane/src/runtime/mongodb-data-api.mjs`, and the FerretDB credential
model (owned by `add-ferretdb-tenant-isolation-credentials`) MUST NOT be presented
to operators as a substitute for that scoping.

#### Scenario: Application-layer tenantId scoping prevents cross-tenant data access through the gateway

- **WHEN** an authenticated MongoDB user for tenant A issues a query to the FerretDB
  gateway without an explicit `tenantId` filter at the application layer
- **THEN** the application layer (`mongodb-data-api.mjs`) rejects or scopes the
  query to tenant A's `tenantId` before it reaches the gateway, so documents
  belonging to tenant B are never returned regardless of FerretDB's role-scoping
  behaviour

#### Scenario: Cross-tenant probe confirms application-layer scoping — not gateway enforcement

- **WHEN** the FerretDB gateway is running and two tenants A and B have documents in
  different Mongo databases
- **THEN** a direct MongoDB driver query from tenant A's credentials to tenant B's
  Mongo database that bypasses `mongodb-data-api.mjs` MAY succeed at the gateway
  layer (confirming the known v2.7.0 limitation), while the same query routed
  through `mongodb-data-api.mjs` returns no tenant B documents

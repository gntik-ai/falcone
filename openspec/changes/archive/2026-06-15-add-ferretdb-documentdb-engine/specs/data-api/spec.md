## ADDED Requirements

### Requirement: DocumentDB engine deploys as a dedicated Postgres StatefulSet via chart toggle

The system SHALL deploy the DocumentDB engine
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`,
PostgreSQL 17.6) as a dedicated Postgres StatefulSet in the umbrella Helm chart,
controlled by a `documentdb.enabled` boolean value, so that the DocumentDB engine is
isolated from the existing relational Postgres instance (`postgresql` StatefulSet,
`docker.io/bitnami/postgresql:17.2.0`) — which does not bundle `pg_documentdb` — and
the `shared_preload_libraries` SERVER-START GUC required by DocumentDB is applied only
to the dedicated instance without restarting or modifying the relational Postgres tier.

#### Scenario: DocumentDB engine deploys when enabled

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true`
- **THEN** a dedicated DocumentDB StatefulSet Pod reaches the Ready state, the pod runs
  image `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`, and the
  existing `postgresql` StatefulSet continues to serve relational data unmodified

#### Scenario: DocumentDB engine absent when disabled

- **WHEN** the umbrella chart is installed without overriding `documentdb.enabled`
- **THEN** no DocumentDB StatefulSet, PVC, Service, ConfigMap, or init Job is created
  and the existing MongoDB and relational Postgres StatefulSets are unaffected

### Requirement: shared_preload_libraries and cron.database_name applied via startup-time ConfigMap and survive restart

The system SHALL configure the DocumentDB Postgres instance with
`shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` and
`cron.database_name='postgres'` via a chart-managed ConfigMap mounted as a
`postgresql.conf`/`conf.d` include applied before the postmaster process starts —
not via `POSTGRES_EXTRA_ARGS` or any session-level mechanism — so that the GUCs are
applied on every pod start and survive a pod restart without requiring manual
intervention. No additional `documentdb.*` GUCs are mandatory at startup.

#### Scenario: GUCs are active after initial pod start

- **WHEN** the DocumentDB StatefulSet Pod starts for the first time
- **THEN** `SHOW shared_preload_libraries` returns a value containing
  `pg_documentdb_core` and `pg_documentdb`, and `SHOW cron.database_name` returns
  `postgres`

#### Scenario: GUCs survive a pod restart

- **WHEN** the DocumentDB StatefulSet Pod is deleted and a replacement Pod starts
- **THEN** `SHOW shared_preload_libraries` on the new Pod returns the same value
  containing `pg_documentdb_core` and `pg_documentdb`, confirming the ConfigMap-mounted
  configuration is re-applied on restart

#### Scenario: ConfigMap update propagates on next pod restart

- **WHEN** the chart ConfigMap carrying the GUC overrides is updated via `helm upgrade`
  and the DocumentDB Pod is restarted
- **THEN** the updated GUC values are active in the running Postgres process

### Requirement: documentdb extension created in the target database on engine startup

The system SHALL create the `documentdb` extension in the target DocumentDB database
via a Helm init Job that first checks `pg_available_extensions` (consistent with
`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:111`) and then
executes `CREATE EXTENSION IF NOT EXISTS documentdb`, so that `\dx` shows `documentdb`
in the target database and the FerretDB gateway can connect without manual DDL steps.

#### Scenario: documentdb extension present after chart install

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true` and the init
  Job completes
- **THEN** `SELECT extname FROM pg_extension WHERE extname = 'documentdb'` returns one
  row in the target database, confirming the extension is installed

#### Scenario: extension creation is idempotent on re-install

- **WHEN** the umbrella chart is re-installed or upgraded with `documentdb.enabled=true`
  and the init Job runs again
- **THEN** `CREATE EXTENSION IF NOT EXISTS documentdb` completes without error and
  the extension row count in `pg_extension` remains exactly one

#### Scenario: extension creation is gated on pg_available_extensions

- **WHEN** the init Job runs and `documentdb` is absent from `pg_available_extensions`
  (e.g., wrong image)
- **THEN** the Job fails with a non-zero exit code and does not execute
  `CREATE EXTENSION`, consistent with the guard in `postgres-applier.mjs:111`

### Requirement: DocumentDB engine exposed as ClusterIP-only with no tenant-reachable port

The system SHALL expose the DocumentDB Postgres instance as a ClusterIP Service on
port 5432 only, with no Ingress, Route, NodePort, or LoadBalancer Service type, so
that no tenant-reachable network path reaches the engine directly and all document-store
access is mediated by the FerretDB gateway.

#### Scenario: DocumentDB Service is ClusterIP-only

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true`
- **THEN** exactly one Service for the DocumentDB engine exists in the namespace, its
  type is ClusterIP, and it listens on port 5432; no NodePort, LoadBalancer, Ingress
  resource, or OpenShift Route exists for the engine

#### Scenario: DocumentDB port is not reachable from outside the cluster

- **WHEN** an attempt is made to connect to the DocumentDB engine from outside the
  Kubernetes cluster
- **THEN** no routable path exists to port 5432 on the engine Pod and the connection
  is refused or times out

### Requirement: DocumentDB StatefulSet complies with OpenShift restricted-v2 SCC

The system SHALL configure the DocumentDB StatefulSet Pods with
`podSecurityContext.fsGroup: 1001`, `fsGroupChangePolicy: OnRootMismatch`, and
`securityContext.runAsNonRoot: true` in the base values, mirroring the existing
Postgres StatefulSet pattern at `charts/in-falcone/values.yaml:1759-1791`, and SHALL
set `podSecurityContext.fsGroup: null` with `seccompProfile.type: RuntimeDefault` in
the OpenShift overlay so that the restricted-v2 SCC injects the namespace-annotated
uid/gid without requiring a custom SCC assignment.

#### Scenario: DocumentDB Pods pass restricted-v2 SCC admission on OpenShift

- **WHEN** the umbrella chart is installed in an OpenShift namespace governed by the
  restricted-v2 SCC with `documentdb.enabled=true` and the OpenShift overlay applied
- **THEN** all DocumentDB Pods are admitted without SCC violation events, reach the
  Running state, and the Postgres process writes to the PVC mount under the injected
  uid/gid

#### Scenario: fsGroup is null in the OpenShift overlay

- **WHEN** the OpenShift overlay (`deploy/openshift/values-openshift.yaml`) is applied
- **THEN** the DocumentDB StatefulSet PodSpec contains no non-null `fsGroup` field and
  `seccompProfile.type` is `RuntimeDefault`

#### Scenario: base values carry fsGroup 1001 and runAsNonRoot true

- **WHEN** the umbrella chart is rendered with the base values (no OpenShift overlay)
  and `documentdb.enabled=true`
- **THEN** the DocumentDB StatefulSet PodSpec sets `fsGroup: 1001`,
  `fsGroupChangePolicy: OnRootMismatch`, and `runAsNonRoot: true`

### Requirement: DocumentDB PVC provides persistent storage and survives pod restart

The system SHALL provision a PersistentVolumeClaim for the DocumentDB StatefulSet data
directory, defaulting to 20 Gi in the dev profile and configurable via chart values,
so that data written to the DocumentDB engine survives pod deletion and rescheduling
without data loss.

#### Scenario: PVC exists after chart install

- **WHEN** the umbrella chart is installed with `documentdb.enabled=true`
- **THEN** a PVC bound to the DocumentDB StatefulSet Pod exists in the namespace with
  at least 20 Gi capacity and ReadWriteOnce access mode

#### Scenario: Data persists across pod restart

- **WHEN** a document is written to a DocumentDB collection and the StatefulSet Pod is
  deleted and a replacement Pod starts
- **THEN** the document is readable from the same collection after the new Pod reaches
  Ready, confirming PVC persistence

### Requirement: DocumentDB engine is fully ready before FerretDB gateway connects

The system SHALL ensure that the DocumentDB engine (postmaster started, `documentdb`
extension installed, `documentdb_api` schema present in the target database) is in the
Ready state before any FerretDB gateway Pod (`add-ferretdb-gateway`) initiates its
first MongoDB wire-protocol handshake, so that the gateway's first connection does not
fail due to a missing `documentdb_api` schema.

#### Scenario: gateway startup is blocked until engine is ready

- **WHEN** the umbrella chart is installed with both `documentdb.enabled=true` and
  the FerretDB gateway enabled
- **THEN** the FerretDB gateway Pod does not send a wire-protocol connection to the
  DocumentDB engine until the engine's init Job has completed and `documentdb_api`
  schema is present; the gateway reaches the Running state only after the engine
  StatefulSet Pod is Ready

#### Scenario: engine-first startup succeeds; gateway-first fails and is rejected

- **WHEN** the DocumentDB engine Pod is not yet Ready and a FerretDB gateway process
  attempts to connect to the engine Service
- **THEN** the connection is rejected or the gateway enters a CrashLoopBackOff /
  pending state until the engine becomes Ready, after which the gateway successfully
  completes its wire handshake

### Requirement: tests/env provides a DocumentDB engine service for real-stack tests

The system SHALL add a `documentdb` service to `tests/env/docker-compose.yml` using
the image pinned by tag and digest
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`)
with `shared_preload_libraries` and `cron.database_name` applied at startup and the
`documentdb` extension created on startup, so that real-stack integration tests can
target the DocumentDB engine without a Kubernetes cluster.

#### Scenario: tests/env DocumentDB service starts and extension is present

- **WHEN** `docker compose -f tests/env/docker-compose.yml up documentdb` is run
- **THEN** the service reaches a healthy state, `pg_isready` succeeds on the mapped
  host port, and `SELECT extname FROM pg_extension WHERE extname = 'documentdb'`
  returns one row in the target database

#### Scenario: tests/env DocumentDB service does not conflict with the shared Postgres port

- **WHEN** both the shared `postgres` service and the `documentdb` service are started
  in `tests/env`
- **THEN** each service is reachable on a distinct host port (5432 for shared Postgres,
  5433 for DocumentDB) and neither service interferes with the other

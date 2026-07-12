# platform-services

## ADDED Requirements

### Requirement: Falcone platform services are core

Falcone SHALL define its platform service baseline as a complete set of Falcone-owned services that
are installed and wired by default. The baseline SHALL include APISIX, Keycloak, PostgreSQL,
dedicated pgvector PostgreSQL, DocumentDB, FerretDB, Kafka, SeaweedFS master/volume/filer/S3,
observability/Prometheus, Grafana, control-plane, control-plane executor, web console, workflow
worker, External Secrets Operator integration, OpenBao, Temporal, MCP, and bootstrap lifecycle
initialization.

#### Scenario: Fresh install provisions the complete platform

- **WHEN** the chart is installed with default values on a clean supported cluster or namespace
- **THEN** every platform service in the baseline is rendered, created, wired to its dependencies, and
  reaches its documented Ready or Completed condition

#### Scenario: Runtime feature routes are active

- **WHEN** a fresh install completes
- **THEN** workspace secrets, flows, MCP, vector-search, function/data-plane executor, and observability
  surfaces are backed by their core services rather than returning disabled-backend responses caused by
  missing default services

### Requirement: Platform services cannot be individually disabled

The deployment SHALL NOT expose a supported per-service mechanism to disable a Falcone platform
service.

#### Scenario: No service disable values are shipped

- **WHEN** base values, profiles, kind values, OpenShift values, and live-campaign values are inspected
- **THEN** they do not define top-level `enabled` keys for Falcone platform services

#### Scenario: Stale disable overrides are rejected

- **WHEN** an operator supplies an obsolete override such as `openbao.enabled=false`,
  `temporal.enabled=false`, `mcp.enabled=false`, `controlPlaneExecutor.enabled=false`,
  `workflowWorker.enabled=false`, `postgresqlVector.enabled=false`, `observability.enabled=false`,
  or `bootstrap.enabled=false`
- **THEN** chart/schema validation fails with a clear message that platform services are core and
  cannot be disabled

#### Scenario: Core workload roles cannot be rendered with zero replicas

- **WHEN** an operator supplies a zero-replica override for a core workload or role, including
  component-wrapper aliases, Temporal server roles, OpenBao, SeaweedFS master/volume/filer/S3, or
  the ESO controller/webhook/cert-controller
- **THEN** chart/schema validation fails before a manifest with `replicas: 0` is accepted

#### Scenario: Nested role disable switches are rejected

- **WHEN** an operator supplies a nested disable/create override for a core role such as
  `temporal.frontend.enabled=false`, `seaweedfs.master.enabled=false`,
  `openbao.openbao.enabled=false`, `eso.external-secrets.webhook.create=false`, or
  `eso.external-secrets.certController.create=false`
- **THEN** chart/schema validation fails while helper toggles that do not remove a core workload, such
  as volume-permission or resize hooks, remain configurable

### Requirement: Operational knobs remain configurable

The deployment SHALL preserve configuration flags that change operating mode without removing a
Falcone platform service.

#### Scenario: Operational flags survive the all-core change

- **WHEN** values are inspected after the all-core migration
- **THEN** airgap/private-registry/transport-security flags, public hostname topology, demo-data
  flags, OpenShift mode, probes, resources, replicas, persistence sizing or existing-claim selection,
  service object settings, NetworkPolicy settings, TLS mode, and security context settings remain
  configurable subject to validation

#### Scenario: Unused upstream roles remain outside the service baseline

- **WHEN** SeaweedFS values are inspected
- **THEN** the Falcone-used master, volume, filer, and S3 roles are part of the core baseline, while
  unused upstream roles such as SFTP, admin, worker, COSI, filer-embedded S3, and allInOne remain
  disabled unless a separate change makes them Falcone platform services

### Requirement: Chart dependencies are unconditional

Every subchart dependency required for Falcone's platform baseline SHALL be declared without a Helm
`condition`.

#### Scenario: Dependency declarations have no conditions

- **WHEN** `charts/in-falcone/Chart.yaml` is inspected
- **THEN** no dependency entry for a Falcone platform service has a `condition` field

### Requirement: Component-wrapper workloads are unconditional for platform aliases

The component-wrapper subchart SHALL render the workload for every platform alias included by the
umbrella chart and SHALL NOT require or inspect a top-level `enabled` value.

#### Scenario: Wrapper aliases render workloads without enabled gates

- **WHEN** the umbrella chart renders a platform alias that uses `component-wrapper`
- **THEN** the alias workload renders without a `.Values.enabled` condition
- **AND** object-level controls such as Service, PVC, ConfigMap, and ServiceAccount rendering remain
  governed by their specific object configuration

### Requirement: Bootstrap initializes the whole platform

Platform bootstrap and initialization SHALL run by default and SHALL initialize every core dependency
that needs lifecycle setup.

#### Scenario: Bootstrap and service init complete on a fresh install

- **WHEN** a fresh install is health-gated
- **THEN** the platform bootstrap Job, OpenBao init, Temporal schema job, Temporal bootstrap job,
  DocumentDB init, and required credential materialization complete without requiring a service to be
  manually disabled or re-enabled

#### Scenario: Standalone APISIX remains compatible

- **WHEN** APISIX is configured in standalone mode
- **THEN** bootstrap remains enabled, skips incompatible APISIX admin API reconciliation, and still
  verifies Keycloak/governance bootstrap success

### Requirement: Fresh installs own platform credentials

A fresh install SHALL create and preserve the credentials required by all platform services without
manual pre-created Kubernetes Secrets.

#### Scenario: Credentials are generated and consumed

- **WHEN** the platform is installed into a clean namespace
- **THEN** required datastore, gateway, identity, storage, Temporal, pgvector, OpenBao, and bootstrap
  credentials are generated or adopted once, preserved across upgrades, materialized to the Secret
  names consumed by workloads, and seeded into OpenBao without placeholder values

#### Scenario: ESO materializes consumed Secrets

- **WHEN** ESO is ready
- **THEN** `ClusterSecretStore/openbao-backend` is Ready and every Falcone ExternalSecret is synced to
  a target Secret that is consumed by at least one platform workload or bootstrap/init component

### Requirement: Newly core runtime services have a viable base contract

Each service that was previously default-off SHALL have enough default wiring to be usable, not merely
rendered.

#### Scenario: Control-plane executor is usable

- **WHEN** the executor Deployment is inspected on a fresh install
- **THEN** it has upstream control-plane, PostgreSQL, FerretDB, Kafka, Temporal, MCP, and gateway
  shared-secret environment, namespace-scoped RBAC for the routes it owns, resources, readiness, and a
  Service receiving data-plane routes

#### Scenario: Workflow worker is usable

- **WHEN** the workflow worker Deployment is inspected on a fresh install
- **THEN** it has Temporal address, namespace/task queue, PostgreSQL activity wiring, the Temporal
  NetworkPolicy label, and readiness that proves it is polling

#### Scenario: Temporal is usable

- **WHEN** Temporal bootstrap completes
- **THEN** the Temporal namespace `falcone-flows` exists, required search attributes are registered,
  server roles are Ready, and Temporal remains internal-only

#### Scenario: Temporal schema lifecycle is install/upgrade safe

- **WHEN** Temporal schema manifests are rendered for a fresh install
- **THEN** the schema Job creates the dedicated databases if needed, runs `setup-schema -v 0.0`, and
  then runs `update-schema` for primary and visibility schemas without suppressing errors
- **WHEN** Temporal schema manifests are rendered for an upgrade
- **THEN** the DB bootstrap hook runs before the schema hook, and the schema hook skips
  `setup-schema -v 0.0` and runs only the versioned `update-schema` operations without unconditional
  error suppression

#### Scenario: OpenBao and workspace secrets are usable

- **WHEN** OpenBao init completes
- **THEN** OpenBao is initialized and unsealed, KV v2 and file audit are enabled, policies/roles exist,
  and the control-plane workspace-secret API can write/read metadata without returning
  `SECRETS_BACKEND_DISABLED`

#### Scenario: MCP is usable

- **WHEN** MCP routes are inspected after a fresh install
- **THEN** they are registered by default, use a configured runtime image/digest, have RBAC bound to
  the serving runtime ServiceAccount, and persist core MCP registry/audit/rate state outside process
  memory

#### Scenario: pgvector is usable

- **WHEN** the dedicated pgvector database is probed
- **THEN** a client can create or verify the `vector` extension in `in_falcone_vector`

### Requirement: Existing installs have a safe transition path

The all-core change SHALL include an existing-install transition plan that protects data, secrets,
tenant isolation, and rollback.

#### Scenario: Backup before rollout

- **WHEN** an existing cluster is prepared for rollout
- **THEN** Kubernetes Secrets, external Vault/OpenBao KV data, Helm values/manifests/history, ESO
  ownership, and PVC inventory are backed up with checksums before any apply

#### Scenario: Migration is idempotent and verifiable

- **WHEN** existing secret data is migrated into OpenBao
- **THEN** rerunning the migration is safe, existing values are compared before overwrite, encryption
  master keys are preserved byte-identically, and ESO target Secrets are verified against the source
  data

#### Scenario: Rollback preserves state

- **WHEN** rollout fails after new core services create PVCs or KV state
- **THEN** rollback restores the prior Helm revision and backed-up Secrets without deleting OpenBao,
  pgvector, Temporal, or existing service PVCs

### Requirement: Fresh-install evidence is explicit

The change SHALL define and capture exact evidence proving the default install is all-core.

#### Scenario: Readiness evidence covers every service

- **WHEN** implementer/devops evidence is reviewed
- **THEN** it includes Ready or Completed assertions for every Deployment, StatefulSet, Job,
  `ClusterSecretStore`, ExternalSecret, OpenBao health, Temporal namespace/search attributes,
  workflow worker readiness, executor health, workspace secrets, flows routes, MCP routes, pgvector
  extension smoke, and Prometheus scrape target listed in the design

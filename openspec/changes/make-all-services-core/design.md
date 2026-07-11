# Design: Make All Platform Services Core

This OpenSpec design mirrors the system-change architecture recorded at
`loop-state/system-changes/make-all-services-core/design.md`. That file is the detailed operational
handoff; this file keeps the OpenSpec package self-contained for implementers and reviewers.

## Target End State

Falcone has one supported install shape: the complete platform. A fresh install provisions and wires
APISIX, Keycloak, PostgreSQL, dedicated pgvector PostgreSQL, DocumentDB, FerretDB, Kafka, SeaweedFS
master/volume/filer/S3, observability/Prometheus, Grafana, control-plane, control-plane executor,
web console, workflow worker, ESO, OpenBao, Temporal, MCP, and bootstrap lifecycle jobs.

All service-disable switches are removed from the install source of truth:

- No umbrella dependency `condition:` fields.
- No top-level service `enabled` values for Falcone platform services.
- No component-wrapper `.Values.enabled` workload gate.
- No first-class `if .Values.<service>.enabled` gates for bootstrap, Temporal, MCP, observability,
  Grafana, SeaweedFS core helpers, DocumentDB core helpers, or control-plane function RBAC.
- No shipped profile or install script may disable a core service.

Operational/configuration flags remain where they do not disable a Falcone platform service:
airgap/private registry/transport security, public hostname topology, demo data, OpenShift mode,
probes, resources, replicas, storage class, persistence mode, NetworkPolicy emission, TLS mode, and
unused upstream SeaweedFS roles that Falcone does not consume.

## Baseline Contracts

- **pgvector:** deploy `<release>-postgresql-vector` by default, with generated credentials and a
  10Gi default PVC. Fresh-install evidence must prove `CREATE EXTENSION vector` works.
- **Control-plane executor:** Helm owns the Deployment, Service, ServiceAccount, RBAC, resources,
  env, and APISIX route ownership. It receives PG, FerretDB, Kafka, Temporal, MCP, upstream
  control-plane, and gateway shared-secret wiring by default.
- **Workflow worker:** Helm deploys it by default with Temporal address, namespace/task queue, and
  PostgreSQL activity env. `/readyz` must only pass once it is polling Temporal.
- **ESO:** Falcone owns ESO by default, installs/vends CRDs, creates `ClusterSecretStore/openbao-backend`,
  and materializes the actual Secret names consumed by workloads. Existing clusters with another ESO
  owner require an adoption/decommission rollout, not a permanent disable mode.
- **OpenBao:** deploys in `secret-store`, initializes/unseals idempotently, enables KV v2 and file
  audit, writes policies/roles, and seeds non-placeholder platform credentials. Workspace secrets use
  OpenBao by default, preferably through Kubernetes auth rather than static `BAO_TOKEN`.
- **Temporal:** always renders schema/bootstrap jobs, four server role Deployments, Services,
  NetworkPolicy, and Temporal web. It remains ClusterIP-only and registers namespace `falcone-flows`
  plus `tenantId`, `workspaceId`, `flowId`, `flowVersion`, and `triggerType` search attributes.
- **MCP:** always renders RBAC/NetworkPolicy and sets `MCP_ENABLED=true` for the runtime that serves
  `/v1/mcp/*`. It must use a real configured runtime image digest and a PostgreSQL-backed persistence
  store for server registry/audit/rate state; the memory store remains a test seam only.
- **Bootstrap:** always renders and remains idempotent. It must not need an operator to disable it for
  convergence; standalone APISIX mode skips admin API calls while the Job still provisions Keycloak and
  governance state.

## Credential Ownership

Fresh installs must not require `tests/live-campaign/make-secrets.sh` or manual Secret creation.
OpenBao is the canonical backend for platform and workspace secrets. The chart/OpenBao init path
generates stable non-placeholder values, ESO materializes workload Secrets from those values, and
upgrades preserve existing values.

The all-core credential map must cover the existing consumed Secret names, including PostgreSQL,
pgvector, DocumentDB, FerretDB, DocumentDB replication, Kafka, storage/S3, Keycloak admin,
identity-client, superadmin, APISIX admin, gateway shared secret, Temporal DB credentials if
secret-sourced, and workspace-secret backend auth.

## Existing-Install Transition

Existing installs require a controlled rollout:

1. Preflight the active kube-context, current Helm values, disabled-service overrides, ESO ownership,
   external Vault/OpenBao state, resource headroom, and PVC inventory.
2. Back up Kubernetes Secrets, full recursive external Vault/OpenBao KV-v2 trees, the target OpenBao
   KV-v2 tree when present, Helm values/manifests/history, ESO CRDs/resources, and PVC metadata.
   Capture checksums without logging secret values.
3. Migrate K8s Secret and Vault data into OpenBao idempotently. Import arbitrary external source
   KV-v2 paths/properties before overlaying mapped platform Secret values, preserve encryption master
   keys byte-identically, compare checksums, and stop on mismatch. A complete typed-JSON source/target
   property preflight runs before any write; differing existing target properties fail closed without
   exposing values. Overwrite mode requires the explicit confirmation phrase and a verified target KV
   backup (`targetKvCaptured=true`).
4. Apply the chart first on the test cluster. Wait for OpenBao/ESO, datastore Secrets, stateful
   services, Temporal, worker, executor, bootstrap, and runtime smoke gates.
5. Roll back with exact target KV restore, backed-up Secrets, and the previous Helm revision if any
   gate fails. Do not delete new or existing PVCs during rollback.

## Acceptance Evidence

Fresh-install evidence must include:

- `helm dependency build` and render checks proving no dependency `condition:` or service-level disable
  toggles remain.
- Ready Deployments for APISIX, Keycloak, FerretDB, Grafana, observability, control-plane,
  control-plane executor, web console, workflow worker, Temporal frontend/history/matching/worker/web,
  and SeaweedFS S3.
- Ready StatefulSets for PostgreSQL, pgvector, DocumentDB, Kafka, SeaweedFS master/volume/filer, and
  OpenBao.
- Complete bootstrap, DocumentDB init, Temporal schema/bootstrap, OpenBao init, and ESO webhook wait
  jobs.
- `ClusterSecretStore/openbao-backend Ready=True` and all Falcone ExternalSecrets `SecretSynced`.
- OpenBao initialized/unsealed, KV round trip succeeds, workspace secrets API is active.
- Temporal namespace/search attributes exist, workflow worker is ready, flows routes are active.
- MCP routes are active and backed by durable state.
- pgvector extension smoke passes.
- Prometheus includes the executor and core runtime scrape targets.

## Risk Controls

The implementation must preserve tenant isolation and secret confidentiality. It must not log secrets,
tokens, or unseal keys; must prefer Kubernetes auth to static OpenBao tokens; must keep Temporal and
OpenBao internal-only; must add cross-tenant tests for secrets/flows/MCP; and must protect PVCs from
rollback/uninstall data loss.

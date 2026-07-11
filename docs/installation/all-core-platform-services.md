# All-Core Platform Services

Falcone now installs one complete platform baseline. A fresh Helm install provisions and wires every
Falcone-owned platform service; individual platform services are not optional install-time features.

## Core Baseline

The core baseline includes:

- APISIX gateway.
- Keycloak identity.
- PostgreSQL shared metadata store.
- Dedicated pgvector PostgreSQL.
- DocumentDB engine and FerretDB gateway.
- Kafka.
- SeaweedFS master, volume, filer, and S3 gateway.
- Observability/Prometheus and Grafana.
- Control-plane runtime and control-plane executor.
- Web console.
- Workflow worker.
- External Secrets Operator integration.
- OpenBao.
- Temporal frontend, history, matching, worker, and Temporal web.
- MCP hosting control-plane integration.
- Bootstrap/init jobs for identity, governance seed data, APISIX route reconciliation, OpenBao,
  Temporal, DocumentDB, and platform credentials.

The chart dependencies for these services are unconditional. Values such as
`openbao.enabled=false`, `temporal.enabled=false`, `mcp.enabled=false`,
`postgresqlVector.enabled=false`, `workflowWorker.enabled=false`,
`controlPlaneExecutor.enabled=false`, `observability.enabled=false`, or
`bootstrap.enabled=false` are stale and fail chart validation.

## Preserved Knobs

Operational configuration remains supported when it changes operating mode without removing a
platform service:

- Airgap, private registry, image, pull-secret, and transport security settings.
- Public hostname topology and OpenShift mode.
- Replicas, resources, probes, node selectors, tolerations, affinities, and security contexts.
- Persistence sizing, storage class, and existing-claim selection.
- Service object settings where disabling the Service would not make a core service unreachable.
- NetworkPolicy emission.
- TLS enablement and TLS mode.
- Demo data.
- Unused upstream SeaweedFS roles such as SFTP, admin, worker, COSI, filer-embedded S3, and
  all-in-one. Falcone does not consume those roles, so they remain outside the core service baseline.

## Credential Ownership

Fresh installs no longer require a `make-secrets.sh` pre-step for platform credentials. The chart
creates stable Kubernetes Secrets with `lookup` and `helm.sh/resource-policy: keep` semantics for
datastores, identity, storage, bootstrap, and gateway trust. OpenBao initializes as the canonical
secret backend, and ESO targets the same Secret names consumed by workloads.

Generated values are preserved across upgrades and rollbacks. Do not delete the kept Secrets unless
you intend to rotate the corresponding datastore or platform credential.

Workspace secrets use OpenBao by default. The control-plane and executor use Kubernetes auth through
their ServiceAccounts when `BAO_TOKEN` is absent. Static `BAO_TOKEN` remains a break-glass and test
path only.

## Resource Footprint

The default footprint is larger than earlier partial installs because these services are now always
present:

- pgvector PostgreSQL: 1 StatefulSet replica and a 10 Gi PVC.
- OpenBao: 1 StatefulSet replica and data/audit PVCs.
- ESO: operator, webhook, and cert-controller workloads through the bundled chart.
- Temporal: four server role Deployments, Temporal web, schema and bootstrap jobs.
- Workflow worker: 2 replicas by default.
- Control-plane executor: 2 replicas by default.
- Observability and Grafana are part of every profile.

Resource-constrained profiles may reduce replicas, CPU, memory, and storage sizes. They must not
remove a core service.

## Fresh Install Verification

Before handing a branch to review, render and lint the chart:

```sh
helm dependency build charts/in-falcone
helm lint charts/in-falcone
helm template falcone charts/in-falcone --namespace falcone --include-crds >/tmp/falcone-render.yaml
```

A clean install must show Ready or Complete conditions for the core Deployments, StatefulSets, Jobs,
`ClusterSecretStore/openbao-backend`, and all Falcone `ExternalSecret` resources. It must also prove
OpenBao is initialized and unsealed, Temporal namespace/search attributes exist, the workflow worker
`/readyz` endpoint is healthy, executor flows and MCP routes are registered, workspace secrets do not
return `SECRETS_BACKEND_DISABLED`, pgvector can create the `vector` extension, and Prometheus scrapes
the executor.

## Existing-Install Upgrade

Existing clusters can have disabled-service overrides, manually created Kubernetes Secrets, external
Vault/OpenBao state, an external ESO owner, and PVCs owned by older revisions. Upgrade them through a
controlled rollout:

1. Set `EXPECTED_CONTEXT`, `NS`, and `RELEASE` for the intended test cluster.
2. Run `loop-state/system-changes/make-all-services-core/backup.sh`.
3. Review the backup directory, Helm history, ESO ownership, and PVC inventory.
4. Run `loop-state/system-changes/make-all-services-core/migrate-secrets-to-openbao.sh` with
   `BAO_ADDR`, `BAO_TOKEN`, and `BAO_CACERT`.
5. Dry-run the Helm upgrade and inspect the rendered diff.
6. Apply the all-core chart only after operator approval.
7. Run `loop-state/system-changes/make-all-services-core/health-check.sh`.
8. If any gate fails, run `loop-state/system-changes/make-all-services-core/rollback.sh`.

Rollback restores the previous Helm revision and backed-up Kubernetes Secrets. It does not delete
OpenBao, Temporal, pgvector, or any existing service PVC. Keep those PVCs until the failed rollout is
understood and a separate decommission step is approved.

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
The same fail-closed contract applies to core workload roles: zero-replica overrides such as
`controlPlane.replicas=0`, `temporal.frontend.replicas=0`, `openbao.openbao.replicas=0`, and
`seaweedfs.master.replicas=0` are invalid, as are nested core role disables such as
`seaweedfs.master.enabled=false` or `eso.external-secrets.webhook.create=false`.

## Preserved Knobs

Operational configuration remains supported when it changes operating mode without removing a
platform service:

- Airgap, private registry, image, pull-secret, and transport security settings.
- Public hostname topology and OpenShift mode.
- Replica counts of at least one, resources, probes, node selectors, tolerations, affinities, and
  security contexts.
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
- ESO: operator, webhook, and cert-controller workloads through the bundled chart. They run in
  `eso.eso.namespace` (default `eso-system`); keep `eso.external-secrets.namespaceOverride`,
  `eso.eso.namespace`, and `openbao.eso.namespace` equal when customizing the ESO namespace so
  OpenBao auth and ESO egress NetworkPolicy protect the namespace that actually contains the
  operator pods.
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

The implementer stage does not apply to a cluster; the orchestrator/devops verification step must
run the clean install and attach this evidence before the fresh-install tasks are checked off.

## Existing-Install Upgrade

Existing clusters can have disabled-service overrides, manually created Kubernetes Secrets, external
Vault/OpenBao state, an external ESO owner, and PVCs owned by older revisions. Upgrade them through a
controlled rollout:

1. Set `KUBECONFIG`, `NAMESPACE`, `RELEASE`, and `OPENBAO_NAMESPACE` for the intended cluster.
   Set `SOURCE_BAO_ADDR`/`SOURCE_BAO_TOKEN` only when the old deployment used an external
   Vault/OpenBao source. Set target `BAO_ADDR`/`BAO_TOKEN` only if target OpenBao already exists
   and should be captured before rollout; this target capture is mandatory if migration will run
   with `--allow-overwrite`.
2. Run `scripts/system-changes/make-all-services-core/backup-kv.sh --output /secure/path/falcone-kv-backup.tgz`.
3. Run `scripts/system-changes/make-all-services-core/parity-check.sh --dry-run` to inspect
   Kubernetes Secret and OpenBao fingerprints without printing values.
4. Run `scripts/system-changes/make-all-services-core/migrate-platform-secrets.sh --dry-run`.
5. Run `scripts/system-changes/make-all-services-core/migrate-platform-secrets.sh --apply --backup /secure/path/falcone-kv-backup.tgz`.
6. Run `scripts/system-changes/make-all-services-core/parity-check.sh --strict`.
7. Run `scripts/system-changes/make-all-services-core/diff-rollout.sh --chart charts/in-falcone`
   with the same values files and `--set` overrides intended for rollout. The script uses
   `helm diff upgrade --install` when the plugin is installed, otherwise it renders the chart and
   runs `kubectl diff`.
8. Apply the all-core chart only after operator approval.
9. Run `scripts/system-changes/make-all-services-core/health-check.sh`.
10. If any gate fails, run
    `scripts/system-changes/make-all-services-core/restore-kv.sh --backup /secure/path/falcone-kv-backup.tgz --apply --helm-rollback`,
    verify parity again, and rerun the health gate.

The backup command refuses to overwrite an existing archive. It always captures source Kubernetes
Secrets, Helm metadata, ESO objects, PVC references, the full external Vault/OpenBao KV-v2 tree when
configured, and the full target OpenBao KV-v2 tree when target `BAO_ADDR`/`BAO_TOKEN` are supplied.
Kubernetes API, RBAC, discovery, or kube-context failures abort the backup instead of being recorded
as absent; only an explicit not-found response for the optional
`ClusterSecretStore/openbao-backend` object can be captured as absent. KV enumeration and object
reads also fail closed: authentication, network, or inconsistent listed-object failures abort the
backup, and the final archive is published atomically only after verification. Only an explicit
not-found response can represent an empty KV tree, so a partial capture is never marked
`verified=true` or `targetKvCaptured=true`. Target OpenBao KV is marked absent when target
credentials are not supplied. Migration and
initialization use merge semantics for KV paths, so unmapped properties already present at a path are
preserved instead of being replaced by the mapped platform credential set. Before any write, migration
compares every external source path/property with the target using typed JSON equality and reports only
paths, property names, statuses, and SHA-256 fingerprints. Missing or identical target properties are
safe; target OpenBao read errors fail closed before any write instead of being treated as missing.
Any differing target property fails the entire apply before the first write. An apply with
`--allow-overwrite` additionally requires `CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values`
and refuses to run unless the verified backup has `targetKvCaptured=true`, ensuring every overwritten
target path/property can be restored.

Rollback restores Kubernetes Secrets and ESO resources and can return the Helm release to the
previous revision without depending on target OpenBao availability. If the backup captured target
OpenBao KV and target `BAO_ADDR`/`BAO_TOKEN` reach OpenBao, rollback also restores that KV tree
exactly. Exact KV restore can remove KV paths created after the backup so the secret mount matches
the captured target state; it does not delete OpenBao, Temporal, pgvector, or any existing service
PVC. Keep those PVCs until the failed rollout is understood and a separate decommission step is
approved.

## Image Publication Status

Third-party defaults were verified with `docker manifest inspect` for
`docker.io/bitnamilegacy/postgresql:17.2.0`, `docker.io/bitnamilegacy/kafka:3.9.0`,
`docker.io/alpine/k8s:1.32.2`, `docker.io/pgvector/pgvector:pg17`,
`docker.io/apache/apisix:3.10.0-debian`, and
`docker.io/prom/prometheus:v3.2.1@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62`.

The OpenShift/Harbor overlay leaves UID, GID, and fsGroup assignment to restricted-v2,
uses no hostPath volumes, and attaches the configured Harbor pull secret to every rendered
pod, including Grafana, OpenBao, ESO lifecycle hooks, and SeaweedFS TLS bootstrap. The base
control-plane values derive PostgreSQL, Keycloak, SeaweedFS S3, Kafka, and function-runtime
wiring from the actual Helm release and global registry, so custom release names and namespaces
do not require a replacement environment list.

Falcone application images are buildable from this repository, and the tracked
`.github/workflows/release-images.yml` workflow publishes the control-plane, control-plane
executor, web console, function runtime, workflow worker, and first-party MCP runtime images on a
release. The base chart now renders coherent chart app-version release refs such as
`ghcr.io/gntik-ai/in-falcone-control-plane:0.3.0` instead of `localhost` aliases. The kind profiles
still override those refs to `localhost:30500` for repository-local prebuild validation.

The coherent `0.3.0` first-party image set was published to GHCR by GitHub Actions run
`29152340476`: `in-falcone-control-plane`, `in-falcone-control-plane-executor`,
`in-falcone-web-console`, `in-falcone-workflow-worker`, `in-falcone-fn-runtime`, and
`in-falcone-mcp-runtime`. OpenShift/Harbor installs must mirror all six `0.3.0` tags, including
`fn-runtime`, before installation. Digest pins are still intentionally deferred until a clean
fresh-cluster install captures the exact manifests used for release evidence.

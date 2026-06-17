# Falcone — From-Scratch kind Reinstall Plan (campaign-20260617)

Validated against `charts/in-falcone` + `deploy/kind` by source inspection and
`helm template` only. NO destructive op was executed. Cluster:
`KUBECONFIG=./kubeconfig-test-cluster-b.yaml`, namespace `falcone`.

Scripts (this campaign):
- `tests/live-campaign/make-secrets.sh` — author every required Secret (fresh randoms).
- `tests/live-campaign/values-campaign.yaml` — overlay (campaign tags, full
  `controlPlane.env`, `bootstrap.enabled=true`, `vault.enabled=true`).
- `tests/live-campaign/teardown.sh` — helm uninstall + ns nuke + cluster-scoped cleanup.
- `tests/live-campaign/install.sh` — ordered, health-gated install.

## Deploy topology (hybrid — confirmed in code)

| Layer | Mechanism | Source |
|---|---|---|
| datastores, control-plane, apisix, web-console, keycloak, observability, grafana, ferretdb, documentdb, seaweedfs, bootstrap, vault | Helm umbrella `charts/in-falcone` + `deploy/kind/values-kind.yaml` + `values-campaign.yaml` | `Chart.yaml` deps |
| cp-executor | `kubectl apply` of `deploy/kind/executor-demo.yaml` (image rewritten to campaign tag) | not helm |
| APISIX routes | `apply-apisix-routes.sh` → ConfigMap `falcone-apisix-standalone` from `deploy/kind/apisix/apisix.yaml` | standalone mode |
| functions | Knative Service per function, created **on-demand** by control-plane from `FN_RUNTIME_IMAGE` | `fn-runtime/server.mjs` loads `FN_SRC`; no static ksvc |

Knative Serving + Kourier are already cluster-installed (`knative-serving` ns, ksvc
CRD, all pods Running) — a cluster prerequisite, NOT (re)installed by this campaign.

Enabled chart components (post-overlay): apisix, keycloak, postgresql, documentdb,
ferretdb, kafka, seaweedfs, grafana, observability, controlPlane, webConsole,
bootstrap(=true override), vault(=true). OFF: controlPlaneExecutor (chart),
workflowWorker, eso, temporal, mcp. No mongodb/openwhisk/minio chart deps exist;
`helm template` confirms zero such workloads render.

## Secret schema (authored fresh on a from-scratch install)

All values are NEW random material (so fresh datastores initdb with them). Type
`Opaque` unless noted. "Consumed by" derived from chart templates / `values-kind.yaml`.

| Secret | Type | Key(s) | Consumed by | Notes / cross-refs |
|---|---|---|---|---|
| `in-falcone-postgresql` | Opaque | `POSTGRESQL_USERNAME`, `POSTGRESQL_PASSWORD`, `POSTGRESQL_POSTGRES_PASSWORD` | postgresql StatefulSet (`envFromSecrets`); control-plane `PGPASSWORD`; executor `PGPASSWORD`/setup-job `POSTGRESQL_POSTGRES_PASSWORD`; seaweedfs filer init | app role `falcone` + superuser. Username `falcone`, db `in_falcone`. |
| `in-falcone-documentdb` | Opaque | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | documentdb StatefulSet (`envFromSecrets`); control-plane/executor `MONGO_PASSWORD` | admin user `falcone_doc_admin`, db `in_falcone`. Password backs the ferretdb URL. |
| `in-falcone-ferretdb` | Opaque | `postgresql-url` | ferretdb Deployment `FERRETDB_POSTGRESQL_URL` | `postgres://falcone_doc_admin:<docpw>@falcone-documentdb:5432/postgres?sslmode=disable` — password MUST match `in-falcone-documentdb`. |
| `in-falcone-documentdb-replication` | Opaque | `password`, `realtime-url` | `password` → documentdb-init Job (creates role `falcone_cdc_repl`); `realtime-url` → control-plane `REALTIME_DOCUMENTDB_URL` | required because `documentdb.logicalReplication.enabled=true`. `realtime-url` is `optional:true` for control-plane but the init Job HARD-requires `password`. |
| `in-falcone-kafka` | Opaque | `KAFKA_CFG_NODE_ID`, `KAFKA_CFG_PROCESS_ROLES`, `KAFKA_CFG_CONTROLLER_LISTENER_NAMES`, `KAFKA_CFG_CONTROLLER_QUORUM_VOTERS`, `KAFKA_CFG_LISTENERS`, `KAFKA_CFG_ADVERTISED_LISTENERS`, `KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP` | kafka StatefulSet (`envFromSecrets`) | KRaft config (structural, not credentials). Single broker: node 0, quorum `0@127.0.0.1:9093`. |
| `in-falcone-storage` | Opaque | `s3_access_key`, `s3_secret_key` | control-plane `STORAGE_S3_ACCESS_KEY`/`STORAGE_S3_SECRET_KEY` | **MUST equal** `in-falcone-seaweedfs-s3-creds` pair (see reconciliation). NB: the live secret used legacy keys `MINIO_ROOT_*`; the kind profile reads `s3_access_key/s3_secret_key`. |
| `in-falcone-keycloak-admin` | Opaque | `username`, `password` | bootstrap Job (`BOOTSTRAP_KEYCLOAK_ADMIN_*`) | The admin the bootstrap Job logs in with. **MUST equal** `in-falcone-identity-client` values. |
| `in-falcone-identity-client` | Opaque | `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` | keycloak Deployment (`envFromSecrets`) | This is how a FRESH Keycloak creates its INITIAL admin. (NOT client-id/secret — `values.yaml config.secretRefs` is misleading; live secret + render confirm the KC_BOOTSTRAP_ADMIN_* keys.) Must match `in-falcone-keycloak-admin`. |
| `in-falcone-superadmin` | Opaque | `password` | bootstrap Job (`BOOTSTRAP_SUPERADMIN_PASSWORD`) | platform superadmin password set in the realm. |
| `in-falcone-apisix-admin` | Opaque | `admin-key` | bootstrap Job (`BOOTSTRAP_APISIX_ADMIN_KEY`) | unused under `APISIX_STAND_ALONE` (no admin API) but the Job env references it. |
| `in-falcone-seaweedfs-s3-creds` | Opaque | `s3AccessKey`, `s3SecretKey` | seaweedfs s3-creds template `lookup` (reused); identities JSON derives from it | **PRE-CREATE to pin.** `templates/seaweedfs-s3-creds.yaml` reuses an existing Secret via `lookup` and builds `in-falcone-seaweedfs-s3-config` from it. Must equal `in-falcone-storage` pair. |
| `in-falcone-seaweedfs-s3-config` | Opaque | `seaweedfs_s3_config` | seaweedfs S3 gateway (`existingConfigSecret`) | **Chart-generated** from the creds above; do NOT author by hand. |
| `in-falcone-dev-api-tls` | `kubernetes.io/tls` | `tls.crt`, `tls.key` | rendered nginx Ingress (`publicSurface`) | self-signed; see TLS section. |
| `in-falcone-dev-console-tls` | `kubernetes.io/tls` | `tls.crt`, `tls.key` | rendered nginx Ingress | self-signed. |
| `in-falcone-dev-identity-tls` | `kubernetes.io/tls` | `tls.crt`, `tls.key` | rendered nginx Ingress | self-signed. |
| `in-falcone-dev-realtime-tls` | `kubernetes.io/tls` | `tls.crt`, `tls.key` | rendered nginx Ingress | self-signed. |

Not authored (intentionally): `in-falcone-mongodb` (legacy, no consumer after the
FerretDB cutover); kafka/identity `username/password` SASL pairs from
`values.yaml config.secretRefs` (unused in the kind profile — kafka is PLAINTEXT).

## SeaweedFS ↔ in-falcone-storage reconciliation (implemented)

The control-plane reads object-storage creds from **`in-falcone-storage`**
(`s3_access_key`/`s3_secret_key`), but SeaweedFS authenticates against the
identities JSON in **`in-falcone-seaweedfs-s3-config`**, derived by
`templates/seaweedfs-s3-creds.yaml` from **`in-falcone-seaweedfs-s3-creds`**
(`s3AccessKey`/`s3SecretKey`). If these differ, every S3 call 403s.

**Chosen reconciliation — PIN via pre-create (safest, no values override):**
`seaweedfs-s3-creds.yaml` does `lookup "v1" "Secret" <ns> in-falcone-seaweedfs-s3-creds`
and, if found, REUSES its `s3AccessKey`/`s3SecretKey` (no random regeneration) and
derives the config Secret from them. So `make-secrets.sh` PRE-CREATES
`in-falcone-seaweedfs-s3-creds` with a known pair, and authors `in-falcone-storage`
with the SAME pair. The chart then derives the gateway identities JSON from the
pinned values → control-plane and gateway share one credential pair. No subchart
values key needs to be set (the seaweedfs subchart has no plaintext s3-key override;
auth flows entirely through the chart-managed identities JSON).
Caveat: `helm template` cannot run `lookup` (renders empty → random in the dry-run),
so the pinning is only observable at real install time; functionally correct.

## TLS — REQUIRED (4 secrets)

The chart DEFAULT `platform.network.exposureKind: Ingress` +
`publicSurface.tls.mode: clusterManaged` is NOT overridden by `values-kind.yaml`, so
the render produces ONE nginx `Ingress` referencing all four
`in-falcone-dev-<surface>-tls` secrets (api/console/identity/realtime). An Ingress
applies even if the secrets are absent, but the live cluster carries all four and we
recreate them **self-signed** to preserve the working state. These are the ONLY TLS
secrets the kind profile needs; no Route/cert-manager publicSurface path renders.

## helm template validation — PASS

`helm dependency build charts/in-falcone` → success (14 deps incl. seaweedfs 4.33).
`helm template falcone charts/in-falcone -n falcone -f deploy/kind/values-kind.yaml
-f tests/live-campaign/values-campaign.yaml` → **exit 0, no stderr**, schema
validation (`values.schema.json`, enforced by default in Helm v4) passes. Verified in
the render: `FN_RUNTIME_IMAGE=localhost:30500/in-falcone-fn-runtime:campaign-20260617`;
control-plane + web-console images at `:campaign-20260617`; bootstrap Job present
(label `in-falcone.io/component=bootstrap`, name `falcone-in-falcone-bootstrap`);
vault objects render; every secretKeyRef/secretRef resolves to an authored secret.

## Vault reality (honest)

`vault.enabled=true` adds a Vault SERVER only; it does NOT change how Falcone reads
secrets. Every datastore/app reads NATIVE k8s Secrets (`envFromSecrets`/`secretKeyRef`).
No enabled component reads from Vault (no agent injection, no ESO `ExternalSecret`
targeting app secrets — `eso.enabled=false`). So "secrets via Vault" is NOT in effect:
Vault is an unused, standalone pod here.

Worse, on THIS kind cluster Vault is **degraded / will not become Ready**:
- The vault subchart deploys into namespace **`secret-store`** and an SA into
  **`eso-system`** — neither is rendered by the chart, so `install.sh` pre-creates them.
- `charts/in-falcone/charts/vault/templates/vault-tls-certificate.yaml` is a
  `cert-manager.io/v1` `Certificate` (ClusterIssuer `selfsigned-issuer`) and the vault
  Deployment mounts `secretName: vault-server-tls` as a REQUIRED volume.
  **cert-manager is NOT installed** on test-cluster-b (verified: CRDs absent) → the
  `Certificate` apply fails (CRD missing) and/or `vault-server-tls` never materializes
  → the vault pod stays Pending. The health gate therefore does NOT probe vault, and
  the `vault` rollout may block. **Recommendation:** either install cert-manager first,
  or keep `vault.enabled=false`. The campaign overlay honors the request
  (`vault.enabled=true`) but the platform is healthy WITHOUT vault.

## Cluster-scoped objects (teardown must remove)

`falcone-seaweedfs-rw-cr` (ClusterRole) + `-rw-crb` (ClusterRoleBinding);
`vault-kubernetes-auth` (ClusterRole + ClusterRoleBinding); plus the auxiliary
namespaces `secret-store` and `eso-system` (vault SAs live there). All handled by
`teardown.sh`.

## Risks / uncertainties to check BEFORE running teardown

1. **Vault/cert-manager (HIGH):** with `vault.enabled=true` and no cert-manager, the
   `helm upgrade` may FAIL on the `cert-manager.io/v1 Certificate` apply (unknown CRD),
   aborting the whole release. Mitigation: install cert-manager first, OR set
   `vault.enabled=false` for this run. Decide before teardown.
2. **`in-falcone-storage` key convention:** the LIVE secret used `MINIO_ROOT_*`; the
   kind control-plane reads `s3_access_key`/`s3_secret_key`. The fresh secret uses the
   latter (what `values-kind.yaml` references) — correct, but worth confirming the
   control-plane image campaign-20260617 still reads those env names.
3. **`helm.sh/resource-policy: keep` secrets:** `in-falcone-seaweedfs-s3-creds`/`-config`
   survive `helm uninstall`; the namespace delete removes them. Confirm the ns delete
   completes (PVCs/finalizers) — teardown polls up to ~3 min.
4. **DocumentDB user mismatch:** control-plane connects as `MONGO_USER=falcone` while
   the documentdb admin role is `falcone_doc_admin`; FerretDB mediates. This mirrors
   the live working config; if the campaign control-plane changed its Mongo auth model,
   re-verify.
5. **Bootstrap hook timing:** the bootstrap Job is a Helm post-install HOOK
   (`hook-delete-policy: before-hook-creation`); `helm upgrade` blocks on it, and
   `install.sh` then waits on the label. If helm deletes the hook pod immediately on
   success, the `kubectl wait` may briefly race — it tolerates this (the Job completed).
6. **PVC reuse:** a true from-scratch requires the namespace (and its PVCs) to be GONE
   before reinstall, else old datastore data + OLD passwords persist and the fresh
   secrets won't match. `teardown.sh` deletes the namespace (and PVCs) — run it and let
   it complete before `install.sh`.

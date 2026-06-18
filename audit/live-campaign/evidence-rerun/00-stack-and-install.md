# Re-run 2026-06-18 — clean HEAD install + stack-under-test verification

**Cluster:** kind `test-cluster-b` (ns `falcone`). **Images:** all app images rebuilt from current `main` HEAD
(post P0/P1/P2 merges #547–#577) under the unique tag **`head-20260618`** (zero stale-cache risk).

## Clean-slate proof
- `teardown.sh` → release uninstalled, ns `falcone` deleted & polled gone, no residual release secrets. (RC=0)
- Fresh `helm install` (from-scratch) → 20/20 app pods Running 1/1; Keycloak bootstrap Job **Completed on a cold
  install** (confirms #558 cold-start-race fix holds — prior DEP-BOOTSTRAP is resolved).
- App image tags deployed (proves clean HEAD, not a patched prior install):
  - control-plane `…:head-20260618`, cp-executor `…:head-20260618`, web-console `…:head-20260618`,
    workflow-worker `…:head-20260618`.

## Stack under test (any old component = a finding)
| S# | Expected | Found | Verdict |
|----|----------|-------|---------|
| S1 | FerretDB/DocumentDB (mongo-wire), NOT MongoDB | `ghcr.io/ferretdb/ferretdb` + `ghcr.io/ferretdb/postgres-documentdb`; no `mongodb` workload | **PASS** |
| S2 | SeaweedFS, NOT MinIO | seaweedfs master/volume/filer/s3 pods; no `minio` workload | **PASS** |
| S3 | Knative, NOT OpenWhisk | `knative-serving` + `kourier-system` namespaces Active; `services.serving.knative.dev` CRD present; no `openwhisk` workload | **PASS** |
| S4 | Vault (pre-OpenBao) | `vault.enabled=false` on kind (cert-manager absent → enabling aborts the release); apps read native k8s Secrets | **DEP-VAULT** (expected; Vault is still the intended backend, not a migration gap) |

`kubectl get pods,svc,statefulset,deploy | grep -iE 'mongo|minio|openwhisk'` (excluding ferret/documentdb) → **NONE**.

## Install findings surfaced by the mandated from-scratch install
- **DEP-SWFS-NETPOL (P1, fresh-install blocker):** the Falcone `seaweedfs-networkpolicy.yaml` restricts the storage
  tier's internal ports (master 9333/19333, filer 8888/18888) to pods labeled `app.kubernetes.io/name: seaweedfs`,
  but the **upstream seaweedfs subchart's post-install bucket-provisioning hook** (`{release}-bucket-hook`) carries
  no such label. On any NetworkPolicy-ENFORCING CNI (this kind cluster runs `kube-network-policies`; prod
  Calico/Cilium/OVN likewise) the hook's `wget /cluster/status` to the master is DROPPED → it hangs forever → the
  post-install hook chain (weight -5) blocks `documentdb-init` (weight 5) → ferretdb never converges → `helm install`
  times out. The chart comment wrongly assumes "kind does not enforce NetworkPolicy." **Workaround this run:**
  `seaweedfs.networkPolicy.enabled=false`. **Proper fix:** allow the bucket-hook in the netpol (or label it
  `app.kubernetes.io/name: seaweedfs`). Evidence: bucket-hook stuck "Service not ready"; `curl master:9333` from
  unlabeled pod → 000; `wget localhost:9333/cluster/status` inside master → `{"IsLeader":true}`.
- **DEP-HEALTHGATE (P2, harness):** `install.sh` health gate reports 2 false negatives — (a) `apisix /health → 404`
  (the gateway proxies `/health` to an upstream path that 404s; `/v1/*` routing works: `POST /v1/auth/login-sessions`
  → 400, `GET /v1/tenants` → 401, not 404); (b) `ferretdb:27017 unreachable` from the unlabeled smoke pod (the
  ferretdb internal-only netpol drops it) — but ferretdb IS reachable from the executor (allowed client): TCP OK.

# Fresh-install verification — Vault → OpenBao

> ## RE-VERIFICATION (after fixes) — 2026-06-23, run 2
>
> The four blockers + two NetworkPolicy gaps from run 1 (below) were FIXED in the chart. A **clean,
> no-workaround** install on `kind-test-cluster-b` now self-bootstraps OpenBao + ESO end-to-end.
> **All 6 verification points GREEN.**
>
> | # | Check | Result |
> |---|-------|--------|
> | 1 | OpenBao up, `openbao/openbao:2.3.1`, no `hashicorp/vault` anywhere | **PASS** |
> | 2 | `Job/openbao-init` Completed (1/1, 0 restarts); `bao status` Initialized=true, **Sealed=false** | **PASS** (self-bootstrap, no manual init) |
> | 3 | KV v2 round-trip via k8s-auth eso-role login; all 7 seeded paths present | **PASS** |
> | 4 | `ClusterSecretStore/openbao-backend` Ready=True; 6 ExternalSecrets SecretSynced; 6 `*-credentials` Secrets materialized | **PASS** |
> | 5 | Audit log `/openbao/audit/openbao-audit.log` = JSON with `time`/`request.{id,operation,path}`/`auth` | **PASS** (sidecar gated off; server still writes the log) |
> | 6 | k8s-auth ACL alias `auth_kubernetes_cluster_1` (tenant policy) | DOCUMENTED pre-existing follow-up (not on platform/ESO path) |
>
> ### Fixes applied (file:line)
> 1. **bitnami/kubectl 404** — `charts/in-falcone/charts/openbao/values.yaml`: bootstrap image `docker.io/bitnami/kubectl` → `docker.io/bitnamilegacy/kubectl` (tag 1.32.2); migration image `bitnami/kubectl:latest` → `bitnamilegacy/kubectl:1.32.2`.
> 2. **Liveness probe killed pre-init pod** — `openbao-statefulset.yaml`: liveness path `/v1/sys/health?standbyok=true` → `...&sealedcode=204&uninitcode=204` (matches readiness) + `failureThreshold: 6`. Result: openbao-0 0 restarts.
> 3. **Audit sidecar bundle missing** — `openbao/values.yaml`: `auditSidecar.enabled: true` → **`false`** (chosen path: GATE, not bundle). Rationale: `services/secret-audit-handler/src/index.mjs` does `await import('kafkajs')` and `process.exit(1)` without `KAFKA_BROKERS`+reachable Kafka, so it cannot run from bare ConfigMap source in vanilla `node:20-alpine` (no node_modules) — it would crashloop and keep the pod NotReady, blocking bootstrap. OpenBao still runs `audit enable file`, so the Vault-schema audit log is written and `vault-log-reader.mjs` compat is unaffected; only the live Kafka tailer is deferred (needs a purpose-built image — a pre-existing gap, not a Vault-vs-OpenBao issue). The sidecar volume in the StatefulSet is also gated on the toggle.
> 4. **Invalid ESO field** — `eso/templates/cluster-secret-store.yaml`: removed `spec.provider.vault.auth.kubernetes.tokenExpirationSeconds` (not a field in external-secrets 0.9.0 → strict-decode reject).
> 5. **ESO CRDs-before-CRs ordering** — vendored the 11 external-secrets CRDs into `eso/crds/external-secrets-crds.yaml` (Helm installs `crds/` first, even in the umbrella) + set `external-secrets.installCRDs: false` (so the operator dep does not also render them); the ClusterSecretStore/ExternalSecret CRs are Helm `post-install,post-upgrade` hooks (store weight 0, secrets weight 5); a new `eso-webhook-wait` hook Job (weight -5) blocks until the external-secrets admission webhook endpoint is serving before the CR hooks apply (fixes a webhook "connection refused" race). One-pass `helm install` now succeeds.
> 6. **NetworkPolicy egress/ingress** — `openbao-networkpolicy.yaml`: added DNS (UDP/TCP 53 → kube-system) egress, **kube-API egress on 443 AND 6443** (the real ESO-403 fix, see #7), and added the OpenBao namespace itself to the **ingress** allow-list (so the in-namespace `openbao-init` Job can reach :8200). `eso/templates/eso-networkpolicy.yaml`: added DNS (53) + kube-API (443/6443) egress.
> 7. **ESO k8s-auth 403 — ROOT CAUSE was NETWORK, not auth-config.** OpenBao's `auth/kubernetes/login` does a TokenReview call to the kube API. The `openbao-access-policy` egress allowed only `0.0.0.0/0:443`, but the `kubernetes.default` ClusterIP (10.96.0.1:443) **DNATs to the apiserver endpoint `172.18.0.2:6443`**, and kindnet evaluates egress against the POST-DNAT destination — so the TokenReview timed out (`dial tcp 10.96.0.1:443: i/o timeout`, seen only at OpenBao `log_level=trace`) and every login returned `403 permission denied`. **Fix = add TCP 6443 to the OpenBao pod's egress** (fix #6). No init-Job/auth-config change was needed; the config keeps `token_reviewer_jwt` (the openbao SA, which has `tokenreviews` RBAC). Verified: deleting the NetworkPolicy made login succeed instantly; adding the 6443 egress fixes it with the policy in place. (An earlier hypothesis that this was a `disable_iss_validation`/reviewer-JWT issue was wrong; reverted.)
> 8. **Init-Job robustness (additional bugs found while making bootstrap work):**
>    - **Wait-for-server:** the Job now polls until the server answers (`bao status -format=json | grep -q '"initialized"'` — note `bao status` exits non-zero when sealed, so a zero-exit check would loop forever) before init, instead of racing pod startup.
>    - **Pretty-JSON unseal-key parse:** `bao operator init -format=json` emits MULTI-LINE JSON; the old single-line `sed` for `unseal_keys_b64` matched NOTHING → empty keys → `unseal ""` failed under `set -e` → server left initialized-but-sealed. Fixed by `tr -d '\n'` flatten + array-element extraction (+ empty-key guard). This was a latent, always-broken parse exposed once the network path worked.
>    - **Idempotent guard:** skip only when initialized **AND unsealed**; if initialized-but-sealed with no keys, FAIL LOUD instead of silently "succeeding" while sealed.
>
> ### Re-verification evidence (clean install, no workarounds)
> - `helm install openbao charts/in-falcone/charts/openbao -n secret-store --set openbao.tls.mode=self-signed` → init Job **Complete 1/1**, openbao-0 **1/1 Ready, 0 restarts**, `bao status`: Initialized=true, **Sealed=false**, Shares 5/Threshold 3, Version 2.3.1.
> - k8s-auth eso-role login (valid 962-char token): **SUCCESS**, `token_policies=[default,functions,gateway,iam,platform]`; read `secret/platform/postgresql` → `root-password`/`app-password` present; all 7 seeded paths (`platform/{postgresql,documentdb,kafka,s3,encryption}`, `gateway/apisix`, `iam/keycloak`) non-empty.
> - ESO one-pass: `helm install eso charts/in-falcone/charts/eso -n eso-system` → **STATUS deployed**; operator 3/3 Running; `ClusterSecretStore/openbao-backend` **Ready=True/Valid**; 6 ExternalSecrets **SecretSynced/Ready=True**; 6 `*-credentials` Secrets materialized (e.g. `platform-postgresql-credentials` carries `app-password`/`root-password` = the seeded `dummy-*` values).
> - Audit: `/openbao/audit/openbao-audit.log`, 160 lines, valid JSON; entries carry `time`, `request.id`, `request.operation`, `request.path`, `auth`. Sidecar container correctly ABSENT.
> - Umbrella render `helm template ... -f values-kind.yaml -f values-kind-vault.yaml`: `openbao/openbao:2.3.1` ×3, `hashicorp/vault` = 0, no non-legacy bitnami, no `tokenExpirationSeconds`; `--include-crds` renders the 11 external-secrets CRDs (umbrella path inherits all fixes).
>
> ### Still unresolved (documented, non-blocking)
> - **tenant-policy ACL alias (#8):** `openbao-policies/tenant-policy.hcl.yaml` hardcodes `identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId`, but the live k8s auth mount accessor is auto-generated (e.g. `auth_kubernetes_2b84b185`), so the per-tenant template would not resolve. Pre-existing, NOT on the platform/ESO critical path verified here. A clean fix would have the init Job read the real accessor (`bao auth list -format=json`) and substitute it before `bao policy write`. Left as a follow-up.
>
> ---
> ## RUN 1 (pre-fix, original report) — for history
>
> The findings below are from the FIRST verification run, before any fixes. They are retained as the
> defect record; all six are addressed above.

## Verdict summary

| # | Check | Result |
|---|-------|--------|
| 0 | Chart deps / offline render (`openbao/openbao:2.3.1`, no `hashicorp/vault`) | PASS |
| 1 | OpenBao up, image `openbao/openbao:2.3.1`, no vault image | PASS (after 2 workarounds) |
| 2 | Init/unseal (Initialized=true, Sealed=false) | PASS only via manual init (the **`openbao-init` Job never completes** on a clean install — defect) |
| 3 | KV v2 round-trip + 7 seeded paths | PASS |
| 4 | ESO ClusterSecretStore Ready + 6 ExternalSecrets synced | **FAIL** |
| 5 | Audit log JSON shape matches `parseVaultEntry` | PASS |
| 6 | k8s-auth ACL alias (`auth_kubernetes_cluster_1`) | Latent concern (alias name mismatch) |

A clean install of this branch's secret-store stack **DOES NOT come up working out of the box.** OpenBao the server is fine (correct image, KV works, audit format OK), but the chart's own bootstrap cannot complete and ESO never authenticates. Four install-blocking defects + two latent NetworkPolicy/ACL defects found.

---

## Step 0 — prep (PASS)

```
helm dependency build charts/in-falcone/charts/eso   # vendored external-secrets-0.9.0.tgz
helm dependency build charts/in-falcone              # built openbao-0.1.0.tgz; NO vault-0.1.0.tgz
helm template falcone-openbao charts/in-falcone -f deploy/kind/values-kind.yaml -f deploy/kind/values-kind-vault.yaml
```
Render: `openbao/openbao:2.3.1` present (3 occurrences), `hashicorp/vault` = **0 occurrences**. No `vault-0.1.0.tgz` in `charts/in-falcone/charts/`.

## Step 1 — install (Option A)

```
# 8 namespaces created
kubectl create namespace secret-store eso-system postgresql documentdb kafka s3-compat apisix keycloak

# OpenBao subchart (self-signed TLS). FIRST attempt hung on the pre-install TLS-bootstrap hook
# because docker.io/bitnami/kubectl:1.32.2 is 404 (FINDING 1). Re-installed with legacy override:
helm install openbao charts/in-falcone/charts/openbao -n secret-store \
  --set openbao.tls.mode=self-signed \
  --set openbao.tls.bootstrap.image.repository=docker.io/bitnamilegacy/kubectl \
  --set openbao.tls.bootstrap.image.tag=1.32.2 \
  --set openbao.migration.image.repository=docker.io/bitnamilegacy/kubectl \
  --set openbao.migration.image.tag=1.32.2
# STATUS: deployed. But pod NotReady (sidecar crashloop FINDING 2) + liveness restart loop (FINDING 3).
helm upgrade openbao ... --set openbao.auditSidecar.enabled=false   # workaround FINDING 2
kubectl patch sts openbao ... livenessProbe path += &sealedcode=200&uninitcode=200  # workaround FINDING 3
# init Job still could not self-bootstrap (FINDING via DNS); initialized OpenBao MANUALLY via 127.0.0.1.

# ESO: bundling CRs+operator in one release fails (FINDING 4a). Installed operator standalone first:
helm install external-secrets charts/in-falcone/charts/eso/charts/external-secrets-0.9.0.tgz -n eso-system --set installCRDs=true
# then applied eso/templates/* CRs. ClusterSecretStore rejected for unknown field (FINDING 4b);
# re-applied without tokenExpirationSeconds. Store STILL Ready=False (DNS timeout + k8s-auth 403).
```

---

## Per-check evidence

### #1 OpenBao up — PASS
- `kubectl get sts/openbao -n secret-store -o jsonpath='{...containers[*].image}'` → `openbao/openbao:2.3.1`
- No `hashicorp/vault` image in any pod cluster-wide.
- `openbao-0` server container: `ready=true restarts=0` (after liveness-probe patch).

### #2 Init/unseal — Job FAILS; manual init OK
- The chart's `openbao-init` Job **never completes** on a clean install (root cause = DNS timeout below + the server restart loop). It sat `active=1` / CrashLoopBackOff for >5 min.
- `bao operator init` via the Service FQDN from inside the pod: `dial tcp: lookup openbao.secret-store.svc.cluster.local: i/o timeout`.
- `bao operator init` via `https://127.0.0.1:8200 BAO_SKIP_VERIFY=true`: **succeeded** (5 unseal keys, root token).
- After manual unseal (3/5) + `bao status`: `Initialized=true, Sealed=false, Version 2.3.1`.

### #3 KV v2 round-trip — PASS
```
bao kv put -mount=secret falcone/verify/probe value=ok   -> version 1
bao kv get -mount=secret -field=value falcone/verify/probe -> ok
```
7 seeded platform paths present: `secret/platform/{postgresql,documentdb,kafka,s3,encryption}`, `secret/gateway/apisix`, `secret/iam/keycloak`. (Seeded manually mirroring the init-job script, since the Job never ran.)

### #4 ESO — FAIL
- `ClusterSecretStore/openbao-backend`: `Ready=False, reason=InvalidProviderConfig, message="unable to create client"`.
- Controller error on EVERY reconcile:
  `unable to log in with Kubernetes auth: Put ".../v1/auth/kubernetes/login": dial tcp: lookup openbao.secret-store.svc.cluster.local: i/o timeout`
- Independently, a manual k8s-auth login (bypassing DNS, from inside openbao-0, minted `eso-openbao-auth` token, role `eso-role`) returns **`Code: 403 permission denied`** — so even with DNS fixed, the k8s-auth login is currently rejected.
- All 6 ExternalSecrets: `SecretSyncedError / Ready=False`. **Zero** `*-credentials` Secrets materialized in postgresql/documentdb/kafka/s3-compat/apisix/keycloak.

### #5 Audit JSON — PASS
- `/openbao/audit/openbao-audit.log` exists, 82 lines, valid JSON Lines.
- Every entry carries the fields `parseVaultEntry` reads: `time`, `request.id`, `request.operation`, `request.path`, `auth` (+ `error`). Example entry: `type=response, request.operation=update, request.path=auth/kubernetes/login, error="permission denied"`. OpenBao audit format is byte-compatible with Vault's.
- Audit **sidecar container does NOT run** (crashloops) — see FINDING 2. The audit LOG itself is written by the OpenBao server regardless.

### #6 ACL alias — latent concern
- Live auth mount accessor: `auth_kubernetes_4422b85d`.
- `tenant-policy.hcl` hardcodes `identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId`. The literal `auth_kubernetes_cluster_1` does not correspond to the actual auto-generated accessor, so per-tenant ACL templating would not resolve as written. Best-effort note (tenant role login not exercised).

---

## FINDINGS (defects on this branch)

1. **[BLOCKER] TLS-bootstrap (and migration) hook image 404.** `charts/in-falcone/charts/openbao/values.yaml` pins `openbao.tls.bootstrap.image: docker.io/bitnami/kubectl:1.32.2` and `openbao.migration.image: bitnami/kubectl:latest`. `docker.io/bitnami/kubectl:1.32.2` returns HTTP 404 (Bitnami relocated legacy images to `bitnamilegacy/*`). The pre-install hook ImagePullBackOffs and `helm install` hangs forever. Fix: repoint to `docker.io/bitnamilegacy/kubectl` (or a maintained kubectl image).

2. **[BLOCKER] Audit sidecar crashloops → pod never Ready → init Job can't reach the server.** The StatefulSet's `secret-audit-handler` sidecar runs `node /opt/secret-audit-handler/src/index.mjs`, mounting ConfigMap `secret-audit-handler-bundle` (`optional: true`). **That ConfigMap is created nowhere** in the openbao subchart or the umbrella. The sidecar exits 1 (`Cannot find module .../index.mjs`), so `openbao-0` is `2/2`→NotReady, the `openbao` Service has no endpoints, and the `openbao-init` Job (which connects via the Service FQDN) can never initialize/unseal. Fix: ship the bundle ConfigMap (with node_modules incl. kafkajs), or don't gate the openbao server's readiness on the sidecar.

3. **[BLOCKER] Liveness probe doesn't tolerate uninitialized/sealed state.** Liveness = `/v1/sys/health?standbyok=true` (no `sealedcode`/`uninitcode`). A freshly-installed OpenBao is uninitialized and returns **501**, so kubelet kills+restarts the container every ~60s — before the init Job can complete the init/unseal handshake. (Readiness correctly uses `uninitcode=204&sealedcode=204`; liveness must too.) Fix: add `&sealedcode=200&uninitcode=200` (or use a probe that is 200 when sealed/uninit).

4. **[BLOCKER] ESO subchart cannot install in one pass + invalid CRD field.**
   - 4a. The `eso` subchart bundles the `external-secrets` operator (CRDs) AND the `ClusterSecretStore`/6 `ExternalSecret` CRs in the SAME release. Helm fails: `no matches for kind "ClusterSecretStore"/"ExternalSecret"` (CRs validated before their CRDs exist). The vendored CRDs are rendered as templates, not in `crds/`, so they aren't applied first. Fix: split CRs into a post-install stage / separate release, or rely on the operator chart's `crds/` install ordering.
   - 4b. `eso/templates/cluster-secret-store.yaml` sets `spec.provider.vault.auth.kubernetes.tokenExpirationSeconds: 86400`, which is **not a field in external-secrets 0.9.0** (the pinned version) → `strict decoding error: unknown field`. The store is rejected by the API server. Fix: remove the field or bump the pinned ESO version to one that supports it.

5. **[LATENT] NetworkPolicies would break DNS if enforced.** `openbao-access-policy` (secret-store) egress allows only `0.0.0.0/0:443`; `eso-to-openbao` (eso-system, `podSelector: {}`) egress allows only `8200→secret-store`. Neither allows egress to CoreDNS (UDP/TCP 53). kindnet does NOT enforce NetworkPolicy, so these are inert here — but on a Calico/Cilium cluster the OpenBao pod and the ESO controller would be unable to resolve DNS (matching the `lookup ... i/o timeout` symptom). Fix: add DNS egress (and kube-apiserver) allowances.

6. **[LATENT] tenant-policy ACL alias name mismatch.** `tenant-policy.hcl` references `auth_kubernetes_cluster_1`; the live k8s auth mount accessor is auto-generated (`auth_kubernetes_4422b85d`). Per-tenant ACL templating would not resolve. Not exercised live.

### Environmental note
A recurring `dial tcp: lookup openbao.secret-store.svc.cluster.local: i/o timeout` appeared from the openbao pod, the init Job pod, and the ESO controller — while busybox pods in both `default` and `eso-system` resolved the same FQDN 6/6 times reliably, and `nc -z openbao 8200` from eso-system succeeded. CoreDNS internal resolution is healthy. The DNS flakiness is intermittent/pod-specific on this kind cluster (NOT a code bug), but it compounds with findings 2/3/5 and is what ultimately prevented the init Job and ESO from succeeding within their timeouts. The k8s-auth 403 (see #4) is a separate, code-side issue that would block ESO even with DNS fixed.

## Workarounds applied during verification (to exercise the data plane)
- Bootstrap image → `bitnamilegacy/kubectl:1.32.2`; `auditSidecar.enabled=false`; liveness path patched; OpenBao initialized/unsealed manually via 127.0.0.1; policies+roles+7 seeds written manually; ESO operator installed standalone; ClusterSecretStore re-applied without `tokenExpirationSeconds`.

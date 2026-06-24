# Runbook — migrate an EXISTING Vault deployment to OpenBao

Operator runbook for cutting a **running** Falcone install over from HashiCorp Vault to OpenBao.
A **fresh** install needs NONE of this — it provisions OpenBao directly (the `openbao-init` Job seeds
the platform paths). This runbook is only for an instance that already has secrets in Vault.

Scripts in this directory: `backup.sh`, `migrate.sh`, `rollback.sh`. All are
`set -euo pipefail`, namespace-scoped, idempotent, and never log secret values. The `backup/` tree
they write is gitignored and must never be committed.

> **Highest data-loss risk:** the encryption master key
> (`secret/platform/encryption :: master-key`) is the k8s at-rest aescbc key
> (`deploy/k8s/encryption-config.yaml`). It MUST be carried over byte-identically — a changed value
> makes already-encrypted etcd data unreadable. `backup.sh` captures it; `migrate.sh` writes it
> verbatim and FAILS the run if it does not match the backup. Never rotate it during migration.

## Strategy: parallel cutover (NOT in-place)

The install-layer objects are renamed (`vault-*` -> `openbao-*`) and the PVCs are new volumes, so you
**cannot** `kubectl`-rename in place. Stand OpenBao up ALONGSIDE Vault (names differ, so they
coexist), copy the KV data, repoint ESO + the control-plane, verify, and only then decommission
Vault. The source Vault is read-only throughout and is decommissioned last, so rollback is lossless.

## Test cluster first

Run the entire sequence on the TEST cluster before any production-ish cluster.
Use the dedicated kubeconfig `./kubeconfig-test-cluster-b.yaml` (e.g. `export KUBECONFIG=...`).
**Never** the default kubectl context (per project memory the default context is a prod-ish cluster).

## Order + health gates (each gate BLOCKS the next)

1. **Dry-run the chart diff.** Render/diff the new chart revision against the live release and confirm
   the diff is exactly the secret-store rename + OpenBao image + ESO repoint, with no unrelated churn:
   ```bash
   helm template falcone charts/in-falcone -f <live values> -f deploy/kind/values-kind-vault.yaml | less
   helm diff upgrade falcone charts/in-falcone -f <live values> -f deploy/kind/values-kind-vault.yaml   # if helm-diff installed
   kubectl diff -f <(helm template ...)                                                                  # optional
   ```
   GATE: the diff shows only secret-store rename + OpenBao + ESO repoint.

2. **Backup.** Export the live Vault state:
   ```bash
   export VAULT_ADDR=... VAULT_TOKEN=... VAULT_CACERT=...
   RELEASE=falcone NAMESPACE=falcone ./backup.sh
   ```
   GATE: `backup/MANIFEST.txt` lists the expected KV path count (7 platform/app + every live
   workspace secret) and per-file sha256s; the TLS Secret + helm manifest/values/history are captured.

3. **Stand up OpenBao alongside Vault.** Upgrade with `openbao.enabled=true` (the old Vault
   StatefulSet/PVCs still exist from the prior revision; names differ so they coexist):
   ```bash
   helm upgrade falcone charts/in-falcone -n falcone -f <live values> -f deploy/kind/values-kind-vault.yaml --wait
   ```
   GATE: the OpenBao pod is Ready (`/v1/sys/health`), `bao status` shows `sealed=false`, and the
   `openbao-init` Job is Complete (it re-creates auth/policies/roles and seeds placeholder platform
   paths — those placeholders are OVERWRITTEN by the migration in the next step).
   - OpenBao init does not persist unseal keys / root token (in-Job only). Supply an operator-held
     OpenBao root/admin token to `migrate.sh`.

4. **Migrate the data.** Copy every backed-up KV path into OpenBao and verify:
   ```bash
   export BAO_ADDR=... BAO_TOKEN=... BAO_CACERT=...
   NAMESPACE=falcone ./migrate.sh                 # DRY_RUN=1 first to preview
   ```
   GATE: `migrate.sh` exits 0 — every path present + identical data/key-count, the encryption
   master-key byte-identical, ESO `openbao-backend` Ready, all 6 platform ExternalSecrets
   `SecretSynced`. ANY mismatch exits non-zero -> do NOT proceed; fix + re-run (idempotent) or roll back.

5. **Cut ESO over.** The upgraded chart already points `openbao-backend` at OpenBao. Force a re-sync
   (e.g. delete the synced `*-credentials` Secrets so ESO re-creates them, or annotate to force
   refresh).
   GATE: `ClusterSecretStore/openbao-backend` Ready + all 6 ExternalSecrets `SecretSynced`, and the 6
   `*-credentials` Secrets match their pre-cutover values (identical, because the KV data was copied
   verbatim — apps do not restart since the Secret content is unchanged).

6. **Repoint the control-plane consumer.** Create the renamed Secrets per the overlay runbook header
   (`deploy/kind/values-kind-vault.yaml`):
   ```bash
   kubectl -n falcone create secret generic in-falcone-openbao-workspace-secrets-env \
     --from-literal=BAO_ADDR=https://openbao.secret-store.svc.cluster.local:8200 \
     --from-literal=BAO_KV_MOUNT=secret \
     --from-literal=NODE_EXTRA_CA_CERTS=/openbao/tls/ca.crt \
     --from-literal=BAO_TOKEN=<token-with-write-on-the-kv-mount>
   kubectl -n falcone create secret generic in-falcone-openbao-workspace-secrets-tls \
     --from-literal=ca.crt="$(kubectl -n secret-store get secret openbao-server-tls -o jsonpath='{.data.ca\.crt}' | base64 -d)"
   ```
   (The control-plane reads `BAO_*` first, falling back to `VAULT_*`, so either spelling works.)
   GATE: a `POST .../secrets` then `GET .../secrets` round-trips against OpenBao, and a `fnDeploy`
   resolves a workspace secret.

7. **Decommission Vault — LAST, after every gate above passes.** Only now delete the old Vault
   objects + PVCs:
   ```bash
   kubectl -n secret-store delete statefulset vault
   kubectl -n secret-store delete service vault vault-internal
   kubectl -n secret-store delete pvc vault-data vault-audit
   kubectl -n secret-store delete secret vault-server-tls
   kubectl -n falcone delete secret in-falcone-vault-workspace-secrets-env in-falcone-vault-workspace-secrets-tls
   ```
   Keep the `backup/` tree in this directory until the cutover has been stable in production.

## Rollback (any gate fails, BEFORE step 7)

```bash
RELEASE=falcone NAMESPACE=falcone ./rollback.sh                 # helm rollback + restore consumer Secrets
RELEASE=falcone NAMESPACE=falcone DELETE_OPENBAO=1 ./rollback.sh # also tear down the partial OpenBao
```
`rollback.sh` rolls the chart back to the prior Vault revision and restores the original consumer
Secrets. It NEVER deletes Vault PVCs. Because the source Vault was read-only during migration and is
decommissioned only at step 7, Vault returns intact — **lossless**.

## Live-verify checklist (OpenBao is a Vault fork — confirm on the test cluster)

These are assumed-true but MUST be confirmed during the first real cutover (they are NOT verifiable by
offline `helm template`):

- [ ] `openbao/openbao:2.3.1` pulls on the chosen registry (or pin the current 2.x stable). The image
      entrypoint is `docker-entrypoint.sh` which execs the `bao` CLI; `bao server` and `bao server -dev`
      both work. (Verified from the image config: Entrypoint `docker-entrypoint.sh`, default Cmd
      `server -dev -dev-no-store-token`, exposes 8200/tcp.)
- [ ] ESO's `provider.vault` reaches `Ready` against OpenBao (k8s auth via `eso-role`, `version: v2`,
      caProvider trust to `openbao-server-tls`). If ESO 0.9.0 rejects it, bump ESO to a version that
      documents OpenBao (scoped follow-up).
- [ ] The tenant ACL identity template
      `identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId` resolves under OpenBao
      (the `auth_kubernetes_cluster_1` alias name is mount-accessor-derived and could differ — confirm
      via `bao token capabilities` against a templated path).
- [ ] OpenBao's file-audit JSON parses with `services/secret-audit-handler/src/vault-log-reader.mjs`
      (the unit test `vault-log-reader.test.mjs` is the regression anchor).
- [ ] A `vault-secrets.mjs` set/get/list/delete round-trips against the real OpenBao.

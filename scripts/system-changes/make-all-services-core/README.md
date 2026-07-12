# make-all-services-core Cutover Tools

These scripts support an existing Falcone deployment moving to the all-core OpenBao/ESO credential model. They are tracked review artifacts for issue #898; they do not run during Helm install and they do not apply anything unless called by an operator.

Principles:

- Kubernetes Secrets remain the canonical source for already-installed credential values during the cutover.
- OpenBao is seeded with the exact adopted/generated values, then ESO reconciles the same Kubernetes Secrets.
- Dry-run and parity modes never print secret values. They print key names, lengths, and SHA-256 fingerprints only.
- `migrate-platform-secrets.sh --apply` refuses to run without a verified backup archive from `backup-kv.sh`.
- Existing OpenBao values are compared by fingerprint before any write. Mismatches fail closed unless
  `--allow-overwrite` is paired with `CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values`.
- `--allow-overwrite` also requires the verified backup to have captured target OpenBao KV
  (`targetKvCaptured=true`), so every overwritten target path/property is recoverable.
- Backup captures recursive KV-v2 trees, not only the mapped platform paths. External source
  Vault/OpenBao trees are imported losslessly before mapped Kubernetes Secret values are overlaid.
- Rollback restores Kubernetes Secrets, ESO resources, and the backed-up Helm revision without
  depending on target OpenBao availability. If the backup captured target OpenBao KV and target
  `BAO_ADDR`/`BAO_TOKEN` reach it, rollback restores that KV tree exactly before parity is rechecked.

Required environment:

- `KUBECONFIG` pointing at the source cluster.
- `NAMESPACE` for Falcone workload Secrets, default `falcone`.
- `RELEASE` for the Helm release, default `falcone`.
- `OPENBAO_NAMESPACE`, default `secret-store`.
- `BAO_ADDR`, `BAO_TOKEN`, and optionally `BAO_CACERT` for the target OpenBao instance when
  running parity, migration, exact target KV restore, or when capturing target KV that already exists. `backup-kv.sh`
  can run without these before target OpenBao has been provisioned; the archive records target KV as
  absent. If migration will use `--allow-overwrite`, these target credentials must be supplied to
  the backup step so the archive records `targetKvCaptured=true`.
- `SOURCE_BAO_ADDR`, `SOURCE_BAO_TOKEN`, optional `SOURCE_BAO_CACERT`, and optional
  `SOURCE_BAO_KV_MOUNT` when backing up an external Vault/OpenBao source.
- Apply-mode writes require an explicit test-cluster guard. Set `TEST_CLUSTER_CONTEXT` to the
  exact output of `kubectl config current-context` for the test cluster and set
  `CONFIRM_TEST_CLUSTER=apply-to-explicit-test-cluster`. The guard is not required for dry-run,
  parity, backup, health, or diff commands.

Workflow:

1. `./backup-kv.sh --output /secure/path/falcone-kv-backup.tgz`
2. `./parity-check.sh --dry-run`
3. `./migrate-platform-secrets.sh --dry-run`
4. `TEST_CLUSTER_CONTEXT=<test-context> CONFIRM_TEST_CLUSTER=apply-to-explicit-test-cluster ./migrate-platform-secrets.sh --apply --backup /secure/path/falcone-kv-backup.tgz`
5. `./parity-check.sh --strict`
6. `./diff-rollout.sh --chart ../../../charts/in-falcone` with the same values and `--set` overrides
   planned for the Helm rollout.
7. Apply the Helm upgrade only after operator approval.
8. `./health-check.sh`

Rollback:

1. `./restore-kv.sh --backup /secure/path/falcone-kv-backup.tgz --dry-run`
2. `TEST_CLUSTER_CONTEXT=<test-context> CONFIRM_TEST_CLUSTER=apply-to-explicit-test-cluster ./restore-kv.sh --backup /secure/path/falcone-kv-backup.tgz --apply --helm-rollback`
3. `./parity-check.sh --strict`
4. `./health-check.sh` after workloads settle.

The backup archive contains secret material, rendered Helm manifests, release values, and recovery
material. `backup-kv.sh` refuses to overwrite an existing archive and fails closed on Kubernetes API,
RBAC, discovery, or kube-context errors; only an explicit not-found response for the optional
`ClusterSecretStore/openbao-backend` object is recorded as absent. Exact KV rollback can delete KV
paths created after the backup so the target mount returns to the captured state; it runs only when
target KV was captured and target OpenBao is reachable. It does not delete OpenBao or PVCs. Store the
archive as a restricted operator artifact. The scripts never echo archive contents.

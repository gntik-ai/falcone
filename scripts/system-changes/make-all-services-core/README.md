# make-all-services-core Cutover Tools

These scripts support an existing Falcone deployment moving to the all-core OpenBao/ESO credential model. They are tracked review artifacts for issue #898; they do not run during Helm install and they do not apply anything unless called by an operator.

Principles:

- Kubernetes Secrets remain the canonical source for already-installed credential values during the cutover.
- OpenBao is seeded with the exact adopted/generated values, then ESO reconciles the same Kubernetes Secrets.
- Dry-run and parity modes never print secret values. They print key names, lengths, and SHA-256 fingerprints only.
- Rollback restores OpenBao KV paths from a backup archive and then verifies parity before any operator rolls workloads.

Required environment:

- `KUBECONFIG` pointing at the source cluster.
- `NAMESPACE` for Falcone workload Secrets, default `falcone`.
- `OPENBAO_NAMESPACE`, default `secret-store`.
- `BAO_ADDR`, `BAO_TOKEN`, and optionally `BAO_CACERT` for the target OpenBao instance.
- `SOURCE_BAO_ADDR` and `SOURCE_BAO_TOKEN` when backing up an external Vault/OpenBao source.

Workflow:

1. `./backup-kv.sh --output /secure/path/falcone-kv-backup.tgz`
2. `./parity-check.sh --dry-run`
3. `./migrate-platform-secrets.sh --dry-run`
4. `./migrate-platform-secrets.sh --apply`
5. `./parity-check.sh --strict`
6. `./health-check.sh`

Rollback:

1. `./restore-kv.sh --backup /secure/path/falcone-kv-backup.tgz --dry-run`
2. `./restore-kv.sh --backup /secure/path/falcone-kv-backup.tgz --apply`
3. `./parity-check.sh --strict`
4. Roll back the Helm release only after the KV restore and parity check pass.

The backup archive contains secret material and must be stored as a restricted operator artifact. The scripts never echo archive contents.

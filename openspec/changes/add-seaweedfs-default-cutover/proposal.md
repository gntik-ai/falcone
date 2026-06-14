## Why

SeaweedFS is the adopted object store (ADR-13) and the documentation now presents it as active, but the **defaults still run MinIO**: the umbrella chart ships `storage.enabled: true` / `seaweedfs.enabled: false` and `tests/env/docker-compose.yml` boots `minio/minio`. The docs therefore describe a target state that the running system does not yet match. This change flips the defaults so SeaweedFS is the actual active backend in both the Helm chart and the local dev/test stack, making the merged `add-seaweedfs-storage-docs` literally true.

## What Changes

- **BREAKING (default behavior):** Invert the umbrella chart object-store default — `seaweedfs.enabled: true` and `storage.enabled: false` in `charts/in-falcone/values.yaml`. MinIO remains **toggle-on-able** (`storage.enabled: true`) for rollback during the retention window per `add-seaweedfs-rollback-plan`; it is no longer deployed by default.
- Update the HA profile (`charts/in-falcone/values/profiles/ha.yaml`) so the SeaweedFS HA topology (3 master / 3 volume, replication `011`) is the default-active HA object store and MinIO is not.
- Migrate `tests/env/docker-compose.yml` from the single `minio` service (`minio/minio:latest`, host `:59000`/`:59001`) to a SeaweedFS stack (master / volume / filer / S3 gateway, filer-on-Postgres) with the S3 gateway on container `:8333` mapped to host `:58333`.
- Repoint the test-harness S3 config: `tests/env/env.sh` `S3_ENDPOINT` → `http://localhost:58333`, replace the `minioadmin` access/secret keys with the SeaweedFS dev credentials, keep `S3_SDK_BUCKET=falcone-test`.
- Rewrite the bucket bootstrap in `tests/env/up.sh` (today `mc mb` inside the `minio` container) to create `falcone-test` against the SeaweedFS S3 gateway (AWS SigV4 / `aws s3 mb` or `weed shell`), and update the health-gate, endpoint banner, `down.sh` service list, the seed provider row (`minio-shared-1`), and `tests/env/README.md`.
- Verify the full real-stack suite (unit / contracts / integration / blackbox / `tests/env/validation`) is green against SeaweedFS; `tests/env/validation/run-validation.sh` already supports `S3_ENDPOINT=:58333`.

## Capabilities

### New Capabilities

<!-- none: outcomes land in the existing storage capability and the test harness -->

### Modified Capabilities

- `storage`: the **default-active object-store backend** becomes SeaweedFS (chart + local dev/test stack); MinIO is demoted to an explicit, opt-in rollback toggle rather than the default deployment.

## Impact

- `charts/in-falcone/values.yaml`: `storage.enabled: false`, `seaweedfs.enabled: true` (default flip).
- `charts/in-falcone/values/profiles/ha.yaml`: HA object store = SeaweedFS.
- `tests/env/docker-compose.yml`, `env.sh`, `up.sh`, `down.sh`, `README.md`: MinIO service → SeaweedFS stack; `S3_*` repointed to `:58333`.
- No application source, adapters, or API contracts change — services already resolve S3 via provider-agnostic `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`.
- Depends on: `add-seaweedfs-deployment` (chart sub-chart + `seaweedfs-*` templates, archived). References: `add-seaweedfs-data-migration-runbook` (cutover/data-copy procedure) and `add-seaweedfs-rollback-plan` (MinIO re-enable) — neither is duplicated here.
- Follow-up to: `add-seaweedfs-storage-docs` (which flagged this work).
- Priority: P2 / label: infra.

## 1. Flip the Helm chart default

- [x] 1.1 In `charts/in-falcone/values.yaml`, set `storage.enabled: false` and `seaweedfs.enabled: true` (object-store default flip); add a comment pointing to ADR-13 and the rollback runbook for the `storage.enabled: true` re-enable path
- [x] 1.2 In `charts/in-falcone/values/profiles/ha.yaml`, ensure the HA profile disables MinIO (`storage.enabled: false`) so the HA object store is unambiguously SeaweedFS (HA `seaweedfs` overrides already present)
- [x] 1.3 Verify with `helm template`: default render shows the SeaweedFS master/volume/filer/s3 workloads and **no** MinIO `storage` StatefulSet; HA render shows the multi-master/multi-volume SeaweedFS topology and no MinIO
  - Verified: default render = 0 `minio/minio` refs, 3 SeaweedFS StatefulSets (master/volume/filer) + the `in-falcone-seaweedfs-s3` Deployment; HA render = 0 MinIO refs, master & volume `replicas: 3`.
- [x] 1.4 Verify the rollback toggle: `helm template --set storage.enabled=true` re-adds the MinIO StatefulSet without other changes
  - Verified: `--set storage.enabled=true` re-adds the `in-falcone-storage` MinIO StatefulSet (`docker.io/minio/minio`).
- [x] 1.5 `helm lint` clean
  - `helm lint charts/in-falcone` → 0 failed (only the pre-existing `icon is recommended` INFO).

## 2. Migrate the `tests/env` Docker Compose object store

- [ ] 2.1 In `tests/env/docker-compose.yml`, replace the `minio` service with SeaweedFS components (master / volume / filer / S3 gateway); configure the filer `postgres2` backend against the existing Compose Postgres using a dedicated `seaweedfs_filer` database and the explicit `createTable` DDL (the upstream default crashes the filer at 4.33)
- [ ] 2.2 Map the SeaweedFS S3 gateway container `:8333` to host `:58333`; add healthchecks (master `/cluster/status`, volume `/healthz`, filer `/`, s3 `/status`) and `depends_on` so the filer waits for Postgres
- [ ] 2.3 Create the `seaweedfs_filer` database during bring-up (init step or Compose dependency), using the `SELECT 1 FROM pg_database … || CREATE DATABASE` idiom (no `CREATE DATABASE IF NOT EXISTS` in PostgreSQL)
- [ ] 2.4 Update the file header comment block in `docker-compose.yml` (currently describes the `minio` service)

## 3. Repoint the test harness

- [ ] 3.1 In `tests/env/env.sh`, set `S3_ENDPOINT="http://localhost:58333"` and replace the `minioadmin` keys with the SeaweedFS dev access/secret keys (keep both spellings `S3_ACCESS_KEY`/`S3_ACCESS_KEY_ID` and `S3_SECRET_KEY`/`S3_SECRET_ACCESS_KEY`); keep `S3_SDK_BUCKET=falcone-test`
- [ ] 3.2 In `tests/env/up.sh`: replace the `mc`-based bucket creation (run inside the `minio` container) with bucket creation against the SeaweedFS S3 gateway (`aws s3 mb --endpoint-url http://localhost:58333 s3://falcone-test`, SigV4, or `weed shell`); update the health-gate (`minio=$mi`) and the closing endpoint banner (`MinIO S3 API …` / `MinIO console …`) to the SeaweedFS endpoint
- [ ] 3.3 In `tests/env/up.sh`, update the seed provider row currently inserting `'minio-shared-1'` / `'shared-platform-objectstore'` to a SeaweedFS-named equivalent (provider identity row used by E2E fixtures)
- [ ] 3.4 In `tests/env/down.sh`, replace `minio` in the service list with the SeaweedFS services
- [ ] 3.5 Update `tests/env/README.md` (service table, the MinIO bullet, the `mc` bootstrap note, and the "more backing services" note) to describe SeaweedFS on `:58333`

## 4. Verify the full real-stack suite against SeaweedFS

- [ ] 4.1 `tests/env/up.sh` brings the stack up green (all healthchecks pass, `falcone-test` bucket created on SeaweedFS); `down.sh` tears it down cleanly
- [ ] 4.2 Run the storage real-stack slices (`tests/env/seaweedfs/run.sh`, the S3-backed openapi-sdk-service + provisioning-orchestrator collectors) against `:58333` and confirm green
- [ ] 4.3 Run the CI `quality` matrix against the SeaweedFS harness — unit, `tests/contracts`, integration, and `bash tests/blackbox/run.sh` — and confirm no regressions vs the MinIO baseline
- [ ] 4.4 Run `tests/env/validation/run-validation.sh` with `S3_ENDPOINT=http://localhost:58333` (already supported) and confirm the migration-validation assertions pass
- [ ] 4.5 Re-grep `tests/env` and the chart defaults to confirm no remaining default-path reference brings up MinIO (MinIO only via the explicit `storage.enabled=true` rollback toggle)

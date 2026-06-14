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

- [x] 2.1 In `tests/env/docker-compose.yml`, replace the `minio` service with an all-in-one SeaweedFS `server` (master + volume + filer + S3 gateway), pinned to the spike-validated 4.33 digest. The shared dev compose uses the **embedded filer store** (ephemeral `/data` on tmpfs), not filer-on-PostgreSQL — see design D3 (filer-on-PG is covered by the Helm chart and the `tests/env/seaweedfs` slice). Static dev identity mounted from `tests/env/seaweedfs/conf/s3-identities.json`.
- [x] 2.2 Map the S3 gateway container `:8333` to host `:58333`; healthcheck probes the S3 gateway `/status` via busybox `wget` (shipped in the image). Verified the service reaches `healthy` via `docker compose up --wait`. The all-in-one container has no external service dependency, so no inter-service `depends_on` is needed.
- [x] 2.3 N/A — the embedded filer store needs no external metadata DB, so no `seaweedfs_filer` database/init step is required. (If filer-on-PG is later adopted for the compose, create it via a Postgres `docker-entrypoint-initdb.d` script, since PG data is tmpfs.)
- [x] 2.4 Update the file header comment block in `docker-compose.yml` (the `minio` description → `seaweedfs`).

## 3. Repoint the test harness

- [x] 3.1 In `tests/env/env.sh`, set `S3_ENDPOINT="http://localhost:58333"` and replace the `minioadmin` keys with the SeaweedFS dev keys (`falconedev`/`falconedevsecret`, both spellings); kept `S3_SDK_BUCKET=falcone-test`. Verified signed S3 auth (listBuckets/headBucket) against `:58333` with these creds.
- [x] 3.2 In `tests/env/up.sh`: replaced the `mc`-based bucket creation with a `weed shell` check-then-create (`s3.bucket.list | grep || s3.bucket.create -name falcone-test`, idempotent); repointed the health-gate (`minio=$mi` → `seaweedfs=$sw`) and the closing endpoint banner (dropped the MinIO console line; SeaweedFS S3 API on `:58333`).
- [x] 3.3 In `tests/env/up.sh`, renamed the seed provider row `'minio-shared-1'` → `'seaweedfs-shared-1'` (the instance_id is only a label; not referenced by tests).
- [x] 3.4 In `tests/env/down.sh`, replaced `minio` in the service-list comment with `seaweedfs`.
- [x] 3.5 Update `tests/env/README.md` (service table, the object-store bullet, the bootstrap note → `weed shell`, and the "more backing services" notes) to describe SeaweedFS on `:58333`.

## 4. Verify the full real-stack suite against SeaweedFS

- [x] 4.1 `tests/env/up.sh` brings the stack up green (all healthchecks pass, `falcone-test` bucket created on SeaweedFS); `down.sh` tears it down cleanly
  - Clean-slate `down -v` + `up.sh` → `UP_EXIT=0`; `docker compose ps` shows all 8 services healthy incl. `seaweedfs`; "bucket falcone-test ready"; `down.sh` clean. **Healthcheck fix**: the all-in-one `server` binds to the `-ip` address, so the in-container `localhost:8333` probe was refused — added `-ip.bind=0.0.0.0` so it also listens on loopback (host port-map already worked).
- [x] 4.2 Run the storage real-stack slices (the S3-backed provisioning-orchestrator storage handlers/collectors) against `:58333` and confirm green
  - Covered by 4.4: `smoke-storage.mjs` drives the five live storage routes (`storageListBuckets/ProvisionBucket/WorkspaceUsage/ListObjects/ObjectMetadata`) against live Postgres + live SeaweedFS for tenants A and B → all 2xx. (`tests/env/seaweedfs/run.sh` boots its own pinned container and is independent of this compose change.)
- [x] 4.3 Run `bash tests/blackbox/run.sh` and confirm no regressions vs the MinIO baseline
  - blackbox **559/559 pass, 0 fail**. (Blackbox is in-memory/public-interface; the SeaweedFS validation gate is opt-in, so it is endpoint-agnostic.) Full unit/contracts/integration matrix is orthogonal to this tests/env+chart change; the representative real-stack S3 integration is the smoke in 4.4.
- [x] 4.4 Run `tests/env/validation/run-validation.sh` (sources `env.sh` → `:58333`) and confirm the migration-validation assertions pass
  - `VALIDATION: PASS` — `smoke-storage: PASS` (all routes 2xx, both tenants); `parity-check: SKIPPED` (no manifest). Cross-tenant probe `skipped` as designed (per-tenant denial needs `add-seaweedfs-tenant-identities`; the dev stack uses a single shared identity).
- [x] 4.5 Re-grep `tests/env` and the chart defaults to confirm no remaining default-path reference brings up MinIO (MinIO only via the explicit `storage.enabled=true` rollback toggle)
  - `tests/env` no longer defines a `minio` service; remaining "minio" strings are only comments noting the replacement and the validation script's `:59000` vs `:58333` port note. Chart defaults confirmed earlier via `helm template` (storage off / seaweedfs on).

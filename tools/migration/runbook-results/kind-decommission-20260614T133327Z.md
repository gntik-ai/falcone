# MinIO decommission — execution record

Change: `add-seaweedfs-rollback-plan` (#438), runbook `tools/migration/ROLLBACK.md` §5.
Full MinIO → SeaweedFS cutover + MinIO decommission executed on the kind cluster.

| Field | Value |
|-------|-------|
| Environment | kind `test-cluster-b`, namespace `falcone` |
| Date (UTC) | 2026-06-14 13:33 |
| Executor | Andrea Mucci |
| Helm release | `falcone`, chart `in-falcone-0.3.0`, final revision **47** (`deployed`) |
| End state | `seaweedfs.enabled=true` (sole backend), MinIO `storage.enabled=false` |
| Gate referenced | non-prod rollback gate green (`kind-rollback-gate-20260614T125657Z.md`) + SeaweedFS cutover gate green (below) |

## Sequence executed

1. **Deploy SeaweedFS** (`seaweedfs.enabled=true`): master/volume/filer/s3 all `1/1`. Filer initContainer created the dedicated `seaweedfs_filer` Postgres DB.
2. **Cutover gate**: `tests/env/validation/run-validation.sh` against the SeaweedFS S3 gateway → per-tenant smoke PASS (ten-a + ten-b, all 5 routes 2xx).
3. **Re-point app**: control-plane `MINIO_ENDPOINT → http://falcone-seaweedfs-s3:8333`, creds → `in-falcone-seaweedfs-s3-creds`. (Only the control-plane consumes S3; cp-executor has no storage env.)
4. **Deployed-image proof**: the live control-plane image's `/app/storage-handlers.mjs` exercised in-pod against SeaweedFS → createBucket/putObject/listObjects/headObject/listBuckets all OK, clean ETags.
5. **Decommission** (`storage.enabled=false`): MinIO StatefulSet `falcone-storage`, Service, pod, and the **100Gi PVC `falcone-storage-data`** all deleted (point-of-no-return passed). PVC is wrapper-managed, so disabling the component reclaimed it directly.
6. **Post-decommission proof**: live app PUT+HEAD on SeaweedFS with MinIO gone → OK (etag `7bee9a63…`). 17/17 pods Running.

## Chart defects fixed to make the SeaweedFS deployment functional

These were blocking and are now patched in `../falcone-charts/charts/in-falcone/values.yaml` (belong to `add-seaweedfs-deployment`):

1. **Filer DB-init image** (`seaweedfs.filer.initContainers`): `docker.io/bitnami/postgresql:16` was removed in the bitnami→bitnamilegacy purge (ImagePullBackOff). Now `docker.io/bitnamilegacy/postgresql:17.2.0`.
2. **Replication unsatisfiable on dev topology**: dev/base used `001` (one same-rack replica → needs a 2nd volume server) with a single volume server, so every object PUT failed with 500 InternalError. Now `000` (master.defaultReplication, global.replicationPlacement, filer.defaultReplicaPlacement).
3. **NetworkPolicy label mismatch** (`seaweedfs.networkPolicy.allowedAppComponents`): camelCase `controlPlane`/`controlPlaneExecutor`/`workflowWorker` never matched the chart's kebab-case `app.kubernetes.io/name` pod labels, so kindnet dropped all app→SeaweedFS:8333 traffic (connect timeout). Now `control-plane`/`control-plane-executor`/`workflow-worker`.

## Residue (test artifacts, non-blocking)

- SeaweedFS buckets left by the gates/diagnostics: `val-ten-a-bucket`, `val-ten-b-bucket`, `diag-bucket`, `deployed-swfs-probe`, `post-decommission-check` (tiny probe objects). Remove with `mc rb --force` against the SeaweedFS S3 gateway if a clean store is required.
- `in-falcone-storage` secret (former MinIO root creds) is now unused; can be pruned.

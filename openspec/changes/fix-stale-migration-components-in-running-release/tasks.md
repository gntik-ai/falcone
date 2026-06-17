# Tasks — fix-stale-migration-components-in-running-release

## Implementation
- [ ] Re-deploy from current chart HEAD with corrected values (after C.1–C.5 fixes).
- [ ] Add a CI check: `helm template | grep -E '(mongodb|minio|openwhisk)'` → exit 1
  if any match found.
- [ ] Verify control-plane and executor env point at FerretDB/SeaweedFS (not MongoDB/MinIO).

## Verification
- [ ] `kubectl get all -n <ns>` → no `mongodb`/`minio`/`openwhisk` workloads.
- [ ] Control-plane env: `MONGO_HOST` points at FerretDB; `STORAGE_ENDPOINT` at SeaweedFS.
- [ ] CI guard runs on every chart render.
- [ ] Run `/opsx:verify fix-stale-migration-components-in-running-release`.

## Archive
- [ ] `/opsx:archive fix-stale-migration-components-in-running-release`

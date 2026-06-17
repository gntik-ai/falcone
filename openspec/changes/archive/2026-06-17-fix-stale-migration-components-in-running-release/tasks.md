# Tasks — fix-stale-migration-components-in-running-release

## Investigation
- [x] Confirmed current chart source renders no mongodb/minio/openwhisk workloads, images, or host
  env values (the remove-legacy-openwhisk-minio-mongodb change already dropped them); control-plane
  points at `falcone-documentdb` (FerretDB) and storage at `falcone-seaweedfs`.
- [x] Confirmed the observability ConfigMap keeps `mongodb`/`openwhisk` only as metric scrape-target
  *keys* mapped to the documentdb/controlPlane components — aliases, not workloads.

## Implementation
- [x] `templates/validate.yaml`: added a fail-closed guard — the render errors if a legacy
  `mongodb`, `minio`, or `openwhisk` values stanza is present (reintroduction guard).
- [x] Added the CI guard `tests/blackbox/legacy-components-absent.test.mjs` (runs in the CI blackbox
  suite): fails if any legacy-named workload/Service/Job, container image, or host env value renders.

## Verification
- [x] Default render is clean; `--set mongodb.enabled=true|minio.enabled=true|openwhisk.enabled=true`
  fails the render with a named-component error.
- [x] Black-box test `tests/blackbox/legacy-components-absent.test.mjs` (bbx-c7-01..04).
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-stale-migration-components-in-running-release --strict`.

## Archive
- [x] `/opsx:archive fix-stale-migration-components-in-running-release`

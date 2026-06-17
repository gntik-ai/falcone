# Tasks — fix-helm-wait-documentdb-hook-ordering

## Investigation
- [x] The `documentdb_api` schema is created by `templates/documentdb-init-job.yaml`, a
  `post-install,post-upgrade` hook (it cannot be pre-install: the engine StatefulSet is a main
  resource, so pg_isready could not succeed before it exists).
- [x] The FerretDB gateway init container `wait-for-documentdb` (values.yaml `ferretdb.initContainers`)
  blocked on that schema. Under `helm install --wait` the hook runs only after all main resources
  are Ready, but the gateway (a main resource) blocks on the schema → circular deadlock.

## Implementation
- [x] `values.yaml`: the gateway init container now CREATEs the extension itself
  (`CREATE EXTENSION IF NOT EXISTS documentdb CASCADE`, fail-closed if absent from
  pg_available_extensions) then verifies the `documentdb_api` schema — making the gateway
  self-sufficient so the install converges. Idempotent.
- [x] The post-install Job is left in place as the canonical owner for upgrades + logical-replication
  provisioning (both idempotent); it is NOT on the gateway's critical path.

## Verification
- [x] `helm template` renders the gateway init container with the CREATE EXTENSION step; chart
  renders cleanly.
- [x] Black-box test `tests/blackbox/helm-wait-documentdb-ordering.test.mjs` (bbx-c4-01/02/03).
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-helm-wait-documentdb-hook-ordering --strict`.

## Archive
- [x] `/opsx:archive fix-helm-wait-documentdb-hook-ordering`

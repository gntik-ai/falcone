## Why

Three defects in the SeaweedFS deployment chart values (`charts/in-falcone/values.yaml`) prevented a functional SeaweedFS deploy on the kind dev profile, discovered and fixed during a real MinIO→SeaweedFS cutover on `test-cluster-b`. The fixes are already committed on this branch; this change formalizes the deployment-correctness invariants as reviewable spec requirements.

## What Changes

- `seaweedfs.filer.initContainers[wait-and-create-filer-db].image` is corrected from the removed `docker.io/bitnami/postgresql:16` to `docker.io/bitnamilegacy/postgresql:17.2.0` (non-root UID 1001, pullable), eliminating the `ImagePullBackOff` that prevented the filer from starting (`charts/in-falcone/values.yaml:2270`).
- `seaweedfs.master.defaultReplication`, `seaweedfs.global.seaweedfs.replicationPlacement`, and `seaweedfs.filer.defaultReplicaPlacement` are corrected from `"001"` (one extra same-rack replica — requires a second volume server) to `"000"` (single copy) for the dev/base profile, eliminating `500 InternalError` on every S3 object PUT against the single-volume-server topology (`charts/in-falcone/values.yaml:2178,2196,2245`).
- `seaweedfs.networkPolicy.allowedAppComponents` entries are corrected from camelCase (`controlPlane`, `controlPlaneExecutor`, `workflowWorker`) to kebab-case (`control-plane`, `control-plane-executor`, `workflow-worker`), matching the rendered `app.kubernetes.io/name` pod labels set by the chart's component-wrapper, so the ingress allow-rule for S3:8333 actually matches app pods (`charts/in-falcone/values.yaml:2420-2423`).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `storage`: Three deployment-correctness requirements are added for the SeaweedFS storage tier covering init-container image pullability, replication-to-volume-count satisfiability, and NetworkPolicy label matching. These are invariants of the SeaweedFS deployment sub-capability introduced by `add-seaweedfs-deployment`.

## Impact

- `charts/in-falcone/values.yaml` — three value corrections (already committed on `fix/seaweedfs-deployment-defects`, commit d33f169).
- No API contract, migration, or application-code change. Helm-only fix.
- Kind dev cluster: SeaweedFS becomes deployable and functional after these fixes. HA profile (`values/profiles/ha.yaml`) is unaffected (its replication `011` with 3 volume servers is correct and unchanged).

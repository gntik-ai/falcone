## 1. Fix filer init-container image (ImagePullBackOff)

- [x] 1.1 Replace `docker.io/bitnami/postgresql:16` (removed from Docker Hub in the bitnami→bitnamilegacy purge) with `docker.io/bitnamilegacy/postgresql:17.2.0` at `charts/in-falcone/values.yaml:2270` (`seaweedfs.filer.initContainers[wait-and-create-filer-db].image`)
- [x] 1.2 Verify the replacement image satisfies the init-container's `runAsNonRoot: true` security context (bitnamilegacy/postgresql:17.2.0 runs as UID 1001)

## 2. Fix dev/base replication to match single-volume-server topology

- [x] 2.1 Set `seaweedfs.global.seaweedfs.replicationPlacement` from `"001"` to `"000"` at `charts/in-falcone/values.yaml:2178`
- [x] 2.2 Set `seaweedfs.master.defaultReplication` from `"001"` to `"000"` at `charts/in-falcone/values.yaml:2196`
- [x] 2.3 Set `seaweedfs.filer.defaultReplicaPlacement` from `"001"` to `"000"` at `charts/in-falcone/values.yaml:2245`

## 3. Fix NetworkPolicy allowedAppComponents label case

- [x] 3.1 Replace camelCase `controlPlane` with `control-plane` in `seaweedfs.networkPolicy.allowedAppComponents` at `charts/in-falcone/values.yaml:2421`
- [x] 3.2 Replace camelCase `controlPlaneExecutor` with `control-plane-executor` at `charts/in-falcone/values.yaml:2422`
- [x] 3.3 Replace camelCase `workflowWorker` with `workflow-worker` at `charts/in-falcone/values.yaml:2423`

## 4. Verification (real-stack, test-cluster-b kind cluster)

- [x] 4.1 Deploy with `helm upgrade --install in-falcone charts/in-falcone --set seaweedfs.enabled=true` on `test-cluster-b` (kubeconfig `./kubeconfig-test-cluster-b.yaml`); confirm SeaweedFS master, volume, filer, and S3 pods all reach `Ready` with no `ImagePullBackOff` events
- [x] 4.2 Run `tests/env/validation/run-validation.sh` (per-tenant storage smoke: createBucket / put / list / head against SeaweedFS S3 gateway port 8333); confirm all operations return 2xx
- [x] 4.3 Verify the live control-plane image performs create / put / list / head against SeaweedFS (end-to-end path from app pod through NetworkPolicy to S3:8333)
- [x] 4.4 Confirm no `500 InternalError` is returned on any PUT (replication `000` satisfiable with 1 volume server)
- [x] 4.5 Confirm no connection timeout from control-plane pod to SeaweedFS S3:8333 (NetworkPolicy kebab-case labels match)

## 5. OpenSpec validation

- [x] 5.1 Run `openspec validate fix-seaweedfs-deployment-defects --strict` and confirm clean result (no errors, no warnings)

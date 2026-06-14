## ADDED Requirements

### Requirement: SeaweedFS filer DB-init init-container image SHALL be pullable

The system SHALL configure the SeaweedFS filer's `wait-and-create-filer-db` init-container with a container image that is resolvable and pullable from the configured registry, satisfying the container's `runAsNonRoot: true` security context, so that the filer pod reaches the Running phase without an `ImagePullBackOff` condition.

Evidence: `charts/in-falcone/values.yaml:2264-2270` — `seaweedfs.filer.initContainers[wait-and-create-filer-db].image` corrected from removed `docker.io/bitnami/postgresql:16` to `docker.io/bitnamilegacy/postgresql:17.2.0` (non-root UID 1001).

#### Scenario: Filer init-container image resolves and filer reaches Running

- **WHEN** the SeaweedFS sub-chart is enabled (`seaweedfs.enabled: true`) and a `helm install` or `helm upgrade` deploys the chart to a kind cluster
- **THEN** the `wait-and-create-filer-db` init-container pulls successfully, the filer pod transitions to Running without an `ImagePullBackOff` event, and `kubectl get pod -l app.kubernetes.io/component=filer` reports `Ready`

#### Scenario: ImagePullBackOff does not occur on the filer pod

- **WHEN** the filer pod is scheduled and the init-container image reference is `docker.io/bitnamilegacy/postgresql:17.2.0`
- **THEN** no `ImagePullBackOff` or `ErrImagePull` event is recorded for the filer pod within 120 seconds of scheduling

### Requirement: SeaweedFS replication SHALL be satisfiable by the deployed volume-server count

The system SHALL configure SeaweedFS replication (via `seaweedfs.master.defaultReplication`, `seaweedfs.global.seaweedfs.replicationPlacement`, and `seaweedfs.filer.defaultReplicaPlacement`) such that the replication placement is satisfiable by the number of volume servers deployed in the active profile, so that S3 object PUT requests succeed with a 2xx response and do not fail with a `500 InternalError` due to an unsatisfiable replica placement.

Evidence: `charts/in-falcone/values.yaml:2178,2196,2245` — replication corrected from `"001"` (requires a second volume server) to `"000"` (single copy) for the dev/base profile with `volume.replicas: 1`.

#### Scenario: Single-volume-server profile uses replication 000 and PUT returns 2xx

- **WHEN** the active profile deploys exactly one SeaweedFS volume server (`seaweedfs.volume.replicas: 1`) and replication is set to `"000"` on master, global, and filer
- **THEN** an S3 PUT to the SeaweedFS gateway on port 8333 returns HTTP 2xx and the object is retrievable via a subsequent GET

#### Scenario: Replication 001 with a single volume server causes PUT failure

- **WHEN** the active profile deploys exactly one SeaweedFS volume server and replication is set to `"001"` (one extra same-rack replica)
- **THEN** S3 PUT requests fail with `500 InternalError` because the master cannot place the required replica

#### Scenario: HA profile replication 011 is satisfiable with three volume servers

- **WHEN** the HA profile deploys three SeaweedFS volume servers (`seaweedfs.volume.replicas: 3`) and replication is set to `"011"`
- **THEN** S3 PUT requests succeed with HTTP 2xx and the object is stored with the rack-level redundancy the placement requires

### Requirement: SeaweedFS NetworkPolicy allow-list SHALL match rendered pod labels

The system SHALL configure `seaweedfs.networkPolicy.allowedAppComponents` with values that exactly match the `app.kubernetes.io/name` label rendered on the corresponding Falcone application pods by the chart's component-wrapper, so that the NetworkPolicy ingress rule permitting traffic to the SeaweedFS S3 gateway on port 8333 selects the real application pods and does not silently drop their connections.

Evidence: `charts/in-falcone/values.yaml:2420-2423` — entries corrected from camelCase (`controlPlane`, `controlPlaneExecutor`, `workflowWorker`) to kebab-case (`control-plane`, `control-plane-executor`, `workflow-worker`) to match the rendered `app.kubernetes.io/name` pod label set by the component-wrapper.

#### Scenario: Control-plane pod is permitted to reach S3 port 8333

- **WHEN** `seaweedfs.networkPolicy.allowedAppComponents` includes `control-plane` and the NetworkPolicy is rendered and applied to a cluster with a policy-enforcing CNI
- **THEN** a pod with label `app.kubernetes.io/name: control-plane` can open a TCP connection to the SeaweedFS S3 gateway on port 8333 and the connection is not dropped by the NetworkPolicy

#### Scenario: CamelCase entries in allowedAppComponents silently block traffic

- **WHEN** `seaweedfs.networkPolicy.allowedAppComponents` contains `controlPlane` (camelCase) instead of `control-plane` (kebab-case)
- **THEN** the NetworkPolicy ingress selector does not match any pod with `app.kubernetes.io/name: control-plane`, and all TCP connections from the control-plane pod to SeaweedFS S3:8333 are dropped

#### Scenario: workflow-worker pod is permitted to reach S3 port 8333

- **WHEN** `seaweedfs.networkPolicy.allowedAppComponents` includes `workflow-worker`
- **THEN** a pod with label `app.kubernetes.io/name: workflow-worker` can reach the SeaweedFS S3 gateway on port 8333 without a connection timeout

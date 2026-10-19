# Large-task worker profile

## ADDED Requirements

### Requirement: Closed operator profile with approved execution

The system SHALL export `LARGE_TASK_WORKER_PROFILE_VERSION = 1`, an immutable
`LARGE_TASK_WORKER_PROFILE_TEMPLATE` without an image, and
`validateLargeTaskWorkerProfile(profile, config)` returning `{ ok, violations }`.
Every violation SHALL carry code, severity, message and field. Both profile and
config SHALL be trusted operator configuration. Unknown keys SHALL be rejected
at every object level. No task parameters SHALL enter env, command or args.

The template SHALL contain env `[]`, resources cpu `2`, memory `4Gi`,
ephemeralStorage `20Gi`, maxDurationSeconds `7200`, codeExecution `disabled`, and
egress dnsNamespaces `[]` and allowedNamespaces `[]`.

#### Scenario: Approved image with defaults

- **GIVEN** a cloned template and an image exactly equal to an approvedImages
  entry's ref containing a complete sha256 digest
- **WHEN** validation runs
- **THEN** ok SHALL be true with no violations.

#### Scenario: Unsafe or ambiguous configuration

- **WHEN** image is missing or unapproved, any approved ref is tag-only or lacks
  a full digest, or an unknown top-level or nested field is supplied
- **THEN** validation SHALL fail.
- **WHEN** env contains a name outside that image's allowedEnv, valueFrom,
  envFrom, a nonliteral value or a duplicate name
- **THEN** validation SHALL fail.
- **WHEN** codeExecution is sandboxed without runtimeClassName in
  approvedSandboxRuntimeClasses, or runtimeClassName is not a DNS label
- **THEN** validation SHALL fail.
- **WHEN** maxDurationSeconds is non-positive, non-integral or above 86400,
  resources are not positive quantities, or egress lists contain invalid namespaces
- **THEN** validation SHALL fail.

### Requirement: Pure fail-closed manifests

The system SHALL export `buildLargeTaskJob` and `buildLargeTaskNetworkPolicy`,
each taking tenantId, taskId, namespace, profile and config. They SHALL validate
the profile and namespace, reuse validateRuntimeNamespace and
runtimeTenantOwnership, and return `{ manifest: null, violations }` without
throwing for invalid profiles or namespaces. Names and labels SHALL safely
represent task identifiers without truncation or case-folding collisions.
All new functions SHALL be pure, without cluster, filesystem, network or env I/O.

#### Scenario: Hardened Job

- **WHEN** a valid profile is rendered
- **THEN** a batch/v1 Job SHALL use the validated namespace, backoffLimit 0,
  activeDeadlineSeconds equal to maxDurationSeconds, and TTL 600.
- **AND** pod labels SHALL be component large-task-worker, tenant ownership,
  and in-falcone.io/task; restartPolicy SHALL be Never, token automount and
  service links SHALL be false.
- **AND** the single container SHALL have no command or args, runAsNonRoot true,
  allowPrivilegeEscalation false, capabilities.drop [ALL], seccompProfile
  RuntimeDefault and readOnlyRootFilesystem true.
- **AND** CPU, memory and ephemeral-storage requests SHALL equal limits, and a
  workspace emptyDir SHALL mount at /work with sizeLimit equal to ephemeralStorage.
- **AND** runtimeClassName SHALL appear only when supplied.

#### Scenario: Exact task policy with no wildcard egress

- **WHEN** a valid profile is rendered
- **THEN** the policy SHALL select exactly the Job's task labels, have
  policyTypes [Ingress, Egress] and no ingress rules.
- **AND** a DNS UDP/TCP 53 rule SHALL appear only for non-empty dnsNamespaces;
  an allowed-namespace rule SHALL appear only for non-empty allowedNamespaces.
- **AND** no egress rule SHALL have an empty or absent to list.

### Requirement: Deterministic termination and audit

The system SHALL export `classifyLargeTaskTermination({ job, pods,
cancelRequested })` and `largeTaskAuditRecord({ tenantId, workspaceId, taskId,
code, profileVersion })`.

#### Scenario: Observed termination

- **WHEN** Job completion or pod success is observed
- **THEN** the code SHALL be LARGE_TASK_SUCCEEDED.
- **WHEN** a true Failed Job condition has reason DeadlineExceeded
- **THEN** the code SHALL be LARGE_TASK_DEADLINE_EXCEEDED.
- **WHEN** an Evicted pod reports kubelet emptyDir usage, container local
  ephemeral storage or pod-total ephemeral storage exceeding its limit
- **THEN** the code SHALL be LARGE_TASK_DISK_EXCEEDED.
- **WHEN** eviction reports the node was low on a resource
- **THEN** the code SHALL be LARGE_TASK_NODE_PRESSURE.
- **WHEN** a container is OOMKilled
- **THEN** the code SHALL be LARGE_TASK_MEMORY_EXCEEDED.
- **WHEN** no observed outcome applies and cancelRequested is true
- **THEN** the code SHALL be LARGE_TASK_CANCELLED.
- **WHEN** a Job or pod disappears without cancellation or an observed outcome
- **THEN** the code SHALL be LARGE_TASK_LOST.
- **OTHERWISE** the code SHALL be LARGE_TASK_FAILED.

#### Scenario: Audit projection

- **WHEN** an audit record is requested
- **THEN** it SHALL deterministically contain only tenantId, workspaceId,
  taskId, code and profileVersion, without env values or image credentials.

### Requirement: Honest documented guarantees

The operator documentation SHALL describe every field, default, trust boundary
and deployment prerequisite without claiming stronger runtime enforcement.

#### Scenario: Operator prerequisites

- **WHEN** the documentation contract runs
- **THEN** it SHALL verify every profile/config field and default, entrypoint
  trust, no task commands, read-only task file delivery in part b, kubelet
  eviction thresholds, overshoot, deleted-but-open files and missing accounting,
  enforcing CNI, additive policies, the node exception, sandbox handler trust,
  and kubelet podPidsLimit with no corresponding pod field.
- **AND** existing test:unit and test:contracts suites SHALL remain passing;
  existing builders, charts and runtime paths SHALL remain unchanged.

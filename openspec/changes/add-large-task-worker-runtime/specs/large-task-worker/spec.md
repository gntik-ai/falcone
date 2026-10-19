# Large-task worker runtime

## MODIFIED Requirements

### Requirement: Closed operator profile with approved execution

The profile SHALL additionally accept optional operator string `args` and positive
`runAsUser` / `runAsGroup`, without default task identities. Explicit identities
SHALL be invalid under `config.openshiftRestricted`. `egress.allowedNamespaces`
SHALL exclude `config.platformNamespace`. Task input SHALL never affect image,
env, args or command; command SHALL never be set.

#### Scenario: Existing profile compatibility

- **WHEN** no new profile or builder options are supplied
- **THEN** serialized builder output SHALL be byte-identical to #948.

### Requirement: Pure fail-closed manifests

The builders SHALL remain pure and support optional suspended Jobs, TTL (default
600), required node affinity using `metadata.name` matchFields, a read-only params
ConfigMap mount at `/task`, workspace/generation labels, the full params-sha256
annotation, termination grace and termination message policy. Job-owned params
ConfigMaps and policies SHALL use the returned Job UID and blockOwnerDeletion
false. The params file SHALL contain only `params.json` with the JSON envelope
`{"parameters":...}`, bounded to 65,536 UTF-8 bytes including that envelope.

#### Scenario: Input file boundary

- **WHEN** task parameters are supplied
- **THEN** only the params ConfigMap SHALL contain their values.
- **AND** a serialized envelope above 65,536 bytes SHALL fail validation.

## ADDED Requirements

### Requirement: Durable crash-safe reconciliation

`createLargeTaskRuntime({ request, config, heartbeat, signal })` SHALL expose
ensure, status, collect and cancel. Tests SHALL inject the Kubernetes request
boundary; the default client SHALL use the in-cluster token and CA with a ten
second call deadline. Heartbeats SHALL run between requests, and cancellation
SHALL be checked before regular mutations. Every delete SHALL be UID-fenced.

The base SHALL be `lt-` plus 16 hex characters of SHA256 of the JSON-array encoding
of workflowId, runId, activityId and first scheduledTimestampMs. A generation's
Job SHALL be `<base>-g<n>`. An unowned `<base>-claim` ConfigMap SHALL retain
generations and an epoch-seconds claim-expires label, defaulting to seven days.
Every claim patch SHALL be resourceVersion-fenced.

#### Scenario: Interrupted reconciliation

- **WHEN** a write is interrupted or its response is lost
- **THEN** ensure SHALL reconcile the same generation without duplicate execution.
- **AND** the claim SHALL record prepared before Job creation, created with the
  returned UID, starting with that UID before unsuspend, and started afterward.
- **AND** Jobs SHALL be created suspended and unsuspended with a resourceVersion
  fence only after the starting claim patch succeeds.
- **AND** a missing claim on that patch SHALL leave the Job suspended.

#### Scenario: Ambiguous creation and conflicting identity

- **WHEN** a Job POST response is lost or returns 409
- **THEN** deterministic-name GET SHALL validate component/task/generation and
  tenant/workspace labels plus params-sha256 before adopting the returned UID.
- **AND** a mismatch SHALL raise non-retryable LARGE_TASK_RUNTIME_CONFLICT and
  SHALL never authorize deletion of that Job.
- **AND** a 404 SHALL not prove the POST cannot commit later; a late Job SHALL
  remain suspended until safely adopted or swept.

#### Scenario: Safe cleanup

- **WHEN** activity startup sweeps namespace objects
- **THEN** it SHALL delete expired claims and suspended task Jobs older than 600
  seconds whose claim is missing, cancelled or has not reached starting.
- **AND** conflicting Jobs SHALL remain protected.
- **WHEN** cancellation cleanup runs
- **THEN** it SHALL record cancelled before deleting, validate ambiguous Jobs by
  deterministic name, and use its own non-cancelled ten second budget.

### Requirement: Observable state and claim-led retries

`classifyLargeTaskState` SHALL filter pods by controller UID and report PENDING
for no pod or Pending, RUNNING for a running pod, and LARGE_TASK_CAPACITY for a
quota FailedCreate event involving this Job UID. LARGE_TASK_LOST SHALL require a
live Job and a vanished observed pod without terminal state or cancellation.
A missing Job without recorded outcome SHALL yield LARGE_TASK_OUTCOME_UNKNOWN.
Other outcomes SHALL delegate to classifyLargeTaskTermination.

#### Scenario: Retry source of truth

- **WHEN** the highest claim generation is prepared or created with no Job
- **THEN** ensure SHALL repeat that generation.
- **WHEN** NODE_PRESSURE, CAPACITY or LOST is observed
- **THEN** it SHALL be recorded before UID-fenced retirement, and a retry SHALL
  start n+1, retiring any still-existing previous Job.
- **WHEN** a started or starting Job disappears without a recorded terminal state
- **THEN** retries SHALL fail OUTCOME_UNKNOWN without rerunning it.
- **WHEN** a Job disappears after recorded SUCCEEDED
- **THEN** retries SHALL fail RESULT_EXPIRED regardless of stale heartbeats.

#### Scenario: Bounded result collection

- **WHEN** collection follows success
- **THEN** the result SHALL be the termination message, capped at 4096 UTF-8
  bytes, parsed as JSON when possible.
- **AND** logs SHALL use tailLines=500 and stream into a rolling buffer of at
  most 65,536 bytes with a ten second read deadline.
- **AND** unavailable logs SHALL never change classification.

### Requirement: Per-node positive isolation verification

Before submitting tasks the runtime SHALL verify configured node metadata.name
values with matched allow/deny probe Jobs using the same DNS IP literal from
resolv.conf, node, digest-pinned image and five second TCP/53 arguments. Probes
SHALL be hardened, nodeName-pinned, have TTL 300, and default UID/GID 65532,
omitting both under openshiftRestricted. Only the allow probe SHALL receive the
policy permitting TCP/UDP 53 to kube-system.

#### Scenario: Routing and enforcement must both work

- **WHEN** the allow probe connects and the deny probe does not
- **THEN** that node SHALL be verified.
- **WHEN** allow fails or deny connects
- **THEN** that node SHALL not be verified or appear in task node affinity.
- **WHEN** no nodes are verified
- **THEN** submissions SHALL fail retryable LARGE_TASK_ISOLATION_NOT_READY.

#### Scenario: Invalidate stale verification

- **WHEN** default-deny's UID/resourceVersion, the eligible node list or probe
  settings change, or verification exceeds isolationRecheckSeconds (86400)
- **THEN** matched probes SHALL run again.
- **AND** large-task-isolation SHALL record the policy identity, configured nodes
  and verified nodes before admitting a task.

### Requirement: Gated largeTask.run flow activity

The activity SHALL be registered with input/output schemas, wired through worker
dependencies, included in the worker image and paired with maxHeartbeatThrottleInterval
10s. LARGE_TASK_CONFIG SHALL be trusted operator configuration, with distinct
namespace/platformNamespace, digest-pinned approved profiles and probe image.
The chart SHALL supply namespace; source SHALL not infer the release name.

#### Scenario: Fail closed before submission

- **WHEN** config is absent or invalid
- **THEN** the activity SHALL raise non-retryable LARGE_TASK_RUNTIME_UNAVAILABLE.
- **WHEN** the selected profile is unknown
- **THEN** it SHALL raise non-retryable LARGE_TASK_PROFILE_UNKNOWN.
- **WHEN** heartbeatTimeout is outside 30–120 seconds, startToCloseTimeout is
  below maxDurationSeconds + 600, or scheduleToCloseTimeout is missing or exceeds
  claimRetentionSeconds - 86400
- **THEN** it SHALL raise non-retryable LARGE_TASK_TIMEOUTS_INVALID.

#### Scenario: Activity outcomes and cancellation

- **WHEN** polling or waiting
- **THEN** heartbeats SHALL include generation, jobName, jobUid, observedPod and
  terminal when known, including during cancellation-aware five second waits.
- **WHEN** the task succeeds
- **THEN** the activity SHALL return code, result and logTail.
- **WHEN** NODE_PRESSURE, CAPACITY or LOST occurs
- **THEN** the activity SHALL throw retryable; other terminal failures SHALL be
  non-retryable, carry largeTaskAuditRecord and log large_task.terminated once.
- **WHEN** cancellation reason is CANCELLED
- **THEN** it SHALL clean up, audit LARGE_TASK_CANCELLED and rethrow the original
  CancelledFailure.
- **WHEN** reason is WORKER_SHUTDOWN, TIMED_OUT or NOT_FOUND
- **THEN** it SHALL keep the Job for reattachment and rethrow the failure.

### Requirement: Paired deployment and operator evidence

The separate chart ChangeSet SHALL gate namespace, default-deny, quota, exact
namespaced RBAC, token mount and hash-annotated config behind largeTasks.enabled,
default false, preserving disabled and reuse-values rendering. It SHALL use no
cluster-scoped permissions and keep automountToken false by default.

#### Scenario: Release and closure gates

- **WHEN** delivering source and deployment
- **THEN** they SHALL ship together, preserving external-secrets/OpenBao gates.
- **AND** operators SHALL complete staging checks 1–7 (echo, deadline,
  cancellation, DNS versus Postgres isolation, pod hardening/policies, TTL cleanup
  and isolation record) before closing #1190.
- **AND** documentation SHALL describe lifecycle, generations, claims and result
  retention, and limit the isolation guarantee to default-deny TCP/53 egress.

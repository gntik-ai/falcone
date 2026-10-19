# Run large tasks from flows with durable claims and isolation checks

## Why

Issue #1190 (GAP-FAL-009b) applies #948's pure security-profile builders. Flows
need a crash-safe way to submit bounded Jobs without executing task parameters
as commands or rerunning an execution whose outcome became unknowable.

## What changes

- Extend the pure builders additively with operator args and user/group IDs,
  suspended Jobs, verified-node affinity, owned params files and state observation.
- Add an injected Kubernetes runtime with deterministic execution names, durable
  fenced claims, validated ambiguous-create adoption and UID-fenced cleanup.
- Verify default-deny egress enforcement with matched allow/deny probes per node,
  caching results against the policy identity/version, node list and age.
- Register `largeTask.run`, validate its configuration and Temporal timeouts,
  heartbeat during reconciliation and waits, and preserve Jobs on worker shutdown.
- Ship the runtime's transitive dependencies in the workflow-worker image and
  document lifecycle, retry generations, result retention and deployment gates.

## Scope and decisions

D1: `LARGE_TASK_CONFIG.namespace` is authoritative and is rendered by the separate
chart ChangeSet; it must differ from `platformNamespace`. The source does not
infer a release name. The activity fails closed when the config is absent.

D2: a JSON-array encoding of workflowId, runId, activityId and the first scheduled
TimestampMs supplies the deterministic base hash. The durable claim is the retry
source of truth; heartbeat checkpoints are advisory only.

D3: isolation probes cover TCP/53 default-deny egress enforcement, not every
protocol, destination or the node exception. Only positively verified nodes can
receive a new task. Profiles and probe images must be digest-pinned.

D4: chart namespace/RBAC/config/token mounts and staging profiles belong to the
paired deployment repository. Source implementation never mutates the cluster.
The operator must pass staging checks 1–7 before closing #1190.

Artifact uploads, authenticated worker clients, HTTP APIs, fair admission,
quota dimensions, egress proxies and installing sandbox runtimes are excluded.
Rollback disables `largeTasks.enabled`; disappearance of started work fails
closed rather than initiating another execution. Existing safety gates remain.

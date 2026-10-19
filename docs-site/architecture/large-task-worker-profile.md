# Large-task worker security profile

Version 1 defines a pure contract and manifest builders for long, disk-heavy tasks
(issue #948, part a). Issue #1190, part (b), adds the gated runtime described below.
The profile and its approval config are **trusted operator configuration**, never
tenant input. Unknown fields at every object level are rejected.

## Fields and defaults

Start with a deep clone of `LARGE_TASK_WORKER_PROFILE_TEMPLATE`; the exported
template is deeply frozen and deliberately has no image.

| Profile field | Meaning and default |
| --- | --- |
| `image` | Required exact match to an `approvedImages` entry's `ref`, containing a full `@sha256:` digest. Tags alone are rejected, even in the approved list. |
| `env` | Defaults to `[]`. Literal pairs with `name` and string `value` only; each name must be in that image's `allowedEnv`. Duplicate names, `valueFrom` and `envFrom` are rejected. `NODE_OPTIONS` is blocked unless explicitly approved for that image. |
| `resources` | Required object with `cpu`, `memory` and `ephemeralStorage`. Defaults: 2 CPU, 4Gi memory, 20Gi disk. Values must be positive Kubernetes quantities; CPU may be numeric or a core/millicore string. Requests equal limits. |
| `maxDurationSeconds` | Defaults to 7200; integer from 1 through 86400. Becomes the Job's active deadline. |
| `codeExecution` | Defaults to `disabled`; the only other value is `sandboxed`. |
| `runtimeClassName` | Optional DNS label. Required for sandboxed execution and then must match `approvedSandboxRuntimeClasses`. Omitted from the pod when unset. |
| `egress` | Required object with `dnsNamespaces` and `allowedNamespaces`, both defaulting to `[]`. Entries are namespace DNS labels. Empty lists permit no namespace, including no DNS. |

The config's `approvedImages` is an array of closed objects `{ ref, allowedEnv }`.
Every `ref` must be digest-pinned, and `allowedEnv` is an array of approved env
names for that specific image. `approvedSandboxRuntimeClasses` is an optional
array of DNS labels, defaulting to no approved sandbox classes. Unknown config
and approved-entry fields are violations too. Image scanning and provenance
verification remain separate operator responsibilities.

`validateLargeTaskWorkerProfile(profile, config)` returns `{ ok, violations }`.
Violations contain code, severity, message and field, without env values. Both
`buildLargeTaskJob` and `buildLargeTaskNetworkPolicy` validate before rendering;
an invalid profile or namespace yields `{ manifest: null, violations }`.
The authoritative namespace must be supplied, never inferred from tenant input.
Tenant ownership uses the existing runtime label contract. Task labels preserve
safe identifiers and fingerprint unsafe ones; Job and policy names fingerprint
the whole task identifier to avoid case-folding and truncation collisions.

## Entrypoint trust: Untrusted source does not execute

With `codeExecution: disabled`, Falcone runs only the approved image's own
entrypoint with its approved env. It never supplies a command or args from task input.
Approving an image means trusting that its entrypoint does not execute fetched content.
Falcone does not inspect or police what that entrypoint does. No-execution is an
image approval guarantee, not a property enforced by container hardening alone.

Task parameters arrive only as a read-only file in part (b), never via env,
command or args. The runtime below owns submission, observation, heartbeat and cancellation.
Artifact upload and authenticated worker clients remain a later follow-up. No platform or customer
credentials are inherited here: the pod has no service-account token, env
sources or injected service links, and the builders add no image credentials.
Operators must keep secrets out of approved literal env values and verify any
admission-time mutation preserves these guarantees.

Opting into `sandboxed` requires an approved RuntimeClass. The operator must
verify its handler actually provides gVisor, Kata or equivalent isolation: a
class name alone can map to runc. The disabled profile uses the cluster default
runtime unless the operator explicitly supplies a class.

## Bounded resources and prerequisites

The `batch/v1` Job has no retries (`backoffLimit: 0`), a profile duration deadline,
and TTL 600 seconds after finishing. Its pod restarts Never, disables token
automount and service links, and has one container running as non-root with no
privilege escalation, all capabilities dropped, RuntimeDefault seccomp and a
read-only root filesystem. CPU, memory and ephemeral-storage requests equal
limits. A disk-backed `workspace` emptyDir mounts at `/work`, with sizeLimit
equal to ephemeral storage. Images must support non-root execution and these
filesystem restrictions.

Disk limits are **kubelet eviction thresholds**, not hard filesystem quotas.
Usage can overshoot between scans. Space held by deleted-but-open files is
invisible to directory scans and can exceed the limit indefinitely. Node
storage layouts without accounting do not enforce these limits. Operators
must verify kubelet local ephemeral-storage accounting on the actual layout.

PID limits require kubelet configuration `podPidsLimit`. There is no pod field
for them, so the profile carries no PID limit. Configure and verify this on the
worker nodes before using the profile for untrusted work.

## Controlled egress prerequisites

The NetworkPolicy selects exactly the task's component, tenant and task labels,
denies ingress and allows only the named namespace destinations. A DNS rule
allows UDP/TCP 53 only when DNS namespaces are named. An allowed-namespace rule
permits all ports in those namespaces only when that list is non-empty. No rule
has an empty or absent `to` list. Empty lists produce no egress rules at all.

Isolation requires a CNI that enforces NetworkPolicy. Policies are additive:
the runtime namespace must have no broader allow policy selecting these pods,
because another policy can widen access. Standard NetworkPolicy always allows
traffic to the pod's own node. Blocking the node exception requires extra
enforcement outside this profile. A namespace allowance is not a host allow-list;
host restrictions such as github.com require a separate egress proxy follow-up.
Installing the sandbox handler, configuring the CNI, kubelet and namespace
policies, and granting submission RBAC are deployment prerequisites outside part a.

## Termination and audit contract

`classifyLargeTaskTermination` returns one of:

- `LARGE_TASK_SUCCEEDED`: observed Job completion or pod success.
- `LARGE_TASK_DEADLINE_EXCEEDED`: a true Failed Job condition with DeadlineExceeded.
- `LARGE_TASK_DISK_EXCEEDED`: an Evicted pod reporting the emptyDir, container
  ephemeral-storage or pod-total ephemeral-storage limit text from kubelet.
- `LARGE_TASK_NODE_PRESSURE`: node resource-pressure eviction; do not charge it to the task.
- `LARGE_TASK_MEMORY_EXCEEDED`: a container terminated with OOMKilled.
- `LARGE_TASK_CANCELLED`: only an explicit trusted `cancelRequested: true` from part (b).
- `LARGE_TASK_LOST`: a missing Job or pod without an observed outcome or cancellation.
- `LARGE_TASK_FAILED`: any other state, including an unrecognised eviction.

Observed success takes precedence, followed by the deadline, eviction and OOM
outcomes, then requested cancellation, disappearance and the failure fallback.
The runtime calls this classifier when deciding termination; a running object
alone is not a terminal success. It performs no watches or cluster reads.

`largeTaskAuditRecord` deterministically projects only tenantId, workspaceId,
taskId, code and profileVersion. It adds no timestamp or ambient data and never
includes env values, image refs or image credentials. Part (b) emits this record
for the "Bounded resources" audit guarantee.

## Flow activity configuration

`largeTask.run` takes `{ profile, parameters }` in a flow task's params. The
worker dependency factory reads trusted operator JSON from `LARGE_TASK_CONFIG`.
Without valid config the activity raises non-retryable
`LARGE_TASK_RUNTIME_UNAVAILABLE`; it does not contact Kubernetes. An unknown
profile raises `LARGE_TASK_PROFILE_UNKNOWN`.

| Config key | Contract |
| --- | --- |
| `namespace`, `platformNamespace` | Required distinct namespace DNS labels. The paired chart renders the auxiliary task namespace into the config; tenants cannot choose it. |
| `approvedImages`, `approvedSandboxRuntimeClasses`, `profiles` | Existing approvals and named, validated profiles. Task images require an exact approved digest. Sandboxed profiles require an installed, approved RuntimeClass; staging currently has none. |
| `finishedTtlSeconds` | Positive integer, default 3600. Result collection is possible only while the finished Job and its pod remain available. |
| `claimRetentionSeconds` | Default 604800 (seven days), greater than 86400. Claims survive individual Jobs and generations. |
| `isolationProbeImage` | Required digest-pinned probe image with sh and nc. It must support non-root execution. |
| `isolationProbeRunAsUser` | Positive UID/GID, default 65532. Both IDs are omitted from probe pods under `openshiftRestricted`. |
| `nodes` | Explicit eligible node metadata.name values; the worker never lists cluster nodes. An empty list cannot admit tasks. |
| `isolationRecheckSeconds` | Positive integer, default 86400. Expired verification triggers new matched probes. |
| `openshiftRestricted` | Defaults false. Explicit profile `runAsUser` and `runAsGroup` are rejected when true. |

Profiles may additionally set operator string `args`, replacing the image CMD,
and optional positive `runAsUser` / `runAsGroup`, with no default task IDs.
The container command is never set. Task parameters cannot modify these fields,
image or env. `egress.allowedNamespaces` cannot include `platformNamespace`.

Parameters become one `params.json` key containing `{"parameters":...}` in a
Job-owned ConfigMap, mounted read-only at `/task`. The complete UTF-8 envelope
must fit in 65,536 bytes; omitted parameters are represented as null. The pod
retains its disk-backed `/work` mount and all #948 hardening. Runtime Jobs use
five seconds of termination grace and `FallbackToLogsOnError`.

Configure Temporal retryPolicy timeouts with heartbeat from 30 through 120
seconds, startToClose at least maxDurationSeconds + 600 seconds, and a set
scheduleToClose no greater than claimRetentionSeconds - 86400 seconds. Violations
raise non-retryable `LARGE_TASK_TIMEOUTS_INVALID` before any API call. The activity
heartbeats between requests and during cancellation-aware five-second waits;
the worker's maximum heartbeat throttle interval is ten seconds.

## Lifecycle, claims and generations

The base name is `lt-` followed by 16 hex characters of SHA256 over a JSON array
of workflowId, runId, activityId and the first scheduledTimestampMs. Temporal
preserves that timestamp across retries; another execution of the same node has
a distinct activity identity. A generation's Job is `<base>-g<n>`.

An unowned `<base>-claim` ConfigMap persists the full generation history. It has
an `in-falcone.io/claim-expires` epoch-seconds label for sweeping. Claim patches
use resourceVersion fences. Heartbeat details include generation, jobName,
jobUid, observedPod and terminal when known, but never override the claim.

| Phase | Persisted barrier |
| --- | --- |
| prepared | Before creating a suspended Job. |
| created | Returned Job UID recorded; parameters and policy may still need reconciling. |
| starting | UID durably recorded before the resourceVersion-fenced unsuspend patch. The task may have run from this point onward. |
| started | Unsuspend response received; retries attach to this Job. |
| cancelled | Explicit requested cancellation recorded before cleanup. |

Every ensure reconciles the steps again. A lost POST response or 409 is followed
by GET of the deterministic name. Component/task/generation, tenant/workspace
labels and the full `in-falcone.io/params-sha256` annotation must match before
adoption. The returned UID owns params and policy and fences every delete.
Existing params and policies must have the correct Job owner and content hash.
Conflicts raise non-retryable `LARGE_TASK_RUNTIME_CONFLICT` and never authorize
deletion of the conflicting Job.

A 404 after POST cannot exclude a late commit. Such a Job remains suspended
because only a matching durable starting claim authorizes unsuspend. Activity
startup sweeps suspended task Jobs older than 600 seconds when their claim is
missing, cancelled, or has not reached starting. Expired claims are swept too;
claims protecting conflicting Jobs are retained for operator resolution.

Prepared or created with no Job repeats the same generation. A running Job is
reattached. `LARGE_TASK_NODE_PRESSURE`, `LARGE_TASK_CAPACITY` and
`LARGE_TASK_LOST` are recorded before UID-fenced retirement and a retry starts
n+1. Lost requires a previously observed pod to vanish while its Job still
exists, without terminal state or cancellation. A missing Job after starting
with no terminal record yields non-retryable `LARGE_TASK_OUTCOME_UNKNOWN` and
never reruns; even a committed unsuspend followed by TTL cleanup is ambiguous.

Terminal state is written before acting on it or heartbeating it. Success returns
`{ code, result, logTail }`; result is the termination message parsed as JSON
when possible, capped at 4096 UTF-8 bytes. Log collection streams `tailLines=500`
into a rolling buffer of at most 65,536 bytes with a ten-second read deadline.
Missing logs never alter classification. Other terminal failures carry the
bounded `largeTaskAuditRecord` in their failure details and emit one
`large_task.terminated` record without parameters, env or credentials.

Finished Jobs expire after finishedTtlSeconds; their params ConfigMaps and
policies are garbage-collected through Job ownerReferences with
blockOwnerDeletion false. A recorded success whose Job has expired yields
`LARGE_TASK_RESULT_EXPIRED`, including when the last heartbeat was stale.
Claims retain that outcome until their separate retention expires. The timeout
rules ensure no valid retry is scheduled after claim retention.

Only cancellation reason `CANCELLED` records cancelled, deletes the Job, audits
`LARGE_TASK_CANCELLED` and rethrows the original CancelledFailure. Cleanup uses
its own non-cancelled ten-second budget and UID preconditions. WORKER_SHUTDOWN,
TIMED_OUT and NOT_FOUND preserve the Job for reattachment. The activity's signal
is checked before every regular mutation.

## Per-node isolation verification

Before admitting new work, the runtime gets the namespace's default-deny policy.
For every configured node it pins a matched pair of hardened, digest-pinned
probe Jobs using nodeName. Both run the same five-second TCP/53 nc check against
the same DNS IP literal read from the worker's resolv.conf, avoiding DNS lookup.
Only the allow probe is selected by a Job-owned policy permitting TCP/UDP 53 to
kube-system. The deny probe has only the namespace default-deny policy.

A node verifies only when allow connects and deny does not. Broken routing
(both fail) and missing enforcement (deny connects) both fail closed. A
`large-task-isolation` ConfigMap stores verifiedNodes, checkedAt, default-deny
UID/resourceVersion, configured nodes, image, user settings and DNS target.
Changing policy identity/version, node list, probe settings/target or record age
re-probes. Probe Jobs have a 300-second TTL. Task affinity lists only verified
nodes; none raises retryable `LARGE_TASK_ISOLATION_NOT_READY`.

This is a heuristic for **default-deny egress enforcement on TCP/53**, not proof
of isolation across every protocol or destination. Existing CNI prerequisites,
the node exception and the requirement for no broader selecting allow policy
still apply. No runtime installs a sandbox, reads Secret values or bypasses
external-secrets/OpenBao.

## Deployment and staging handoff

The paired chart change gates the auxiliary restricted namespace, default-deny,
quota, exact namespaced RBAC, worker token mount and hash-annotated config under
`largeTasks.enabled`, default false. This source change adds no deployment
workflow pins and performs no cluster actions. Disabling the chart removes the
namespace and claims; interrupted flows then fail closed as outcome unknown or
runtime unavailable. Ship the source and chart changes together.

Before issue closure an operator must publish flows for all seven staging checks:
echo result; sleep deadline within 60 seconds; cancellation and Job removal;
DNS allowed and Postgres denied with a positive external control; running-pod
hardening, policies and verified-node affinity; TTL garbage collection; and the
isolation record matching the live default-deny UID/version and admitted nodes.
These checks require the deployed environment and are not simulated CI passes.

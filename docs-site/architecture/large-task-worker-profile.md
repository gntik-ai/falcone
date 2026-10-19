# Large-task worker security profile

Version 1 defines a pure contract and manifest builders for long, disk-heavy tasks
(issue #948, part a). Nothing here submits a Job or changes an existing runtime.
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
command or args. That future runtime also owns submission, watch, heartbeat,
cancellation and artifact upload credentials. No platform or customer
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
host restrictions such as github.com require the separate egress proxy in part (b).
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

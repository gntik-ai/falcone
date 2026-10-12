# Execution-token trust

## Production key policy

Both secret resolvers use identical code: resolve `FLOW_EXECUTION_TOKEN_SECRET` at call time;
in `NODE_ENV=production`, reject unset, empty, or fewer than 32 UTF-8 bytes. This follows the
fail-closed environment distinction of `resolveTriggerSecretKey`. Outside production, the
existing development fallback remains available. The 32-byte minimum resolves the design
question using the approved scope; no key IDs, rotation scheme, or wire-format change is added.

Executor errors carry `EXECUTION_TOKEN_SECRET_UNCONFIGURED` and HTTP status 503 before
`workflow.start`. The server's existing error mapping supplies the public response. Worker
mint/validation errors become non-retryable Temporal failures. Missing/malformed credentials
remain `EXECUTION_TOKEN_INVALID`, including when a production secret is also absent. Error
messages name the variable or validation condition, never the secret or token.

## Cron mint boundary and trust trade-off

The worker holds the shared HMAC key already needed for validation, and therefore already has
cryptographic signing capability. Use that worker for a dedicated `mintCronExecutionToken`
activity instead of adding a control-plane HTTP dependency. Its tenant argument alone cannot
authorize minting. Read the current workflow ID and run ID from Temporal Activity Context, then
describe that exact run through the worker's namespace-scoped Temporal client. The server-recorded
`TemporalScheduledById` must equal `scheduleIdFor(tenantId, workspaceId, flowId)`; absent metadata
is INVALID and foreign ownership is TENANT_MISMATCH. Do not accept schedule IDs or workflow IDs
from activity arguments. The worker does not import control-plane code for this check or crypto.

This trusts Temporal's schedule/workflow administration as a platform boundary; tenant clients
must not have authority to forge workflow search attributes or poll the worker task queue.
The worker needs describe permission in its existing namespace. A compromised worker already
possesses the shared key; delegating minting to the executor would not remove that trust.

The run's server-recorded `startTime` defines the actual firing time. Mint using the activity
clock clamped to at least the server-recorded firing time, and a remaining TTL ending at firing
time plus `DEFAULT_MAX_RUN_DURATION_MS`. This tolerates worker/server clock skew while minting
at or after the firing. Reject missing or already expired firing times. Activity delays/retries
cannot extend expiry.
Randomness, clock reads, HMAC, and server I/O occur only inside activities. The deterministic
workflow threads the returned token into the tenant envelope before loading/dispatching tasks.

## Existing schedules and replay

Persisted Schedule actions continue to contain only the tenant envelope and no bearer token.
For scheduled runs the interpreter resolves legacy envelope-only args through the pinned
`tenant.flowId` and `tenant.flowVersion`. No schedule re-upsert is required. The existing
Temporal `TemporalScheduledById` attribute identifies those firings even after registration
more than 24 hours earlier. A `fix-976-cron-execution-token` patch marker protects older workflow
histories from insertion of the new activity during replay. In-flight histories without the
patch do not acquire a retroactive credential; drain them or accept activity failure.

Execution tokens remain absent from memo, search attributes, and persisted Schedule action args.
Run workflow/activity history contains credential-bearing arguments/results as required by the
existing argument transport; no new visibility copy is added. Temporal history access remains a
trusted administrative boundary, and this change does not introduce a payload codec.

## Paired deployment and release gates

The deployment maker must render `FLOW_EXECUTION_TOKEN_SECRET` on both controlPlaneExecutor
and workflowWorker as secretKeyRef entries referencing one ESO-managed Secret backed by
OpenBao (remote key `flows/execution-token-secret`). Include its ExternalSecret in the canonical
set and readiness gates. No literal or Helm-generated secret is permitted. Pin both built images
by immutable digest; Hermes owns FALCONE_CHARTS_REF. These are paired deployment obligations,
not changes performed in this source worktree.

Before rollout: provision the strong OpenBao secret, wait for ExternalSecret Ready, confirm both
workloads receive the same value without exposing it, then roll out compatible executor/worker
images. Drain old dev-key runs (up to 24 hours) or accept non-retryable INVALID failures. R3 human
approval and independent dual-provider review remain mandatory. A missing secret returns 503
for starts and rejects worker validation. Version skew must not leave new cron workflows on a
worker that lacks the mint activity. Never roll back by unsetting the production secret or
restoring the public signing constant; keep the secret and roll back only compatible cron/gate
logic if needed.

## Test seams and limits

Test the public executor mint/validate and worker assert helpers, registered `dispatchTask`,
the real interpreter with a Temporal/CEL system-boundary adapter, real schedule registration,
and HTTP flow-start error mapping. The adapter replaces only external SDK/runtime boundaries;
Falcone workflow, activity, crypto, registry, and dispatch modules execute unchanged. The test
adapter loads TypeScript with the existing worker compiler in CI and native stripping in the
dependency-free Node 22 sandbox. The quality job runs the worker typecheck/build, token suites,
and credential-bearing catalog, database-wiring, and LLM activity regressions. Capability tests
mint valid scoped credentials before dispatch so they exercise behavior behind the mandatory gate.
The env suite uses the real SDK activity environment and Postgres RLS for manual, signed webhook,
retry, and cron starts. CI must run frozen dependencies, worker typecheck/build, live Temporal
schedule/replay checks, and the real database/HTTP suites. Release gates perform chart rendering,
image builds/scans, secret readiness and redacted replica presence evidence, and forged-token
rejection. No unavailable check is counted as passing.

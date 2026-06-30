# Flows Architecture

The **flows** capability is a durable workflow engine layered over **Temporal**. A tenant authors
a flow as a YAML DSL; the platform stores immutable versions, starts executions as Temporal
workflows, and runs each one through a single **generic interpreter** that translates DSL nodes to
Temporal primitives. This page documents the implementation as merged on `main`. For the decision
record see [ADR-11](/architecture/adrs#adr-11-temporal-for-the-durable-workflow-flows-engine); for
the normative spec see `openspec/specs/workflows/spec.md`. The tenant-facing guide is
[Flows](/guide/flows); the operator procedures are in the
[Flows Runbook](/architecture/flows-runbook).

## Component map

```
 console editors            control plane (Temporal-free except the flow-executor)         engine          worker
 ───────────────            ─────────────────────────────────────────────────────         ──────          ──────
 designer / YAML  ──HTTP──▶ flow-executor.mjs  ──Temporal client──▶  Temporal frontend ◀──poll── workflow-worker
 palette / runview          flow-trigger-registry.mjs                 (gRPC 7233)               DslInterpreterWorkflow
                            flow-monitoring-executor.mjs (SSE)        history + matching        + activity catalog
                            flow-quota-gate.mjs                       PostgreSQL visibility     (db/storage/functions/
                            execution-token.mjs                       (SQL, no Elasticsearch)    events/http/email)
```

- **Control plane.** `apps/control-plane/src/runtime/flow-executor.mjs` is the **only** module in
  the control-plane process that holds a Temporal client — the single place a workflow is
  started, described, signalled, cancelled, listed (mirroring how `mongo-data-executor.mjs` owns
  the Mongo connection). It is constructed only when `TEMPORAL_ADDRESS` is set; otherwise the
  flows routes are simply not registered and the rest of the control plane runs unchanged.
- **Temporal.** The durable execution engine: frontend (gRPC), history, matching, and an internal
  worker service, with **PostgreSQL** for both persistence and **SQL advanced visibility** (no
  Elasticsearch). Temporal is **internal-only**; its Web UI is **operator-only**.
- **Worker.** `services/workflow-worker/` polls the task queue and hosts the generic
  `DslInterpreterWorkflow` plus the activity catalog.

## Draft definitions and canvas projection

Fresh draft rows may temporarily carry an empty JSON definition. The flow definition store defaults
`definition_json` to `{}`, and `flow-executor.mjs` returns that as `definition: {}` until the tenant
saves a real DSL document. The console designer treats this as an authoring-only empty draft:
`ConsoleFlowDesignerPage.normalizeDefinition` supplies `apiVersion`, the record name, and `nodes: []`,
while `components/flows/flowGraphModel.ts` projects missing `nodes` as an empty canvas node and edge
set. That keeps a brand-new draft openable as a blank canvas.

This tolerance stops at the authoring projection boundary. Validation, publish, and the worker still
enforce the executable DSL shape; an empty or nodes-less definition cannot be published or executed.

## DSL → Temporal mapping

The DSL is the contract boundary (`services/internal-contracts/src/flow-definition.json` +
`flow-definition-mapping.json`). The interpreter
(`services/workflow-worker/src/workflows/DslInterpreterWorkflow.ts`) maps each construct to a
Temporal primitive:

| DSL construct | Temporal primitive |
| --- | --- |
| `sequence` | sequential `await` of each step |
| `parallel` | `Promise.all` over branch futures |
| `task` + `retryPolicy` | activity with a per-activity `RetryPolicy` |
| `branch` | `evaluateExpression` activity per arm; route to first truthy / `default` |
| `wait` | durable timer (`sleep`) |
| `approval` | signal (`setHandler` + `condition`), optionally raced against `sleep(timeout)` |
| `sub-flow` | child workflow (`executeChild`) inside a `CancellationScope` |
| `trigger.cron` | Temporal **Schedule** |
| `trigger.webhook` / `platform-event` | `StartWorkflowExecution` via the flow API |

The retry mapping is verbatim (`src/shared/mapping.ts`): `maxAttempts → maximumAttempts`,
`backoffCoefficient`, `initialInterval`, `maximumInterval`,
`nonRetryableErrors → nonRetryableErrorTypes`, and `timeouts.* → ActivityOptions.*Timeout`.

## Interpreter and determinism

There is **one** workflow type, `DslInterpreterWorkflow`, that interprets every flow — no
per-definition code generation. Everything in the workflow module runs inside the Temporal
deterministic V8 isolate and uses **only** SDK constructs (`proxyActivities`, `sleep`,
`condition`, `setHandler`, `executeChild`, `CancellationScope`) plus pure helpers from
`src/shared`. The determinism rules it must obey:

- **No host non-determinism** — no `Date.now`, `Math.random`, `fetch`, or I/O on the workflow
  path. These would diverge on replay.
- **CEL evaluation is an activity, not inline** — branch conditions are evaluated by the
  `evaluateExpression` *activity* so the expression engine's internals stay off the deterministic
  path (ADR-11 / design D4).
- **The definition is pinned at start.** The parsed definition is resolved once into a local
  `const` at workflow start (passed as workflow input, or loaded-by-reference and recorded in
  history). Nothing re-reads an external store, so publishing a new version never reaches an
  in-flight run — **version pinning** is structural. The pinned version is `tenant.flowVersion`,
  falling back to the definition's `apiVersion`.

Inline definitions are size-guarded (reject > 3 MB) to stay within Temporal's payload headroom; a
larger definition uses the load-by-reference input. The SDK `WorkflowReplayer` is run over recorded
histories to catch determinism regressions.

### Node-ID naming convention

Every activity the interpreter dispatches sets its Temporal **`activityId` to the DSL node id**
(optionally suffixed `#<loopCounter>` for an iterated node), via `activityIdForNode`
(`src/shared/naming.ts`). Because `activityId` is surfaced verbatim on the
`ActivityTaskScheduled` history event:

```
history event ActivityTaskScheduled.activityId === DSL node.id   (or node.id#<n>)
```

every history event maps back unambiguously to a canvas node — **no custom header parsing**. This
is the normative monitoring contract; the SSE monitoring path and the run view depend on it, and
changing it is a breaking change.

## Tenancy model (as implemented)

Flows use a **shared Temporal namespace** (`falcone-flows`) — not a namespace per tenant — with
isolation enforced by server-stamped attributes and a structured workflow-ID. (ADR-11 measured
namespace-per-tenant scaling pollers/connections super-linearly; the shared model holds the fleet
flat.)

- **Workflow-ID scheme.** Every workflow id is
  `{tenantId}:{workspaceId}:{flowId}:{runUuid}`, generated **server-side** — clients never supply
  it (`buildWorkflowId` / `parseWorkflowId` in `flow-executor.mjs`). Before any Temporal command
  targeting an existing run, the executor verifies the id prefix matches the caller's tenant. A
  foreign prefix is a **404** on read paths (get/detail) and **403** on mutating run paths
  (cancel/retry/signal) — it never reveals whether the run exists for another tenant.
- **Search attributes (server-stamped).** Each start stamps five `Keyword` search attributes:
  `tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`
  (`searchAttributesFor`). They are set from the **verified identity**, never the client.
- **Visibility queries are non-overridable.** The list endpoint always injects
  `tenantId = '<identity>'` AND `workspaceId = '<identity>'` into the Temporal visibility query.
  Any client-supplied filter is **sanitized** — every `tenantId`/`workspaceId` clause is stripped
  before the residue is AND-joined with the authoritative server clause, and a filter that is
  entirely tenant-scoping collapses to empty. A crafted filter can only ever *narrow*
  (`sanitizeClientQuery` / `visibilityQuery`).

## Execution tokens (credential flow)

Activities touch tenant data stores (Postgres under RLS, workspace-scoped Mongo, storage, events,
functions) — so each must prove it is acting for the run's tenant. The mechanism is a short-lived,
workspace-scoped **execution token**, minted at start and validated at each activity before any
tenant data is touched.

```
control plane (start)                               worker / activity (use)
─────────────────────                               ───────────────────────
mintExecutionToken(tenantId, workspaceId)           dispatchTask(input)
  payload = { tenantId, workspaceId, expiresAt, jti }   └─ for a REGISTERED activity:
  key  = HMAC(platformSecret, tenantId"\n"workspaceId)       assertExecutionToken(token,
  sig  = HMAC(key, payload)                                     input.tenant.tenantId,
  token = base64url(payload) "." base64url(sig)                 input.tenant.workspaceId)
        │                                                         ├─ verify sig (constant-time)
        ├─ Temporal memo  ── falconeExecutionToken ──────────────┤  using the TOKEN's own claimed
        │  (not queryable, encrypted at rest)                    │  identity (forged identity fails)
        └─ tenant envelope ── tenant.executionToken ─────────────┤  ├─ tenant/workspace must match
                                                                  │  └─ expiry must not have passed
                                                                  └─ else NON-RETRYABLE failure,
                                                                     no tenant data accessed
```

- The signing key is **derived per workspace** from a single platform secret
  (`FLOW_EXECUTION_TOKEN_SECRET`), so the control plane (minting) and worker (validating) share it
  without distributing per-workspace material. The worker re-implements the *same* HMAC scheme
  (`services/workflow-worker/src/activities/execution-token.mjs`) and does **not** import from the
  control plane — both sides are byte-for-byte identical and round-trip-tested.
- Token expiry **never outlasts the run** (clamped to the max run duration). A missing, expired,
  or cross-tenant token fails the activity non-retryably (`EXECUTION_TOKEN_INVALID` /
  `EXECUTION_TOKEN_EXPIRED` / `EXECUTION_TOKEN_TENANT_MISMATCH`) — fail-closed.
- The token is carried in the **Temporal memo** (not a search attribute — memo is not queryable)
  and mirrored into the tenant envelope the interpreter passes to activities.

The actual store call uses a tenant-scoped `flc_service_…` credential with the `falcone_service`
DB role, so Postgres RLS / Mongo workspace scoping restricts every query to the tenant's own data.

## Trigger wiring

`flow-trigger-registry.mjs` is the single place that turns a published flow's `triggers[]` into
live listeners. Tenant context is always injected by the platform, never accepted from an external
caller. Triggers are registered on publish (v1) or atomically swapped (vN); in-flight v(N-1) runs
keep their pinned version.

| Kind | Wiring | Isolation |
| --- | --- | --- |
| **cron** | Temporal **Schedule**, id `{tenantId}:{workspaceId}:{flowId}`; overlap policy + catch-up window from the DSL (default `skip` / `1m`) | tenant+workspace encoded in the schedule id |
| **webhook** | per-trigger HMAC secret (`generateSigningSecret` + AES-256-GCM `encryptSecret`) stored in `flow_trigger_secrets`; returned **once** at publish | secret keyed by `(trigger_id, tenant_id, workspace_id)`; verified before any Temporal call |
| **platform-event** | a `flow_trigger_registrations` row keyed by the structural topic ref; a Kafka consumer group starts the bound flow on each match | physical topic names embed `tenantId`/`workspaceId` — cross-tenant fan-out is impossible |

Inbound webhooks are signed with `X-Platform-Webhook-Signature: sha256=<hex>` over the raw body
and an idempotency key `X-Platform-Webhook-Id`. An invalid/missing signature is `401` with **no
run started**; a replayed delivery id reuses a deterministic workflow id, so Temporal's id
uniqueness makes the second start a no-op (`202`, no second run). Flows use Temporal Schedules
**natively** — the standalone `services/scheduling-engine` job table is never touched, so a cron
expression never fires from both subsystems.

## SSE monitoring path

`flow-monitoring-executor.mjs` is the observability sibling of the flow executor. It mirrors the
realtime executor's `subscribe({ workspaceId, executionId, identity, signal, lastEventId, onEvent,
onError }) → { close }` shape so `server.mjs::runRealtimeSse` drives it verbatim.

```
EventSource ──?apikey=──▶ gateway ──▶ flow-monitoring-executor.subscribe()
   │                                     ├─ assert workflowId prefix == {tenantId}:{workspaceId}:  (else 403, before any history read)
   │                                     ├─ poll Temporal history every pollIntervalMs until terminal
   │                                     ├─ ActivityTaskScheduled.activityId ──▶ nodeId (drop #loop)  → node-status frame
   │                                     ├─ Last-Event-ID resume: skip frames whose seq ≤ supplied
   └─ node-status / log-line frames ◀────┴─ on terminal: replay history, emit `stream-end`, close
```

Tenant isolation is **fail-closed and structural**: the workflow-id prefix is checked *before* any
history is accessed — the streaming endpoint is the classic cross-tenant leakage vector and never
touches foreign history. Because a browser `EventSource` cannot set headers, the low-privilege
anon key is passed as `?apikey=`; the gateway verifies it and enforces tenant scope.

## Quotas and audit

- **Quota gate** (`flow-quota-gate.mjs`) enforces the five dimensions at the API boundary
  **before** any engine work. A `hard_blocked` / `soft_grace_exhausted` decision becomes `429`
  with `{ code: 'QUOTA_EXCEEDED', dimension }`. It reuses the platform quota decision model and
  **fails closed**: an evaluator error denies rather than allowing unbounded use.
- **Audit** (`services/audit/src/flow-lifecycle-events.mjs`) emits a tenant-scoped event for each
  of the eight lifecycle actions (`definition_created/updated`, `version_published`,
  `definition_deleted`, `execution_started/cancelled/retry`, `signal_sent`) into the existing
  audit pipeline, carrying `triggerType` on starts so autonomous runs are attributable.
- **Teardown** (`services/provisioning-orchestrator/src/appliers/workflows-applier.mjs`): a tenant
  purge cascades to the `workflows` domain with the same partial-failure semantics as the other
  domains — it terminates every running execution whose `tenantId` matches (paginated
  ListWorkflows + Terminate) and deletes `flow_versions`, `flow_schedules`,
  `flow_trigger_secrets`, `flow_trigger_registrations`, and `flow_definitions`, so no Temporal
  state, schedule, or per-trigger secret outlives the tenant. RLS migrations
  (`charts/in-falcone/bootstrap/migrations/2026…flow*.sql`) scope the metadata tables under
  `falcone_app`.

## Links

- [ADR-11 — Temporal for the durable workflow (flows) engine](/architecture/adrs#adr-11-temporal-for-the-durable-workflow-flows-engine)
- Normative spec: `openspec/specs/workflows/spec.md`
- Tenant guide: [Flows](/guide/flows) · Operations: [Flows Runbook](/architecture/flows-runbook)

# Flows (Workflow Engine)

**Flows** let a tenant automate multi-step backend logic — query the database, call a
function, publish an event, wait for a human approval, branch on a condition — as a single
**durable** workflow. A flow survives worker crashes and restarts: its state lives in the
platform's durable execution engine, not in a process. You author a flow as a small **YAML
DSL** (or visually on a canvas), publish an immutable **version**, and run it manually or from a
**trigger** (schedule, webhook, or platform event).

This page is the developer/tenant guide. For how it works internally see
[Flows Architecture](/architecture/flows); for deploy/operate see the
[Flows Runbook](/architecture/flows-runbook).

## Where flows live

Everything is scoped to a **workspace** inside your tenant. The API family is rooted at
`/v1/flows/workspaces/{workspaceId}/…` (`services/gateway-config/public-route-catalog.json`).
Authoring/management routes are `structural_admin`; running and observing executions are
`data_access`. As with every other capability, the tenant is derived from your verified
credential — never from a client-supplied header.

| Action | Method & path | Privilege |
| --- | --- | --- |
| List task types | `GET .../task-types` | `structural_admin` |
| Create / list flows | `POST` / `GET .../flows` | `structural_admin` |
| Get / update / delete a flow | `GET` / `PATCH` / `DELETE .../flows/{flowId}` | `structural_admin` |
| Validate a draft | `POST .../flows/{flowId}/validate` | `structural_admin` |
| Publish / list / get versions | `POST` / `GET .../flows/{flowId}/versions[/{version}]` | `structural_admin` |
| Start / list / get executions | `POST` / `GET .../flows/{flowId}/executions[/{executionId}]` | `data_access` |
| Cancel / retry an execution | `POST .../executions/{executionId}/cancellations` · `…/retries` | `data_access` |
| Send a signal (e.g. approval) | `POST .../executions/{executionId}/signals/{signalName}` | `data_access` |
| Live run events (SSE) | `GET .../executions/{executionId}/events` | `data_access` |
| Inbound webhook trigger | `POST .../triggers/webhooks/{triggerId}` | `data_access` |

## Designing on the canvas

The console flow **designer** (`apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx`,
`components/flows/**`) is a node graph. Drag node types from the **palette** (populated from the
`GET .../task-types` catalog), connect them, and fill each node's property panel. The designer
distinguishes the seven node types — `sequence`, `parallel`, `task`, `branch`, `wait`,
`approval`, `sub-flow` — and renders task inputs from the catalog schema, so a `db.query` task
shows the engine/operation/table fields and an `http.request` task shows the URL/method fields.

The canvas position/layout of each node is stored under a free-form `canvasMetadata` block in the
definition. It **round-trips verbatim and is ignored for execution** — moving a node never changes
behaviour (`flow-definition.json` `canvasMetadata`).

## YAML editing with schema autocomplete

A flow is, at heart, a YAML document. The console's **YAML editor**
(`components/flows/FlowYamlEditor.tsx`, Monaco + `monaco-yaml`) gives you schema-driven
autocomplete and on-the-fly validation: every keystroke runs the same `FLW-E…` semantic rules
the server enforces, anchoring each diagnostic to the offending line, and the **Save** button is
disabled while the document is invalid.

> [!NOTE]
> **Comment policy.** While you edit YAML directly, your comments stay in the editor buffer for
> that session. But the canvas works from the *structured* definition: the moment a flow
> round-trips **YAML → canvas → YAML** (e.g. you switch to the designer and back), comments are
> **discarded** and keys are re-emitted in a canonical, deterministic order with `canvasMetadata`
> always last (`apps/web-console/src/lib/flows/yaml-serialiser.ts`). Keep anything you must
> preserve inside fields (`description`, node `name`), not in `#` comments.

## The flow document

A flow document has a fixed shape (schema: `services/internal-contracts/src/flow-definition.json`,
`apiVersion: v1.0`):

| Field | Required | Purpose |
| --- | --- | --- |
| `apiVersion` | yes | DSL version — `v1.0` |
| `name` | yes | Human name |
| `description` | no | Free text |
| `inputs` | no | Typed input parameters: `{ <name>: { type, required?, default?, description? } }` (`type` ∈ `string`/`number`/`boolean`/`object`/`array`) |
| `triggers` | no | Cron / webhook / platform-event declarations (below) |
| `nodes` | yes (≥1) | The node graph — the **first node is the entry point** |
| `canvasMetadata` | no | Editor layout; ignored for execution |

### Node types

| `type` | Required fields | Behaviour |
| --- | --- | --- |
| `sequence` | `steps[]` | Run each listed node id in order, then go to `next` |
| `parallel` | `branches[]` (≥2) | Run all branch node ids concurrently, then go to `next` |
| `task` | `taskType` | Run a catalog activity (below); store its output; go to `next` |
| `branch` | `arms[]` | Evaluate each arm's `when` (CEL) in order; route to the first truthy arm's `next`, else `default` |
| `wait` | `duration` | Durable timer for an ISO-8601 duration, then `next` |
| `approval` | — | Block until a human approval signal (optionally `timeout`), then `next` |
| `sub-flow` | `flowId`, `flowVersion` | Run another published flow as a child, then `next` |

Every node has a unique `id` (your stable handle — it is also how the node shows up in
monitoring). A `branch` needs **at least two arms, or one arm plus a `default`**.

## Task-type reference

Task nodes invoke first-party **activities**. The catalog is fixed
(`services/workflow-worker/src/activities/`); each task's input/output schema below is the
authoritative contract the palette and validator use.

### `db.query` — relational / document query

Runs a PostgreSQL or MongoDB data operation **as your tenant**, under the same RLS / workspace
scoping as the data API.

- **Input:** `engine` (`postgres`|`mongo`, required), `operation` (required), plus
  `databaseName`, `schemaName`, `tableName` / `collectionName`, `rowId` / `documentId`, `filter`,
  `values` / `payload`, `page`.
- **Output:** `{ status: "success", result }`.

### `storage.put` — upload an object

- **Input:** `bucketId`, `objectKey`, `body` (base64), `contentType?` (all but `contentType` required).
- **Output:** `{ status: "success", objectKey, etag }`.

### `storage.get` — download an object

- **Input:** `bucketId`, `objectKey` (required).
- **Output:** `{ status: "success", objectKey, body (base64), contentType }`.

### `functions.invoke` — call a serverless function

- **Input:** `actionId` (required), `params?`.
- **Output:** `{ status: "success", activationId, result }`.

### `events.publish` — publish to the event bus

- **Input:** `topic`, `messages[]` (`{ key?, value }`) (required). The topic is scoped to your
  workspace; an empty `messages` array fails immediately.
- **Output:** `{ status: "success", topic, published }`.

### `http.request` — outbound HTTP/HTTPS

Calls a caller-supplied URL with an **SSRF guard** (it resolves and pins the target IP and blocks
internal addresses, so a flow cannot be used to reach cluster-internal services). It never
forwards your platform credentials and strips `authorization`/`cookie`/`x-api-key` headers.

- **Input:** `url` (required), `method?`, `headers?`, `body?`, `timeoutMs?` (≤30000),
  `maxResponseBytes?` (≤10 MiB).
- **Output:** `{ status: "success", httpStatus, body, headers }`.

### `email.send` — send email *(not yet available)*

Registered so it appears in the palette and validates, but invoking it currently fails with
`CAPABILITY_UNAVAILABLE` — there is no platform SMTP integration yet. It never silently succeeds.

> [!IMPORTANT]
> **Payload limits.** Each activity's serialized input and output are capped at **2 MiB**;
> exceeding either fails the task with `PAYLOAD_TOO_LARGE` (non-retryable). Keep task inputs and
> outputs small — pass identifiers, not large blobs.

## CEL expressions

`branch` arm conditions (`when`) are **CEL** (Common Expression Language) boolean expressions,
evaluated against the run's accumulated state. After a task runs, its output is stored in state
under the **task's node id**, so a downstream branch can read it:

```yaml
- id: decide
  type: branch
  arms:
    - when: 'checkStock.status == "success" && amount > 1000'
      next: approveLarge
  default: notify
```

Here `checkStock` is the id of an upstream task and `amount` is a declared flow input.

> [!WARNING]
> CEL has two rules that trip people up, both enforced by the validator (`FLW-E005`):
> - **Identifiers cannot contain hyphens.** A node referenced in an expression must have a
>   CEL-safe id (`checkStock`, not `check-stock`), because the expression reads its output by id.
> - **Use function-call form, not method form** — `size(x) > 0`, **not** `x.size() > 0`.
>
> Useful built-ins: `has(x.field)`, `size(list)`, comparison/logical operators (`==`, `!=`,
> `>`, `&&`, `||`), `x != null`.

## Retry policies

Any `task` node may carry a `retryPolicy`. The fields map directly onto the engine's activity
retry/timeout options:

| DSL field | Meaning |
| --- | --- |
| `maxAttempts` | Maximum attempts (≥1) |
| `backoffCoefficient` | Exponential backoff multiplier (≥1) |
| `initialInterval` | ISO-8601 duration for the first retry wait (e.g. `PT1S`) |
| `maximumInterval` | ISO-8601 cap on the retry wait (e.g. `PT30S`) |
| `nonRetryableErrors[]` | Error codes that must **not** be retried |
| `timeouts.startToClose` / `scheduleToClose` / `heartbeat` | Per-attempt timeouts |

Activities classify their own failures: deterministic problems (auth, schema, validation, SSRF
block, payload too large) are **non-retryable** and stop immediately; transient ones (network,
timeout, HTTP 429/502/503/504, broker unavailable) are **retryable** and honour your backoff.
Listing a code in `nonRetryableErrors` forces it to stop even if it would otherwise retry.

## Triggers

Declare triggers in the document's `triggers[]`. They become live when you **publish** a version.

### Cron

```yaml
triggers:
  - kind: cron
    schedule: "0 * * * *"   # POSIX cron, 5 or 6 fields (validated by FLW-E007)
```

The platform creates a durable schedule scoped to your workspace; the default overlap policy is
**skip** (no overlapping runs) with a 1-minute catch-up window.

### Webhook (with HMAC signing)

```yaml
triggers:
  - kind: webhook
    path: orders-created
```

Publishing returns a **per-trigger signing secret once** — store it; it is not shown again.
Inbound deliveries hit `POST .../triggers/webhooks/{triggerId}` and must carry an HMAC signature:

- **`X-Platform-Webhook-Signature: sha256=<hex>`** where `<hex>` is
  `HMAC-SHA256(secret, raw-request-body)`.
- **`X-Platform-Webhook-Id: <delivery-id>`** — an idempotency key; replaying the same delivery id
  is a no-op (`202`, no second run).

A missing or invalid signature is rejected with **`401`** and **no run is started** — the
signature is checked before anything else happens. (Implementation:
`services/webhook-engine/src/webhook-signing.mjs`,
`apps/control-plane/src/runtime/flow-trigger-registry.mjs`.)

### Platform event

```yaml
triggers:
  - kind: platform-event
    eventType: order.created
```

The platform subscribes to your workspace-scoped event stream and starts the flow on each
matching event. Topic names embed your tenant/workspace, so cross-tenant fan-out is impossible.

## Running and monitoring

Start a run manually:

```bash
curl -sX POST \
  $API/v1/flows/workspaces/$WS/flows/$FLOW/executions \
  -H "$H" -H 'content-type: application/json' \
  -d '{"version": 3, "input": {"orderId": "o-123", "amount": 4200}}'
# → { "executionId": "...", "status": "Running", "version": 3 }
```

Omit `version` to run the latest published version. Each run is **pinned** to the version it
started on; publishing a newer version never changes an in-flight run.

**Live node status** streams over SSE from
`GET .../executions/{executionId}/events`. The console run view
(`ConsoleFlowRunPage.tsx`, `flowsMonitoringApi.ts`) subscribes and colours each canvas node by
status as the run progresses: `scheduled`, `started`, `retrying`, `completed`, `failed`,
`skipped`, `waiting-approval`. Because a browser `EventSource` cannot send headers, the SSE route
accepts your low-privilege anon key as `?apikey=`.

**Run history** (`ConsoleFlowHistoryPage.tsx`) lists a flow's executions with filters on
**`flowVersion`**, **`status`**, and **`triggerType`** (cron / webhook / platform-event /
manual), paged by continuation token. The filters can only *narrow* — the tenant/workspace
boundary is always injected server-side and cannot be widened.

Mid-run controls: **cancel** (`…/cancellations`), **retry** (`…/retries`), and **send a signal**
(`…/signals/{signalName}`).

## Human approvals

An `approval` node pauses the run until a human approves (or it times out):

```yaml
- id: approveLarge
  type: approval
  approvers:
    - role:workspace_admin
  timeout: P1D          # optional ISO-8601; on timeout the run continues
  next: notify
```

Approve (or reject) by sending the approval signal to the waiting run:

```bash
curl -sX POST \
  $API/v1/flows/workspaces/$WS/flows/$FLOW/executions/$EXEC/signals/human-approval \
  -H "$H" -H 'content-type: application/json' \
  -d '{"approved": true, "actor": "alice", "nodeId": "approveLarge"}'
```

If a `timeout` is set and elapses first, the run resumes anyway with the timeout recorded in state
(so a later branch can react to it). In the console, a node awaiting approval shows the
`waiting-approval` status.

## Quotas and limits

Flows are metered on **five per-tenant / per-workspace dimensions**
(`services/provisioning-orchestrator/src/migrations/121-flow-quota-dimensions.sql`):

| Dimension | Scope | Default |
| --- | --- | --- |
| `max_flows` | stored definitions per tenant | 50 |
| `max_flow_versions` | published versions per flow | 20 |
| `max_concurrent_executions` | running executions per workspace | 10 |
| `flow_starts_per_minute` | start rate per workspace | 60 |
| `flow_signal_rate_per_minute` | signal calls per workspace per minute | 120 |

When a dimension is exhausted the API responds **`429`** with
`{ "code": "QUOTA_EXCEEDED", "dimension": "<which>" }` and **no work is done** (the gate runs
before any execution is started). Quota gates are checked *before* the engine is touched, so a
breach never leaves a half-started run.

## A complete example flow

This document validates against the published schema **and** the `FLW-E…` semantic validator with
the real task-type catalog (verified with `flow-definition-validator.mjs`):

```yaml
apiVersion: v1.0
name: order-fulfilment
description: >-
  On a new-order webhook, look up stock, branch on availability, ask a workspace
  admin to approve large orders, then publish a fulfilment event. Re-checked
  hourly by a cron trigger.
inputs:
  orderId:
    type: string
    required: true
  amount:
    type: number
    required: true
triggers:
  - kind: webhook
    path: orders-created
  - kind: cron
    schedule: "0 * * * *"
nodes:
  - id: root
    type: sequence
    steps:
      - checkStock
      - decide
    next: notify
  - id: checkStock
    type: task
    taskType: db.query
    input:
      engine: postgres
      operation: query
      schemaName: shop
      tableName: inventory
    retryPolicy:
      maxAttempts: 5
      backoffCoefficient: 2
      initialInterval: PT1S
      maximumInterval: PT30S
      nonRetryableErrors:
        - SCHEMA_ERROR
      timeouts:
        startToClose: PT1M
  - id: decide
    type: branch
    arms:
      - when: 'checkStock.status == "success" && amount > 1000'
        next: approveLarge
    default: notify
  - id: approveLarge
    type: approval
    approvers:
      - role:workspace_admin
    timeout: P1D
    next: notify
  - id: notify
    type: task
    taskType: events.publish
    input:
      topic: order.fulfilled
      messages:
        - value:
            status: fulfilled
```

Create it, validate it, and publish version 1:

```bash
# 1) create the draft (definition_yaml is the YAML above)
curl -sX POST $API/v1/flows/workspaces/$WS/flows -H "$H" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"order-fulfilment\",\"definition_yaml\": $(jq -Rs . < flow.yaml)}"

# 2) validate (returns FLW-E errors if any)
curl -sX POST $API/v1/flows/workspaces/$WS/flows/$FLOW/validate -H "$H"

# 3) publish — registers the webhook + cron triggers and returns the webhook secret ONCE
curl -sX POST $API/v1/flows/workspaces/$WS/flows/$FLOW/versions -H "$H"
```

## Validation error codes

The validator returns stable codes (`FLW-E001`…`FLW-E009`) — the same set in the editor, on
`validate`, and on `publish`:

| Code | Rule |
| --- | --- |
| `FLW-E001` | Node IDs must be unique |
| `FLW-E002` | The node graph must be acyclic |
| `FLW-E003` | Every referenced node id must exist |
| `FLW-E004` | A sub-flow's `flowId` + `flowVersion` must resolve |
| `FLW-E005` | Expressions must parse (CEL) |
| `FLW-E006` | `taskType` must be in the catalog |
| `FLW-E007` | A cron `schedule` must be a valid POSIX cron (5 or 6 fields) |
| `FLW-E008` | A wait `duration` must be a valid ISO-8601 duration |
| `FLW-E009` | A branch needs ≥2 arms, or 1 arm + a `default` |

See also: [Flows Architecture](/architecture/flows) · [Flows Runbook](/architecture/flows-runbook).

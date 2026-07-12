# Workflow DSL Reference

The complete reference for the **Flow Definition DSL** — the versioned document a tenant authors
(YAML in the console editor, JSON over the API) to define a [Flow](/guide/flows). The contract is
the JSON Schema `packages/internal-contracts/src/flow-definition.json` (`apiVersion: v1.0`), shared
by the console editors, the control-plane validate endpoint, and the Temporal interpreter worker.
Structural rules are enforced by the schema; semantic rules carry stable `FLW-E…` codes from the
companion validator (`flow-definition-validator.mjs`).

For the narrative guide see [Flows](/guide/flows); for operations see the
[Flows Runbook](/architecture/flows-runbook); for the decision record see
[ADR-11](/architecture/adrs#adr-11-temporal-for-the-durable-workflow-flows-engine).

::: tip Status — Preview
Flows is functionally complete (DSL, interpreter, triggers, console designer) and runs end-to-end on
the Temporal-backed engine, but is **Preview** under the platform's not-production-ready posture and
requires Temporal to be deployed. `email.send` is registered but not yet operational (see below).
:::

## Document shape

```yaml
apiVersion: v1.0          # required — closed enum, only "v1.0" today
name: order-fulfilment    # required — non-empty
description: Optional human description
inputs:                   # optional — typed parameters (see Inputs)
  orderId: { type: string, required: true }
  amount:  { type: number }
triggers: []              # optional — cron / webhook / platform-event (see Triggers)
nodes:                    # required — ≥1 node; the FIRST node is the entry point
  - id: step-1
    type: task
    taskType: http.request
    input: { url: "https://example.test/ping", method: GET }
canvasMetadata: {}        # optional — editor layout; ignored for execution
```

| Field | Required | Purpose |
| --- | --- | --- |
| `apiVersion` | yes | DSL version — only `v1.0` |
| `name` | yes | Human name (non-empty) |
| `description` | no | Free text |
| `inputs` | no | Typed input parameters (below) |
| `triggers` | no | Cron / webhook / platform-event (below) |
| `nodes` | yes (≥1) | The node graph — **the first node is the entry point** |
| `canvasMetadata` | no | Editor layout; round-trips verbatim, ignored for execution |

Every node has a unique `id` and a `type`. Nodes connect with `next` (and `steps`/`branches`/`arms`
for the composite types). A node `id` referenced in a CEL expression must be **CEL-safe** (no
hyphens), because expressions read a task's output by its node id.

## Minimal flow

The smallest valid document — one task node:

```yaml
apiVersion: v1.0
name: minimal
nodes:
  - id: ping
    type: task
    taskType: http.request
    input:
      url: "https://example.test/health"
      method: GET
```

## Inputs

Typed parameters supplied when a run starts. `type` ∈ `string` · `number` · `boolean` · `object` ·
`array`; each may set `required`, `default`, and `description`.

```yaml
inputs:
  orderId:
    type: string
    required: true
    description: The order to process.
  amount:
    type: number
    default: 0
```

## Node types

Seven node types. Each example below is independently valid.

### `task`

Runs a catalog activity, stores its output under the node `id`, then goes to `next`.

```yaml
- id: charge
  type: task
  taskType: http.request
  input: { url: "https://payments.test/charge", method: POST, body: { orderId: "o-1" } }
  retryPolicy: { maxAttempts: 3, initialInterval: PT1S }
  next: notify
```

### `sequence`

Runs the listed node ids in order, then goes to `next`.

```yaml
- id: prepare
  type: sequence
  steps: [validate, reserve-stock, charge]
  next: ship
```

### `parallel`

Runs **two or more** node ids concurrently, joins, then goes to `next`.

```yaml
- id: fan-out
  type: parallel
  branches: [email-customer, update-crm]   # ≥2 required
  next: done
```

### `branch`

Evaluates each arm's `when` (CEL boolean) in order; routes to the first truthy arm's `next`,
otherwise to `default`. A branch needs **≥2 arms, or one arm plus a `default`** (`FLW-E009`).

```yaml
- id: decide
  type: branch
  arms:
    - when: 'checkStock.status == "success" && amount > 1000'
      next: approveLarge
  default: notify
```

`checkStock` is an upstream task's id; `amount` is a declared input. CEL rules (`FLW-E005`):
identifiers cannot contain hyphens; use function-call form (`size(x) > 0`, not `x.size()`).

### `wait`

Durable timer for an ISO-8601 duration, then `next`.

```yaml
- id: cool-off
  type: wait
  duration: PT15M       # ISO-8601 (FLW-E008)
  next: retry-charge
```

### `approval`

Blocks until a human approval signal (optionally with a `timeout`), then `next`.

```yaml
- id: gate
  type: approval
  approvers: [ops-team]
  timeout: PT24H        # ISO-8601; optional
  next: release
```

Approve/reject by sending the signal to the waiting run:
`POST .../executions/{executionId}/signals/{signalName}`.

### `sub-flow`

Runs another **published** flow as a child, then `next`.

```yaml
- id: run-child
  type: sub-flow
  flowId: notify-customer
  flowVersion: "3"
  input: { orderId: "o-1" }
  next: done
```

## Task-type catalog

`taskType` must be one of the first-party catalog
(`apps/workflow-worker/src/activities/catalog-names.mjs`; membership enforced by `FLW-E006`).
Each activity's serialized input **and** output are capped at **2 MiB** (`PAYLOAD_TOO_LARGE`,
non-retryable).

| `taskType` | Required input | Notes / output |
| --- | --- | --- |
| `db.query` | `engine` (`postgres`\|`mongo`), `operation` | + `databaseName`, `schemaName`, `tableName`/`collectionName`, `rowId`/`documentId`, `filter`, `values`/`payload`, `page`. Runs **as your tenant** under RLS/workspace scoping. → `{ status, result }` |
| `storage.put` | `bucketId`, `objectKey`, `body` (base64) | + `contentType?`. → `{ status, objectKey, etag }` |
| `storage.get` | `bucketId`, `objectKey` | → `{ status, objectKey, body (base64), contentType }` |
| `functions.invoke` | `actionId` | + `params?`. → `{ status, activationId, result }` |
| `events.publish` | `topic`, `messages[]` (`{ key?, value }`) | Topic is workspace-scoped; empty `messages` fails. → `{ status, topic, published }` |
| `http.request` | `url` | + `method?`, `headers?`, `body?`, `timeoutMs?` (≤30000), `maxResponseBytes?` (≤10 MiB). SSRF-guarded; strips `authorization`/`cookie`/`x-api-key`. → `{ status, httpStatus, body, headers }` |
| `email.send` | — | **Not yet available** — validates and appears in the palette, but invoking it fails with `CAPABILITY_UNAVAILABLE` (no SMTP integration yet). |

Example `db.query` and `events.publish` tasks:

```yaml
- id: checkStock
  type: task
  taskType: db.query
  input:
    engine: postgres
    operation: list
    databaseName: app
    schemaName: public
    tableName: inventory
    filter: { sku: "SKU-1" }
  next: decide

- id: notify
  type: task
  taskType: events.publish
  input:
    topic: orders
    messages:
      - { key: "o-1", value: { event: "order.processed" } }
```

## Retry policies

Any `task` node may set `retryPolicy`; the fields map onto the engine's activity retry/timeout
options.

```yaml
retryPolicy:
  maxAttempts: 5
  backoffCoefficient: 2
  initialInterval: PT1S
  maximumInterval: PT30S
  nonRetryableErrors: [VALIDATION_FAILED]
  timeouts:
    startToClose: PT30S
    scheduleToClose: PT5M
    heartbeat: PT10S
```

Activities classify their own failures: deterministic problems (auth, schema, validation, SSRF
block, payload too large) are **non-retryable**; transient ones (network, timeout, HTTP
429/502/503/504) are **retryable** and honour your backoff.

## Triggers

Declare triggers in `triggers[]`; they become live when you **publish** a version. `kind` ∈
`cron` · `webhook` · `platform-event`.

```yaml
triggers:
  - kind: cron
    schedule: "0 * * * *"       # POSIX cron, 5 or 6 fields (FLW-E007)
  - kind: webhook
    path: orders-created        # POST .../triggers/webhooks/{triggerId}, HMAC-signed
  - kind: platform-event
    eventType: order.created    # subscribes to your workspace-scoped event stream
```

- **Webhook**: publishing returns a per-trigger signing secret **once**; deliveries must carry
  `X-Platform-Webhook-Signature: sha256=<hex>` and `X-Platform-Webhook-Id: <delivery-id>` (an
  idempotency key). A missing/invalid signature is `401` with no run started.
- **Cron**: a durable workspace-scoped schedule; default overlap policy is **skip**.
- **Platform event**: topic names embed your tenant/workspace, so cross-tenant fan-out is impossible.

## Publish and run

The DSL document rides the Flows API
(`/v1/flows/workspaces/{workspaceId}/flows/…`):

```bash
# 1. create a flow (draft)
curl -sX POST $API/v1/flows/workspaces/$WS/flows -H "$H" \
  -d '{ "name": "order-fulfilment", "definition": { ... } }'      # → { flowId }

# 2. validate the draft (semantic FLW-E checks)
curl -sX POST $API/v1/flows/workspaces/$WS/flows/$FLOW/validate -H "$H"

# 3. publish an immutable version (triggers go live here)
curl -sX POST $API/v1/flows/workspaces/$WS/flows/$FLOW/versions -H "$H"  # → { version }

# 4. start a run
curl -sX POST $API/v1/flows/workspaces/$WS/flows/$FLOW/executions -H "$H" \
  -d '{ "version": 1, "input": { "orderId": "o-1", "amount": 4200 } }'   # → { executionId, status }
```

Authoring/version management is `structural_admin`; running/observing executions is `data_access`.
Live execution status streams over SSE at `…/executions/{executionId}/events`.

# workflows Specification

## Purpose
TBD - created by archiving change add-flows-adr-temporal-spikes. Update Purpose after archive.
## Requirements
### Requirement: ADR for Temporal adoption is recorded
The system SHALL have a recorded architecture decision (ADR) for the Temporal-based workflow engine appended to `docs-site/architecture/adrs.md`, capturing: adoption rationale, TypeScript SDK selection with code evidence, chosen tenancy model, definition-passing strategy, chosen expression engine, PostgreSQL SQL visibility decision, and internal/operator-only UI stance.

#### Scenario: ADR exists with required decision fields
- **WHEN** a reviewer inspects `docs-site/architecture/adrs.md`
- **THEN** an ADR entry SHALL be present that includes all seven required decision fields: rationale, SDK choice with Node 22 ESM evidence, tenancy model, definition-passing strategy, expression engine, visibility store decision, and UI access stance

#### Scenario: SDK choice is grounded in code evidence
- **WHEN** the ADR states the TypeScript SDK is chosen
- **THEN** the ADR SHALL cite at minimum two code-level evidence points (Dockerfile FROM node:22 and `"type":"module"` in `apps/control-plane/package.json`) confirming no non-Node backend language is present in `apps/` or `services/`

### Requirement: Spike A demonstrates durable interpreter resume after worker kill
The system SHALL have a Spike A prototype proving that a Temporal TypeScript SDK worker executing a 3-node YAML-defined flow (containing one branch and one task with a retry policy) resumes and completes correctly after the worker process is killed mid-execution.

#### Scenario: Worker killed mid-run resumes to completion
- **WHEN** a Spike A prototype worker is killed mid-execution of a 3-node branch+retry flow
- **THEN** restarting the worker SHALL cause Temporal to replay history and the execution SHALL complete with the expected final state and no lost activity results

#### Scenario: Branch evaluation is deterministic on replay
- **WHEN** the Spike A interpreter replays a workflow that has already evaluated a branch condition
- **THEN** the branch outcome SHALL be identical to the original evaluation and no side-effects SHALL be re-executed

#### Scenario: Retry policy is honoured across worker restarts
- **WHEN** a task within the Spike A flow is configured with a retry policy and the worker is restarted after a task failure
- **THEN** Temporal SHALL retry the task according to the configured policy and the retry count SHALL be preserved from workflow history

#### Scenario: Definition-passing strategy is validated
- **WHEN** Spike A prototypes passing the flow definition as workflow input
- **THEN** the prototype SHALL demonstrate that the definition is recorded in workflow history and the replay is deterministic regardless of which worker picks it up

### Requirement: Spike A records an expression engine decision
The system SHALL produce a documented comparison between CEL and JSONata as expression engines for branch evaluation within the Temporal workflow sandbox, and SHALL record a single chosen engine as the outcome of Spike A.

#### Scenario: Expression engine comparison is documented
- **WHEN** Spike A is complete
- **THEN** the spike output SHALL include a comparison of CEL and JSONata covering: determinism guarantees in a Temporal workflow, bundle size impact on the worker, and ease of embedding in a Node 22 ESM module

#### Scenario: A single expression engine is selected
- **WHEN** the Spike A expression engine comparison is reviewed
- **THEN** exactly one engine SHALL be designated as the chosen engine in the ADR decision field

### Requirement: Spike B produces an evidence-based tenancy model comparison
The system SHALL have a Spike B prototype that implements both namespace-per-tenant and shared-namespace-plus-search-attributes tenancy models against a local Temporal dev server, and SHALL produce a comparison table covering isolation strength, poller and connection count per N tenants, and operational complexity.

#### Scenario: Namespace-per-tenant model is prototyped and measured
- **WHEN** Spike B implements the namespace-per-tenant approach
- **THEN** the prototype SHALL measure poller count and gRPC connection count as a function of tenant count and SHALL document worker-fleet scaling implications

#### Scenario: Shared-namespace model is prototyped and measured
- **WHEN** Spike B implements the shared-namespace model with `tenantId` custom search attributes
- **THEN** the prototype SHALL verify that visibility queries filtered by `tenantId` return only the correct tenant's workflow runs and SHALL measure connection overhead relative to the namespace-per-tenant approach

#### Scenario: Comparison table is produced
- **WHEN** both Spike B tenancy models have been prototyped
- **THEN** a comparison table SHALL exist with rows for: isolation boundary, poller count per N tenants, gRPC connection count per N tenants, and operational complexity rating

#### Scenario: A single tenancy model is selected and recorded in the ADR
- **WHEN** the Spike B comparison is complete
- **THEN** exactly one tenancy model SHALL be designated as chosen in the ADR, with the spike measurement data cited as evidence

### Requirement: Spike B validates PostgreSQL SQL visibility with custom search attributes
The system SHALL verify during Spike B that Temporal's SQL-based visibility store on PostgreSQL with custom search attributes is sufficient for run-history filtering needs, establishing that an Elasticsearch dependency is not required.

#### Scenario: Custom search attribute filters return correct results on PostgreSQL
- **WHEN** a Spike B workflow is tagged with a `tenantId` custom search attribute and a visibility query filters on that attribute against the PostgreSQL visibility store
- **THEN** the query SHALL return only workflows belonging to the specified tenant and no cross-tenant workflow runs SHALL appear in the result set

#### Scenario: PostgreSQL visibility sufficiency is recorded
- **WHEN** Spike B completes the visibility store validation
- **THEN** the ADR SHALL state whether PostgreSQL SQL visibility is sufficient or whether Elasticsearch is required, citing the spike evidence

### Requirement: Temporal integrated behind condition flag
The system SHALL render the entire Temporal server deployment behind a single `temporal.enabled` flag in `charts/in-falcone/values.yaml` (default `false`), so that Temporal can be toggled independently of all other components. Temporal is rendered by first-class umbrella templates under `charts/in-falcone/templates/temporal/**` rather than a `component-wrapper` alias, because the shared `component-wrapper` sub-chart renders only one Deployment + one Service per alias and cannot express Temporal's four role Deployments, Web UI, two lifecycle Jobs, five Services, and NetworkPolicy; image references still flow through the shared `component-wrapper.normalizeRepository` helper so `global.imageRegistry` (Harbor) rewriting continues to apply.

#### Scenario: Temporal disabled by default
- **WHEN** `charts/in-falcone` is installed or upgraded with `temporal.enabled` absent or set to `false`
- **THEN** no Temporal-related Kubernetes resources (Deployments, Services, Jobs, NetworkPolicies) are created

#### Scenario: Temporal enabled explicitly
- **WHEN** `charts/in-falcone` is installed with `temporal.enabled=true`
- **THEN** Temporal frontend, history, matching, and worker role Services and Deployments are created within the release namespace

### Requirement: PostgreSQL persistence and SQL visibility
The system SHALL configure Temporal to use PostgreSQL for both its primary persistence store and its SQL-based visibility store, with no Elasticsearch dependency.

#### Scenario: Default persistence store
- **WHEN** `temporal.enabled=true` and no external persistence override is supplied
- **THEN** Temporal uses the platform PostgreSQL service (or a dedicated DB per `postgresql.dedicatedTenantImage` pattern) as its persistence backend with connection parameters drawn from chart values

#### Scenario: SQL visibility without Elasticsearch
- **WHEN** Temporal is deployed with `temporal.enabled=true`
- **THEN** Temporal visibility queries are served by the PostgreSQL visibility store and no Elasticsearch pod or Service is created

### Requirement: Schema setup and upgrade jobs
The system SHALL provide a Helm Job that runs `temporal-sql-tool` to create or upgrade the Temporal persistence schema and visibility schema before the Temporal server pods become ready.

#### Scenario: Schema job runs on fresh install
- **WHEN** `helm install` is executed with `temporal.enabled=true` against a fresh namespace
- **THEN** a Kubernetes Job using the `temporal-sql-tool` image runs to completion, creating the required Temporal DB schemas, before the Temporal frontend Deployment is Available

#### Scenario: Schema upgrade job runs on helm upgrade
- **WHEN** `helm upgrade` is executed against a release where Temporal is already enabled
- **THEN** a Kubernetes Job runs the schema upgrade command and completes before any Temporal pod restart

### Requirement: Bootstrap job registers namespaces and custom search attributes
The system SHALL provide a Helm Job that, after the Temporal server is ready, registers the default Temporal namespace and the custom search attributes `tenantId`, `workspaceId`, `flowId`, `flowVersion`, and `triggerType` (all of type `Keyword`) via the Temporal CLI or SDK.

#### Scenario: Namespace registration on install
- **WHEN** `helm install` completes with `temporal.enabled=true`
- **THEN** a bootstrap Job runs to completion and the default Temporal namespace exists and is queryable

#### Scenario: Custom search attributes registered
- **WHEN** the bootstrap Job completes successfully
- **THEN** the attributes `tenantId`, `workspaceId`, `flowId`, `flowVersion`, and `triggerType` are registered in Temporal and a query against workflow history using any of those attributes does not return an error

### Requirement: ClusterIP-only internal networking
The system SHALL create all Temporal component Services as type `ClusterIP` only; no Service of type `LoadBalancer` or `NodePort` SHALL be created, and no Ingress, APISIX route, or OpenShift Route SHALL expose any Temporal endpoint.

#### Scenario: No external exposure on install
- **WHEN** `helm template` or `helm install` is run with `temporal.enabled=true` and default values
- **THEN** `kubectl get svc -l app.kubernetes.io/component=temporal` returns only Services of type `ClusterIP` and `kubectl get ingress,routes.route.openshift.io` returns no Temporal entries

### Requirement: NetworkPolicy restricting Temporal inbound access
The system SHALL create a Kubernetes `NetworkPolicy` for Temporal pods that allows inbound connections only from pods labelled as the flow API service or the flow DSL interpreter worker; all other inbound traffic to Temporal frontend port 7233 SHALL be denied.

#### Scenario: Unauthorized pod cannot reach Temporal gRPC port
- **WHEN** a pod without the flow API or worker label attempts a TCP connection to the Temporal frontend Service on port 7233
- **THEN** the connection is blocked by the NetworkPolicy

#### Scenario: Flow worker pod reaches Temporal gRPC port
- **WHEN** a pod bearing the flow DSL interpreter worker label connects to the Temporal frontend Service on port 7233
- **THEN** the connection is permitted

### Requirement: Operator-only Web UI access via port-forward
The system SHALL deploy the Temporal Web UI but SHALL NOT expose it via any Service of type LoadBalancer/NodePort, Ingress, APISIX route, or OpenShift Route; operator access SHALL be achieved exclusively through `kubectl port-forward`.

#### Scenario: Web UI not reachable from public ingress
- **WHEN** an HTTP request is sent to the platform's public API gateway hostname for any Temporal Web UI path
- **THEN** the gateway returns a 404 or no route is matched (no Temporal UI backend is registered)

#### Scenario: Web UI reachable via port-forward
- **WHEN** an operator runs `kubectl port-forward svc/<release>-temporal-web 8080:8080`
- **THEN** the Temporal Web UI is accessible at `http://localhost:8080`

### Requirement: Non-root and OpenShift SCC-compatible security configuration
The system SHALL render all Temporal pod specs with `securityContext.runAsNonRoot: true` and `seccompProfile.type: RuntimeDefault`; `fsGroup` SHALL NOT be pinned to a fixed UID so that OpenShift's restricted-v2 SCC can inject the namespace-assigned GID, consistent with the pattern in `deploy/openshift/values-openshift.yaml` for `apisix`, `keycloak`, `postgresql`, `kafka`, `storage`, and `observability`.

#### Scenario: OpenShift overlay renders without fixed fsGroup
- **WHEN** `helm template` is run with `-f deploy/openshift/values-openshift.yaml` and `temporal.enabled=true`
- **THEN** no Temporal pod spec contains a `securityContext.fsGroup` with a non-null numeric value

#### Scenario: Non-root assertion present on all Temporal pods
- **WHEN** `helm template` renders Temporal pod specs
- **THEN** every Temporal pod spec contains `securityContext.runAsNonRoot: true` and `securityContext.seccompProfile.type: RuntimeDefault`

### Requirement: values.schema.json extended for temporal block
The system SHALL add a `temporal` property to the root object in `charts/in-falcone/values.schema.json` so that `helm lint` and `helm template` pass without errors when `temporal.*` values are supplied; the `temporal` property SHALL NOT be added to the root `required` array (Temporal is an optional component).

#### Scenario: Helm lint passes with temporal block present
- **WHEN** `helm lint charts/in-falcone` is run after the schema extension
- **THEN** the command exits 0 with no validation errors related to the `temporal` key

#### Scenario: Helm install succeeds without temporal block
- **WHEN** `helm template` is rendered without any `temporal.*` override
- **THEN** the render succeeds and no schema validation error is emitted for a missing `temporal` key

### Requirement: Resource sizing defaults for Temporal components
The system SHALL define default CPU and memory `requests`/`limits` for each Temporal role (frontend, history, matching, worker) in `charts/in-falcone/values.yaml`, sized appropriately for a development/sandbox environment.

#### Scenario: Default resource values are present and non-empty
- **WHEN** `helm template` renders Temporal Deployment manifests with default values
- **THEN** each Deployment's container spec contains non-empty `resources.requests.cpu`, `resources.requests.memory`, `resources.limits.cpu`, and `resources.limits.memory` fields

### Requirement: Flow definition schema is published as a versioned JSON Schema artifact

The system SHALL publish a JSON Schema (Draft-07) file at
`services/internal-contracts/src/flow-definition.json` with `$id: "flow-definition"`,
`additionalProperties: false` on every top-level and node-level object, and an `apiVersion`
field whose value is constrained to a closed enum of supported DSL versions so that
consumers can detect incompatible documents at load time.

#### Scenario: Schema artifact has correct identity fields
- **WHEN** the file `services/internal-contracts/src/flow-definition.json` is parsed as JSON
- **THEN** the document MUST contain `"$schema": "http://json-schema.org/draft-07/schema#"`
- **THEN** the document MUST contain `"$id": "flow-definition"`
- **THEN** the top-level `required` array MUST include `"apiVersion"`, `"name"`, `"nodes"`

#### Scenario: Schema rejects documents missing apiVersion
- **WHEN** a candidate flow document omits the `apiVersion` field
- **THEN** JSON Schema validation MUST report a missing-required-property error for `apiVersion`

#### Scenario: Schema rejects unknown apiVersion values
- **WHEN** a candidate flow document carries `"apiVersion": "v99.0"`
- **THEN** JSON Schema validation MUST report an enum violation on the `apiVersion` field

#### Scenario: Schema rejects additional top-level properties
- **WHEN** a candidate flow document contains a top-level field not declared in the schema (e.g. `"unknownField": true`)
- **THEN** JSON Schema validation MUST report an `additionalProperties` violation

---

### Requirement: Flow header captures typed inputs and trigger declarations

The system SHALL define a `inputs` section as an object whose property values are typed
parameter descriptors (each with `type` drawn from `["string","number","boolean","object","array"]`
and an optional `required` boolean), and a `triggers` section as an array of trigger
objects where each trigger carries a `kind` field constrained to `["cron","webhook","platform-event"]`.

#### Scenario: Valid cron trigger passes schema validation
- **WHEN** a flow document contains `"triggers": [{"kind": "cron", "schedule": "0 9 * * 1-5"}]`
- **THEN** JSON Schema validation MUST succeed for the triggers section

#### Scenario: Trigger with unknown kind is rejected
- **WHEN** a flow document contains `"triggers": [{"kind": "timer"}]`
- **THEN** JSON Schema validation MUST report an enum violation on the `kind` field

#### Scenario: Input parameter with unsupported type is rejected
- **WHEN** a flow document declares an input with `"type": "date"`
- **THEN** JSON Schema validation MUST report an enum violation on the input descriptor `type` field

---

### Requirement: Node graph supports all required node types with stable IDs

The system SHALL define a `nodes` array where each element carries a stable `id` field
(non-empty string), a `type` field constrained to the closed enum
`["sequence","parallel","task","branch","wait","approval","sub-flow"]`, and a
type-specific properties block subject to `additionalProperties: false`.

#### Scenario: Task node with retryPolicy passes validation
- **WHEN** a flow document contains a node of type `task` with fields
  `{"id": "n1", "type": "task", "taskType": "send-email", "retryPolicy": {"maxAttempts": 3, "backoffCoefficient": 2.0}}`
- **THEN** JSON Schema validation MUST succeed for that node

#### Scenario: Node missing id field is rejected
- **WHEN** a flow document contains a node object that omits the `id` field
- **THEN** JSON Schema validation MUST report a missing-required-property error for `id`

#### Scenario: Node with unknown type is rejected
- **WHEN** a flow document contains a node with `"type": "loop"`
- **THEN** JSON Schema validation MUST report an enum violation on the node `type` field

#### Scenario: Sub-flow node requires flowId and flowVersion
- **WHEN** a flow document contains a node of type `sub-flow` that omits `flowVersion`
- **THEN** JSON Schema validation MUST report a missing-required-property error for `flowVersion`

#### Scenario: Parallel node carries a branches array
- **WHEN** a flow document contains a node of type `parallel` with a `branches` array containing two or more node-ID strings
- **THEN** JSON Schema validation MUST succeed for that node

---

### Requirement: Canvas metadata section round-trips without semantic impact

The system SHALL define an optional `canvasMetadata` top-level section typed as a
free-form object (`additionalProperties: true`) so that editor position data is preserved
across serialisation cycles; the schema and validator SHALL treat the presence or absence
of `canvasMetadata` as having no semantic meaning for execution.

#### Scenario: Flow document with canvasMetadata validates successfully
- **WHEN** a flow document includes `"canvasMetadata": {"nodes": {"n1": {"x": 100, "y": 200}}}`
- **THEN** JSON Schema validation MUST succeed and the canvasMetadata content MUST be preserved verbatim in serialisation

#### Scenario: Flow document without canvasMetadata validates successfully
- **WHEN** a flow document omits the `canvasMetadata` field entirely
- **THEN** JSON Schema validation MUST succeed

---

### Requirement: Semantic validation rules produce stable error codes

The system SHALL specify semantic validation rules — beyond what JSON Schema can express —
each assigned a stable error code of the form `FLW-E00N` that SHALL be used verbatim by
both editor diagnostics and API 422 response bodies.

The normative rule table is:

| Code | Rule |
|------|------|
| FLW-E001 | Node IDs MUST be unique within the flow document |
| FLW-E002 | The node graph MUST be acyclic (no cycle reachable via `next`, `branches`, or `onSuccess`/`onFailure` edges) |
| FLW-E003 | Every node ID referenced in an edge MUST exist in the `nodes` array |
| FLW-E004 | Every sub-flow node's `flowId` + `flowVersion` reference MUST be resolvable at validation time when a resolver is provided |
| FLW-E005 | Expression strings MUST be parseable by the configured expression engine |
| FLW-E006 | Every `taskType` value MUST exist in the task-type catalog provided to the validator |
| FLW-E007 | A cron trigger `schedule` field MUST be a valid POSIX cron expression (5 or 6 fields) |
| FLW-E008 | A `wait` node's `duration` field MUST be a valid ISO 8601 duration string |
| FLW-E009 | A `branch` node MUST have at least two condition arms or one condition arm plus a default arm |

#### Scenario: Duplicate node IDs produce FLW-E001
- **WHEN** a flow document contains two nodes that both carry `"id": "step-1"`
- **THEN** the semantic validator MUST return an error with code `FLW-E001`

#### Scenario: Cyclic edge produces FLW-E002
- **WHEN** a flow document contains node A with `"next": "B"` and node B with `"next": "A"` (a two-node cycle)
- **THEN** the semantic validator MUST return an error with code `FLW-E002`

#### Scenario: Dangling edge reference produces FLW-E003
- **WHEN** a flow document contains a node with `"next": "ghost-node"` where `ghost-node` does not appear in the `nodes` array
- **THEN** the semantic validator MUST return an error with code `FLW-E003`

#### Scenario: Valid flow passes all semantic rules
- **WHEN** a well-formed flow document with unique IDs, no cycles, and all references resolved is validated
- **THEN** the semantic validator MUST return an empty error list

---

### Requirement: DSL-to-Temporal mapping table is normative

The system SHALL include in the spec a normative mapping table binding each DSL construct
to its Temporal primitive so that the interpreter worker (add-flows-dsl-interpreter-worker)
and any future re-implementations MUST honour these bindings without divergence.

| DSL construct | Temporal primitive |
|---|---|
| `sequence` block | sequential activity invocations |
| `parallel` block | parallel activity futures (`Promise.all` equivalent) |
| `task` node + `retryPolicy` | Temporal activity with per-activity `RetryPolicy` |
| `wait`/`delay` node | Temporal durable timer (`sleep`) |
| `approval`/`human-approval` node | Temporal signal (`waitForSignal`) |
| `sub-flow` node | Temporal child workflow (`executeChild`) |
| cron trigger | Temporal Schedule |
| webhook / platform-event trigger | `StartWorkflowExecution` / `SignalWithStart` via the flow API |

#### Scenario: Spec document contains the mapping table
- **WHEN** the spec file `openspec/changes/add-flows-dsl-schema/specs/workflows/spec.md` is read
- **THEN** it MUST contain a table row mapping `task` to `Temporal activity with per-activity RetryPolicy`
- **THEN** it MUST contain a table row mapping `approval` node to Temporal signal

---

### Requirement: Example flow fixtures validate against the schema

The system SHALL provide at least five named example flow documents as JSON files under
`services/internal-contracts/src/fixtures/flows/`:

| Fixture file | Description |
|---|---|
| `minimal-3-node.json` | Linear sequence of three task nodes, no branching |
| `branch-retry.json` | Branch node with two condition arms; each task carries a retryPolicy |
| `parallel-fan-out.json` | Parallel block with three concurrent task branches |
| `human-approval.json` | Sequence containing an approval node followed by a task node |
| `sub-flow-ref.json` | Flow that references another flow by `flowId` + `flowVersion` |

Each fixture MUST pass JSON Schema validation against `flow-definition.json` with no errors.

#### Scenario: All five example fixtures validate successfully
- **WHEN** each fixture file in `services/internal-contracts/src/fixtures/flows/` is parsed and validated against the `flow-definition.json` schema
- **THEN** every fixture MUST produce zero JSON Schema validation errors

#### Scenario: A deliberately invalid fixture is rejected
- **WHEN** a test document containing a node with a missing `id` field is validated against `flow-definition.json`
- **THEN** JSON Schema validation MUST return at least one error

---

### Requirement: Unit/contract tests cover valid and invalid documents

The system SHALL include a test file `tests/contracts/flow-definition.contract.test.mjs`
that imports the schema from `services/internal-contracts/src/flow-definition.json`,
validates each of the five named fixtures, and asserts rejection for a documented set of
at least five invalid document shapes (missing `apiVersion`, unknown `apiVersion`, missing
node `id`, unknown node `type`, unknown top-level property).

#### Scenario: Contract test file is present and runnable
- **WHEN** `node --test tests/contracts/flow-definition.contract.test.mjs` is executed
- **THEN** all tests MUST pass with exit code 0

#### Scenario: Invalid document shapes each produce test failures on the invalid documents
- **WHEN** the contract test validates a document with a missing `apiVersion`
- **THEN** the test MUST assert that the validation result contains at least one error referencing `apiVersion`

---

### Requirement: Schema evolution policy governs apiVersion bumping

The system SHALL document and enforce the following schema evolution policy:

- Backward-compatible additions (new optional fields, new optional node types) bump the
  `apiVersion` minor segment (e.g. `v1.0` to `v1.1`) and the old version enum value
  remains valid.
- Breaking changes (removal of a node type, rename of a required field, tightening of an
  enum) require a new major `apiVersion` value (e.g. `v1.1` to `v2.0`) and the previous
  value MUST be removed from the enum only after the deprecation window defined in the
  governance catalog has elapsed.
- Stored flow definitions MUST be parseable against the schema version identified by their
  own `apiVersion` field; the system SHALL never silently coerce an old `apiVersion` to a
  newer one.

#### Scenario: A v1.0 flow document remains valid after a v1.1 additive change
- **WHEN** a new optional field is added to the schema under a new `apiVersion` value `v1.1`
- **THEN** a flow document carrying `"apiVersion": "v1.0"` MUST continue to pass schema validation because `v1.0` remains in the enum

#### Scenario: Removing an apiVersion value from the enum invalidates old documents
- **WHEN** `"v1.0"` is removed from the `apiVersion` enum (after the deprecation window)
- **THEN** a flow document carrying `"apiVersion": "v1.0"` MUST fail schema validation with an enum violation

### Requirement: DSL interpreter workflow definition
The system SHALL provide a single generic Temporal workflow, `DslInterpreterWorkflow`, that accepts a fully-resolved flow definition as input and executes it to completion without requiring a workflow type registration per flow definition version.

#### Scenario: Workflow executes a named flow definition
- **WHEN** a caller starts `DslInterpreterWorkflow` with a valid flow definition payload
- **THEN** the workflow engine begins executing the root sequence node of the definition without error

#### Scenario: Workflow input carries the definition inline
- **WHEN** the `DslInterpreterWorkflow` input contains the flow definition directly (inline strategy per ADR #356)
- **THEN** the workflow executes without scheduling an additional load-definition activity

#### Scenario: Workflow loads definition via activity when only flowId and version are supplied
- **WHEN** the `DslInterpreterWorkflow` input contains only a `flowId` and `version` reference
- **THEN** the workflow schedules a `loadFlowDefinition` activity, the result is recorded in Temporal history, and execution proceeds with the resolved definition

---

### Requirement: Execution version pinning
The system SHALL pin the flow definition version to the value resolved at workflow start so that publishing a new version of the same flow never alters the semantics of any in-flight execution.

#### Scenario: New version published while v1 execution is in-flight
- **WHEN** a `DslInterpreterWorkflow` instance is executing version 1 of a flow definition
- **AND** version 2 of the same flow is published
- **THEN** the in-flight instance continues executing version 1 semantics until it completes or is cancelled

---

### Requirement: Sequence node execution
The system SHALL execute nodes listed under a `sequence` node by awaiting each activity or sub-graph in declaration order, advancing only after the preceding step has completed or the workflow is cancelled.

#### Scenario: Sequential steps complete in order
- **WHEN** a flow definition contains a sequence of two task nodes A and B
- **THEN** task A activity completes before task B activity is scheduled

---

### Requirement: Parallel node execution
The system SHALL execute nodes listed under a `parallel` node by scheduling all branches as concurrent activity futures and awaiting all branches before advancing.

#### Scenario: Parallel branches run concurrently
- **WHEN** a flow definition contains a parallel node with branches X and Y
- **THEN** both branch activities are scheduled before either completes
- **AND** execution advances only after both branches have finished

---

### Requirement: Task node activity dispatch
The system SHALL execute a `task` node by invoking the corresponding registered activity and applying the per-task `RetryPolicy` from the DSL definition verbatim to the activity options.

#### Scenario: Task with custom retry policy
- **WHEN** a task node specifies `maxAttempts: 3` and `initialInterval: 2s`
- **THEN** the activity is scheduled with a `RetryPolicy` of `maximumAttempts: 3` and `initialInterval: 2s`
- **AND** no other retry defaults override those values

#### Scenario: Task with no retry policy
- **WHEN** a task node specifies no retry policy
- **THEN** the activity is scheduled with the Temporal SDK default retry policy

---

### Requirement: Wait (durable timer) node execution
The system SHALL execute a `wait` node by scheduling a durable Temporal `sleep` timer for the duration specified in the DSL, surviving worker restarts without data loss.

#### Scenario: Worker killed during wait timer
- **WHEN** a `DslInterpreterWorkflow` is suspended on a `wait` node timer
- **AND** the worker pod is terminated and restarted
- **THEN** the workflow resumes on the new worker, the timer fires at the originally scheduled wall-clock time, and execution continues to the next node

---

### Requirement: Human-approval signal node execution
The system SHALL execute an `approval` node by blocking via `setHandler` on a named signal channel and advancing when the signal is received; an optional timeout branch SHALL be taken if the timeout elapses before the signal arrives.

#### Scenario: Approval signal received before timeout
- **WHEN** a workflow is waiting on an `approval` node with a 24-hour timeout
- **AND** an external actor sends the approval signal within the window
- **THEN** the workflow advances on the approved path and the timeout timer is cancelled

#### Scenario: Approval timeout elapses without signal
- **WHEN** a workflow is waiting on an `approval` node with a 1-hour timeout
- **AND** no signal arrives before the timeout
- **THEN** the workflow advances on the timeout/rejection path

---

### Requirement: Sub-flow child workflow execution
The system SHALL execute a `subFlow` node by starting a child `DslInterpreterWorkflow` with the referenced flow definition and awaiting its completion, propagating cancellation to the child if the parent is cancelled.

#### Scenario: Parent cancelled while child sub-flow is running
- **WHEN** a parent `DslInterpreterWorkflow` is cancelled while a child sub-flow workflow is in progress
- **THEN** the cancellation is propagated to the child workflow via the Temporal `CancellationScope`
- **AND** both parent and child workflows terminate in a cancelled state

---

### Requirement: Branch node deterministic expression evaluation
The system SHALL evaluate branch conditions and data-mapping expressions using only the sandboxed deterministic engine selected per ADR #356 (CEL or JSONata), never via arbitrary JavaScript `eval` or `Function` constructor inside workflow code.

#### Scenario: Branch condition evaluated without arbitrary code execution
- **WHEN** a `branch` node condition expression is evaluated during workflow execution
- **THEN** the evaluation is performed by the sandboxed expression engine
- **AND** no non-deterministic host API (random, date, network) is invoked inside workflow code during the evaluation

#### Scenario: Invalid expression fails the workflow task with a non-retryable error
- **WHEN** a branch condition expression is syntactically invalid
- **THEN** the workflow task fails with a non-retryable application error identifying the offending node ID

---

### Requirement: Stable node-ID activity naming convention
The system SHALL encode the DSL node ID in every activity invocation such that each Temporal history event for an activity can be unambiguously mapped back to the originating DSL node; this encoding SHALL be the normative contract for monitoring (#366).

#### Scenario: History event maps back to DSL node ID
- **WHEN** a completed workflow history is exported
- **THEN** every `ActivityTaskScheduled` event contains the DSL node ID of the originating task node in its headers or `activityId` field
- **AND** a test that maps the exported history back to DSL node IDs finds no unmapped events

---

### Requirement: Workflow determinism — no non-deterministic API usage
The system SHALL ensure all workflow code (everything inside `DslInterpreterWorkflow` and any sub-workflow helpers) uses only Temporal SDK deterministic constructs; the SDK replayer SHALL pass on recorded production histories without non-determinism errors.

#### Scenario: Replayer passes on recorded history
- **WHEN** a Temporal SDK `WorkflowReplayer` is run against a recorded execution history for a completed `DslInterpreterWorkflow` instance
- **THEN** the replay completes without a `DeterminismViolationError`

---

### Requirement: Worker deployment — Dockerfile and runtime
The system SHALL build the workflow worker from a `services/workflow-worker/Dockerfile` using the `node:22-alpine` base image, running as the non-root `node` user, built from the repository root context consistent with `apps/control-plane/Dockerfile`.

#### Scenario: Container starts as non-root user
- **WHEN** the workflow worker container image is started
- **THEN** the process runs as UID corresponding to the `node` user in the `node:22-alpine` image
- **AND** the process does not have `root` privileges

---

### Requirement: Worker deployment — Helm component-wrapper wiring
The system SHALL wire the workflow worker as a `component-wrapper` dependency in `charts/in-falcone/Chart.yaml` under the alias `workflowWorker`, guarded by the `workflowWorker.enabled` condition, with a corresponding stanza in `values.yaml` and an extended `values.schema.json` referencing the existing `#/definitions/component` definition.

#### Scenario: Worker disabled by default
- **WHEN** `values.yaml` is applied without overrides
- **THEN** `workflowWorker.enabled` is `false` and no workflow worker Deployment is created

#### Scenario: Worker enabled in overlay
- **WHEN** an overlay sets `workflowWorker.enabled: true` with a valid image reference
- **THEN** the umbrella chart renders a workflow worker Deployment with the configured image

---

### Requirement: Worker graceful shutdown and probe configuration
The system SHALL configure liveness and readiness probes on the workflow worker Deployment and handle `SIGTERM` by allowing in-flight activity polls to drain before the process exits, consistent with health probe patterns in `charts/in-falcone/values.yaml`.

#### Scenario: Worker pod receives SIGTERM during idle poll
- **WHEN** Kubernetes sends `SIGTERM` to the workflow worker pod
- **THEN** the worker stops accepting new tasks, drains the current poll, and exits with code 0 within the configured `terminationGracePeriodSeconds`

---

### Requirement: Durable resume after worker kill
The system SHALL resume a workflow execution on a replacement worker after the original worker pod is killed mid-execution, with no loss of completed activity results stored in Temporal history.

#### Scenario: Worker pod killed mid-sequence execution
- **WHEN** a `DslInterpreterWorkflow` has completed the first task in a two-task sequence
- **AND** the worker pod is killed before the second task begins
- **THEN** a replacement worker picks up the workflow, replays history to reconstruct state, and executes the second task exactly once
- **AND** the first task is NOT re-executed

---

### Requirement: Task-queue and namespace binding per tenancy ADR
The system SHALL bind the worker to the Temporal task queue and namespace configuration resolved per the tenancy decision in ADR #356, reading queue name and namespace from environment variables at startup.

#### Scenario: Worker binds to configured task queue
- **WHEN** the worker starts with `TEMPORAL_TASK_QUEUE=flows-main` and `TEMPORAL_NAMESPACE=default`
- **THEN** the Temporal worker registers `DslInterpreterWorkflow` on task queue `flows-main` in namespace `default`

---

### Requirement: Real-stack Temporal service in test environment
The system SHALL add a `temporal` service (Temporal dev-server image) to `tests/env/docker-compose.yml` so that workflow worker real-stack tests can connect to a local Temporal server without Kubernetes.

#### Scenario: Tests/env stack includes Temporal
- **WHEN** `tests/env/up.sh` completes successfully
- **THEN** a Temporal server is reachable on its configured port and the workflow worker can register workflows against it

#### Scenario: TypeScript convention deviation documented
- **WHEN** a developer inspects `services/workflow-worker/package.json`
- **THEN** the package does NOT declare `"type": "module"` and its comments or a co-located note explain that the Temporal SDK's deterministic bundler requires the TypeScript/CommonJS compilation path rather than the repo-standard `.mjs` ESM convention


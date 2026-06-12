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
The system SHALL build the workflow worker from a `services/workflow-worker/Dockerfile` using the `node:22-slim` base image (glibc — required by the `@temporalio/core-bridge` native binary, which cannot load on Alpine/musl), running as the non-root `node` user, built from the repository root context consistent with `apps/control-plane/Dockerfile`.

#### Scenario: Container starts as non-root user
- **WHEN** the workflow worker container image is started
- **THEN** the process runs as UID corresponding to the `node` user in the `node:22-slim` image
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

### Requirement: Flow definitions SHALL be created, retrieved, updated, and deleted as draft heads per workspace

The system SHALL expose CRUD operations for flow definitions (draft head state) under `/v1/flows/workspaces/{workspaceId}/flows`, scoped to the authenticated tenant via `resolveIdentity` (`apps/control-plane/src/runtime/server.mjs::resolveIdentity`). The `tenant_id` and `workspace_id` are derived exclusively from the verified credential; request bodies MUST NOT supply them. The `flow_definitions` Postgres table SHALL have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with a policy equivalent to `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql`.

#### Scenario: Create a new flow definition
- **WHEN** an authenticated tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows` with a valid `name` and optional `definition_yaml`
- **THEN** the system persists a new row in `flow_definitions` keyed by `(tenant_id, workspace_id, flow_id)`, returns HTTP 201 with the created resource, and the row is inaccessible to any other tenant under `falcone_app` role

#### Scenario: List flow definitions returns only the requesting tenant's flows
- **WHEN** an authenticated tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows`
- **THEN** the response contains only flows belonging to that tenant's workspace, and rows from other tenants are never included in the result set

#### Scenario: Get a specific flow definition
- **WHEN** an authenticated tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}`
- **THEN** the system returns HTTP 200 with the draft head definition if it belongs to the tenant, or HTTP 404 if it does not exist or belongs to another tenant

#### Scenario: Update a flow definition draft
- **WHEN** an authenticated tenant sends `PATCH /v1/flows/workspaces/{workspaceId}/flows/{flowId}` with updated fields
- **THEN** the system updates only the draft head row, returns HTTP 200, and does not affect any published version rows in `flow_versions`

#### Scenario: Delete a flow definition
- **WHEN** an authenticated tenant sends `DELETE /v1/flows/workspaces/{workspaceId}/flows/{flowId}`
- **THEN** the system removes the draft head row and returns HTTP 200; the operation is rejected with HTTP 409 if there are active (non-terminal) executions referencing the flow

#### Scenario: Cross-tenant CRUD probe returns 404
- **WHEN** a tenant uses their valid token to request `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}` where `flowId` belongs to a different tenant's workspace
- **THEN** the system returns HTTP 404 and no flow data is disclosed

### Requirement: Flow validate SHALL return 422 with node-scoped error codes on invalid definitions

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate` which runs JSON Schema validation plus semantic rules (from #358) against the stored draft and returns a structured error envelope when validation fails. Each error entry SHALL include a `nodeId` identifying the offending DSL node and a machine-readable `code`. The endpoint SHALL return HTTP 200 when validation passes.

#### Scenario: Invalid YAML triggers 422 with node-scoped errors
- **WHEN** a tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate` and the stored draft contains a node that violates the JSON Schema
- **THEN** the system returns HTTP 422 with `{"errors":[{"nodeId":"<id>","code":"<ERROR_CODE>","message":"..."},...]}` and does not create any version

#### Scenario: Valid definition returns 200 with no errors
- **WHEN** a tenant sends the validate request and the stored draft satisfies all schema and semantic rules
- **THEN** the system returns HTTP 200 with `{"valid":true}`

#### Scenario: Validate does not mutate state
- **WHEN** the validate endpoint is called regardless of outcome
- **THEN** no `flow_versions` row is created and the `flow_definitions` draft head is unchanged

### Requirement: Flow publish SHALL freeze an immutable version and leave in-flight executions unaffected

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` which validates the current draft, persists an immutable row in `flow_versions` (`tenant_id`, `workspace_id`, `flow_id`, `version`, `definition_yaml`, `definition_json`, `dsl_api_version`, `created_by`, `created_at`), and returns HTTP 201. Published version rows SHALL be immutable: no UPDATE or DELETE is permitted by `falcone_app`. The `flow_versions` table SHALL have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with a tenant-and-workspace-scoped policy. Version numbers SHALL be assigned monotonically by the server.

#### Scenario: Publish succeeds for a valid draft
- **WHEN** a tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` and the draft passes validation
- **THEN** the system creates a new row in `flow_versions`, returns HTTP 201 with `{"version": N, "flowId": "..."}`, and the draft head remains editable

#### Scenario: Publish fails with 422 for an invalid draft
- **WHEN** a tenant sends the publish request and the current draft fails validation
- **THEN** the system returns HTTP 422 with node-scoped error codes and no version row is created

#### Scenario: Published version is immutable
- **WHEN** a second publish creates version 2 for the same flow
- **THEN** the version 1 row in `flow_versions` is unchanged and the `falcone_app` role cannot UPDATE or DELETE it

#### Scenario: In-flight executions on version 1 are unaffected by publishing version 2
- **WHEN** an execution started on version 1 is still running and a tenant publishes version 2
- **THEN** the running execution continues to use the version 1 definition and the Temporal workflow is not interrupted

### Requirement: Flow versions SHALL be listable and retrievable including the stored YAML

The system SHALL expose `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` (paginated list) and `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions/{version}` (single version, including `definition_yaml` for the console editor). Both endpoints are scoped by the tenant identity from `resolveIdentity`.

#### Scenario: List versions returns all published versions for the requesting tenant
- **WHEN** a tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions`
- **THEN** the response lists all published versions for that flow in ascending version order, and versions from other tenants are never included

#### Scenario: Get version includes the YAML definition
- **WHEN** a tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions/{version}`
- **THEN** the response body includes `definition_yaml` so the console editor can reconstruct the flow

#### Scenario: Get version for another tenant returns 404
- **WHEN** a tenant requests a version that exists but belongs to a different tenant
- **THEN** the system returns HTTP 404 and no definition data is disclosed

### Requirement: Flow executions SHALL be started pinned to a specific version

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` to start a new execution. The request body SHALL include a `version` (or default to latest published). The `flow-executor.mjs` module SHALL be the sole component constructing and submitting a Temporal workflow start request. The workflow ID SHALL be server-generated as `{tenantId}:{workspaceId}:{flowId}:{runUuid}` and MUST NOT be accepted from the client. Tenant context SHALL be injected as Temporal search attributes per the #356 model.

#### Scenario: Start execution returns 201 with the run reference
- **WHEN** a tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` with a valid `version` (or none, defaulting to latest)
- **THEN** the system starts a Temporal workflow, returns HTTP 201 with `{"executionId":"...","workflowId":"...","runId":"...","version":N}`, and the workflow ID matches `{tenantId}:{workspaceId}:{flowId}:{runUuid}`

#### Scenario: Workflow ID is never accepted from the client
- **WHEN** a tenant sends a start execution request with a `workflowId` field in the request body
- **THEN** the system ignores the client-supplied value and generates the canonical ID server-side; the returned `workflowId` matches the server pattern

#### Scenario: Start with a non-existent version returns 404
- **WHEN** a tenant requests execution with a `version` that has no corresponding row in `flow_versions` for that flow
- **THEN** the system returns HTTP 404 without submitting anything to Temporal

### Requirement: Flow execution list SHALL use Temporal visibility search attributes to scope results to the tenant

The system SHALL expose `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` which queries Temporal visibility using search attribute filters: `tenantId` and `workspaceId` (mandatory), plus optional `flowVersion` and `status`. The search attribute filter MUST always include `tenantId` equal to the identity's `tenantId`; the value MUST NOT be overridable by query parameters.

#### Scenario: List executions returns only the requesting tenant's runs
- **WHEN** a tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions`
- **THEN** the Temporal visibility query includes `tenantId = '<tenantId>'` as a non-overridable filter and the response contains only that tenant's workflow runs

#### Scenario: Status filter narrows results
- **WHEN** a tenant sends the list request with `?status=Running`
- **THEN** the Temporal visibility query includes the status filter and only running executions are returned

#### Scenario: Cross-tenant execution list probe returns empty
- **WHEN** a tenant uses their valid token but specifies another tenant's `workspaceId` in the path
- **THEN** the system enforces the identity-derived `tenantId` in the Temporal query and returns an empty list or 404, never exposing the other tenant's runs

### Requirement: Flow execution detail SHALL map Temporal history events to DSL node IDs

The system SHALL expose `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}` which fetches Temporal workflow execution history and maps activity/signal events to DSL node IDs using the naming convention from #359. The response SHALL include `status`, `startedAt`, `closedAt`, `input`, `result`, and an `events` array with `nodeId` fields.

#### Scenario: Get execution detail returns mapped events
- **WHEN** a tenant sends a get-detail request for a running or completed execution belonging to their workspace
- **THEN** the response includes an `events` array where each entry has a `nodeId` matching the DSL node naming convention from #359

#### Scenario: Get execution detail for another tenant returns 404
- **WHEN** a tenant requests execution detail where the `workflowId` prefix does not match `{identity.tenantId}:…`
- **THEN** the system returns HTTP 404 without fetching Temporal history

### Requirement: Flow executions SHALL be cancellable and retryable by the owning tenant

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/cancellations` (cancel) and `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/retries` (retry as a new run from the same version and input). Both operations MUST verify that the workflow ID prefix matches `{identity.tenantId}:` before submitting any Temporal command.

#### Scenario: Cancel a running execution
- **WHEN** a tenant sends `POST …/executions/{executionId}/cancellations` for an execution in Running state
- **THEN** the system sends a Temporal cancel request, returns HTTP 202, and the workflow transitions to Cancelled

#### Scenario: Cancel for another tenant's execution returns 403
- **WHEN** a tenant attempts to cancel an execution whose workflow ID prefix does not match their `tenantId`
- **THEN** the system returns HTTP 403 without sending any Temporal command

#### Scenario: Retry creates a new run pinned to the same version and input
- **WHEN** a tenant sends `POST …/executions/{executionId}/retries`
- **THEN** the system starts a new Temporal workflow with the same version and input as the original run, returns HTTP 201 with the new `executionId`, and the original run is unaffected

### Requirement: Human-approval signals SHALL be deliverable to running executions by the owning tenant

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/signals/{signalName}` to send a named signal (e.g., `human-approval`) to a running workflow. The `signalName` SHALL be validated against an allowlist derived from the DSL definition before being forwarded to Temporal. The operation MUST verify the `{tenantId}:` prefix of the workflow ID.

#### Scenario: Send a human-approval signal to a waiting execution
- **WHEN** a tenant sends `POST …/executions/{executionId}/signals/human-approval` with a valid `payload`
- **THEN** the system delivers the signal to the Temporal workflow via `flow-executor.mjs`, returns HTTP 202, and the workflow resumes

#### Scenario: Signal to another tenant's execution returns 403
- **WHEN** a tenant sends a signal request for an execution whose workflow ID prefix does not match their `tenantId`
- **THEN** the system returns HTTP 403 without sending any Temporal signal

#### Scenario: Unknown signal name returns 422
- **WHEN** a tenant sends a signal whose `signalName` is not present in the published DSL version's signal definitions
- **THEN** the system returns HTTP 422 with `{"code":"UNKNOWN_SIGNAL","message":"..."}` and does not forward the signal to Temporal

### Requirement: All flows routes SHALL be registered in the public route catalog with correct scope classes

The system SHALL add entries for every flows route to `services/internal-contracts/src/public-route-catalog.json` with `family: "flows"`, `scope: "workspace"`, `downstreamService: "control_api"`, `tenantBinding: "required"`, `workspaceBinding: "required"`, and `visibility: "public"`. Definition management routes (CRUD, validate, publish, versions) SHALL use `gatewayRouteClass: "control"`. Execution routes (start, list, detail, cancel, retry, signal) SHALL use `gatewayRouteClass: "data-control"`. Regenerated artifacts (`scripts/generate-public-api-artifacts.mjs`) SHALL be committed alongside the catalog change.

#### Scenario: Route catalog entries are present after catalog update
- **WHEN** `scripts/generate-public-api-artifacts.mjs` is run after adding the flows routes to the catalog
- **THEN** the generated artifacts include the `flows` family and all route entries are present with correct fields

#### Scenario: Definition-management routes use control class
- **WHEN** examining the catalog entry for `POST /v1/flows/workspaces/{workspaceId}/flows`
- **THEN** `gatewayRouteClass` is `"control"` and `tenantBinding` is `"required"`

#### Scenario: Execution routes use data-control class
- **WHEN** examining the catalog entry for `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions`
- **THEN** `gatewayRouteClass` is `"data-control"` and `tenantBinding` is `"required"`

### Requirement: Task-type registry
The system SHALL maintain a task-type registry that maps each task type name (string, e.g. `db.query`) to its Temporal activity implementation, its JSON Schema for the input envelope, and its JSON Schema for the output envelope. The registry SHALL be the single authoritative source consumed by DSL validation and the console palette. The registry's `resolveActivity` lookup SHALL reject an unknown task type name with error code `UNKNOWN_TASK_TYPE`. DSL validation (the control-plane validate/publish endpoint, fed the registry's task-type names as its `taskTypeCatalog`) SHALL reject a workflow definition that references an unknown task type at validation time with HTTP 422 and validation error code `FLW-E006`, persisting no workflow.

#### Scenario: Known task type accepted
- **WHEN** a workflow definition references task type `db.query`
- **THEN** the registry resolves it to the corresponding activity and its schemas without error, and DSL validation passes

#### Scenario: Unknown task type rejected
- **WHEN** a workflow definition references a task type name not present in the registry (e.g. `db.unknown`)
- **THEN** DSL validation returns HTTP 422 with validation error code `FLW-E006` (inside `FLOW_VALIDATION_FAILED`) and no workflow is persisted
- **AND** the registry's `resolveActivity` lookup for that name throws a non-retryable failure with error code `UNKNOWN_TASK_TYPE`

### Requirement: Tenant-scoped activity credentials
The system SHALL ensure that every first-party task-type activity executes API calls under a short-lived tenant-scoped `flc_service_…` API key (key type `service`, db role `falcone_service`) minted for the execution run. The system SHALL NOT use static platform credentials or the platform superuser role when invoking any first-party activity. The minted key SHALL be destroyed or expired after the execution run concludes.

#### Scenario: db.query executes under tenant credentials
- **WHEN** a `db.query` activity runs for workspace W of tenant T
- **THEN** the underlying `executePostgresData` call carries `identity.dbRole = "falcone_service"` and `identity.tenantId = T`, so RLS restricts the query to tenant T rows only

#### Scenario: Cross-tenant isolation via RLS
- **WHEN** a `db.query` activity for tenant A attempts to read rows belonging to tenant B (e.g. by specifying tenant B's workspace)
- **THEN** RLS enforced by the `falcone_service` role returns zero rows for tenant B data and does not expose tenant B information to tenant A

### Requirement: db.query activity
The system SHALL provide a `db.query` activity that accepts a Postgres or Mongo data-API operation envelope (database name, schema/collection, operation type, filter/values) and executes it via the existing `executePostgresData` / `executeMongoData` executor path, respecting RLS and the `falcone_service` db role. The activity SHALL propagate `tenantId` and `workspaceId` from the execution context into the executor `identity` parameter.

#### Scenario: Successful Postgres insert
- **WHEN** a `db.query` activity is invoked with `{ engine: "postgres", operation: "insert", databaseName: "d", schemaName: "public", tableName: "items", values: { name: "x" } }` and a valid tenant-scoped credential
- **THEN** the row is inserted with `tenant_id` stamped from the execution context and the activity returns `{ status: "success", result: { ... } }`

#### Scenario: RLS violation returns empty result
- **WHEN** a `db.query` activity attempts to `list` rows in a table where none belong to the executing tenant
- **THEN** the activity returns `{ status: "success", result: { items: [] } }` without error and without leaking other tenants' rows

#### Scenario: Non-retryable schema error
- **WHEN** a `db.query` activity references a table that does not exist
- **THEN** the activity throws a non-retryable Temporal `ApplicationFailure` with error code `SCHEMA_ERROR`

### Requirement: storage.put activity
The system SHALL provide a `storage.put` activity that uploads an object to a workspace-scoped storage bucket via the `uploadStorageObject` route (`PUT /v1/storage/buckets/{resourceId}/objects/{objectKey}`). The activity SHALL carry the tenant-scoped credential in the request and SHALL enforce that the bucket belongs to the executing workspace.

#### Scenario: Successful object upload
- **WHEN** a `storage.put` activity is invoked with `{ bucketId: "b1", objectKey: "uploads/file.txt", body: "<base64>", contentType: "text/plain" }` using a valid tenant-scoped credential
- **THEN** the object is stored and the activity returns `{ status: "success", objectKey: "uploads/file.txt", etag: "..." }`

#### Scenario: Cross-workspace upload rejected
- **WHEN** a `storage.put` activity presents a credential for workspace W1 but specifies a bucket belonging to workspace W2
- **THEN** the platform returns 403 and the activity throws a non-retryable `ApplicationFailure` with error code `FORBIDDEN`

### Requirement: storage.get activity
The system SHALL provide a `storage.get` activity that downloads an object from a workspace-scoped storage bucket via the `downloadStorageObject` route (`GET /v1/storage/buckets/{resourceId}/objects/{objectKey}/download`). The response body SHALL be returned base64-encoded in the activity output envelope.

#### Scenario: Successful object download
- **WHEN** a `storage.get` activity is invoked with `{ bucketId: "b1", objectKey: "uploads/file.txt" }` using a valid tenant-scoped credential
- **THEN** the activity returns `{ status: "success", objectKey: "uploads/file.txt", body: "<base64>", contentType: "text/plain" }`

#### Scenario: Object not found — non-retryable
- **WHEN** a `storage.get` activity references an object key that does not exist
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `OBJECT_NOT_FOUND`

### Requirement: functions.invoke activity
The system SHALL provide a `functions.invoke` activity that invokes a named tenant function via `invokeFunctionAction` (`POST /v1/functions/actions/{resourceId}/invocations`) using the tenant-scoped credential. The activity SHALL carry the workspace-scoped resource ID and SHALL NOT allow cross-workspace invocations.

#### Scenario: Successful function invocation
- **WHEN** a `functions.invoke` activity is invoked with `{ actionId: "fn-abc", params: { "key": "value" } }` using a valid tenant-scoped credential
- **THEN** the function executes and the activity returns `{ status: "success", activationId: "...", result: { ... } }`

#### Scenario: Function execution timeout — retryable
- **WHEN** the invoked function exceeds its execution time limit
- **THEN** the activity throws a retryable `ApplicationFailure` with error code `FUNCTION_TIMEOUT`

#### Scenario: Function not found — non-retryable
- **WHEN** the specified function `actionId` does not exist in the workspace
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `FUNCTION_NOT_FOUND`

### Requirement: events.publish activity
The system SHALL provide an `events.publish` activity that publishes one or more messages to a workspace-scoped logical Kafka topic via `events-executor.mjs::executeFunctions` (operation `publish`). Topic isolation SHALL follow the existing `evt.<workspaceId>.<topic>` physical-topic prefix model so that an activity can only publish to the executing workspace's own topics.

#### Scenario: Successful message publish
- **WHEN** an `events.publish` activity is invoked with `{ topic: "orders", messages: [{ value: "{}" }] }` using a valid tenant-scoped credential
- **THEN** the messages are published to physical topic `evt.<workspaceId>.orders` and the activity returns `{ status: "success", topic: "orders", published: 1 }`

#### Scenario: Empty messages array — non-retryable
- **WHEN** an `events.publish` activity is invoked with an empty `messages` array
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `EMPTY_PUBLISH` before making any Kafka call

### Requirement: http.request activity with SSRF guard
The system SHALL provide an `http.request` activity that makes outbound HTTP/HTTPS requests to caller-supplied URLs. The activity SHALL apply the same SSRF blocklist as `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` — blocking private IPv4/IPv6 ranges (RFC 1918, loopback, link-local 169.254.0.0/16, IPv6 link-local fe80::/10) and cloud metadata endpoints — both at URL resolution time and again after DNS resolution (DNS-rebinding defense). The activity SHALL enforce a configurable timeout (default 10 s, max 30 s) and a response body size cap (default 1 MiB, max 10 MiB). The activity SHALL NOT forward any tenant credential or internal header to the external target by default.

#### Scenario: SSRF blocked — link-local IP
- **WHEN** an `http.request` activity is invoked with `{ url: "https://169.254.169.254/latest/meta-data/", method: "GET" }`
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `SSRF_BLOCKED` and no outbound HTTP connection is opened

#### Scenario: SSRF blocked — decimal-encoded IP
- **WHEN** an `http.request` activity is invoked with `{ url: "https://2852039166/path", method: "GET" }` (decimal form of 169.254.169.254)
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `SSRF_BLOCKED`

#### Scenario: SSRF blocked — DNS-rebinding at execution time
- **WHEN** the target hostname resolves to a blocked address at request execution time (after passing static validation)
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `SSRF_BLOCKED` and no data is sent

#### Scenario: Legitimate public URL succeeds
- **WHEN** an `http.request` activity targets a public hostname resolving to a non-blocked address and the server responds 200
- **THEN** the activity returns `{ status: "success", httpStatus: 200, body: "...", headers: { ... } }`

#### Scenario: Response size cap exceeded
- **WHEN** the response body exceeds the configured size cap
- **THEN** the activity aborts the download and throws a non-retryable `ApplicationFailure` with error code `RESPONSE_TOO_LARGE`

#### Scenario: Request timeout — retryable
- **WHEN** the target server does not respond within the configured timeout
- **THEN** the activity throws a retryable `ApplicationFailure` with error code `REQUEST_TIMEOUT`

### Requirement: email.send activity deferred
The system SHALL register an `email.send` activity stub in the task-type registry. Until a platform SMTP capability is provisioned (no SMTP service exists in `services/` or `apps/` as of this change), the stub SHALL return a non-retryable `ApplicationFailure` with error code `CAPABILITY_UNAVAILABLE` and message `"email.send is not available: no platform SMTP configuration"`. The stub SHALL NOT silently succeed.

#### Scenario: email.send called with no SMTP config
- **WHEN** an `email.send` activity is invoked on a platform where no SMTP configuration is present
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `CAPABILITY_UNAVAILABLE`

### Requirement: Payload size limits
The system SHALL enforce a maximum serialized payload size of 2 MiB for every activity input envelope and 2 MiB for every activity output envelope (matching Temporal's recommended blob limit). An input exceeding the limit SHALL be rejected before any platform call with error code `PAYLOAD_TOO_LARGE`. An output exceeding the limit SHALL cause the activity to fail with error code `PAYLOAD_TOO_LARGE`.

#### Scenario: Oversized input rejected
- **WHEN** an activity is invoked with an input envelope whose serialized JSON exceeds 2 MiB
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `PAYLOAD_TOO_LARGE` before making any downstream call

#### Scenario: Normal-sized payload accepted
- **WHEN** an activity is invoked with an input envelope within the 2 MiB limit
- **THEN** no payload-size error is raised and the activity proceeds normally

### Requirement: Retryable vs non-retryable error classification
The system SHALL classify all activity failures as either retryable or non-retryable and propagate the classification via Temporal `ApplicationFailure.nonRetryable`. Transient platform errors (network timeouts, 503/429 responses, Kafka broker unavailability) SHALL be classified retryable. Deterministic errors (4xx client errors excluding 429, schema errors, SSRF blocks, missing resources, credential errors, `PAYLOAD_TOO_LARGE`) SHALL be classified non-retryable so the Temporal retry policy does not waste attempts on failures that cannot self-heal.

#### Scenario: Network timeout is retryable
- **WHEN** a `db.query` activity fails because the Postgres connection timed out
- **THEN** the `ApplicationFailure` is marked `nonRetryable: false` and Temporal retries according to the workflow retry policy

#### Scenario: 404 not-found is non-retryable
- **WHEN** a `functions.invoke` activity fails because the function does not exist (404 from platform)
- **THEN** the `ApplicationFailure` is marked `nonRetryable: true` and Temporal does not retry
</content>
</invoke>

### Requirement: Tenancy model enforced on every Temporal operation

The system SHALL verify the caller's `tenantId` and `workspaceId` (resolved exclusively via `resolveIdentity` from the API key or JWT, never from client-supplied request body fields) against the Temporal execution or visibility record before completing any describe, history, signal, cancel, or list operation. When the shared-namespace model is in use, the system SHALL stamp `tenantId` and `workspaceId` as Temporal search attributes at execution start server-side and include a mandatory filter on both attributes in every visibility query. When the namespace-per-tenant model is in use, the system SHALL route all Temporal calls for a tenant to that tenant's dedicated namespace and SHALL reject calls whose workflow ID does not begin with the `{tenantId}:` prefix.

#### Scenario: Tenant A cannot read Tenant B's execution via direct workflow ID

- **WHEN** tenant A's authenticated request includes a `workflowId` that was started by tenant B
- **THEN** the system MUST return HTTP 404 and MUST NOT include any tenant-B data in the response body

#### Scenario: Visibility query cannot be escaped by injecting extra search-attribute filters

- **WHEN** tenant A sends a list-executions request with crafted filter parameters that attempt to remove or override the server-injected `tenantId` search-attribute filter
- **THEN** the system MUST ignore the crafted filter fields, apply its own `tenantId = callerTenantId` constraint, and return only tenant A's executions

#### Scenario: Signal endpoint rejects forged workflow ID

- **WHEN** a request arrives at the signal or cancel endpoint with a `workflowId` whose embedded `tenantId` prefix does not match the caller's authenticated `tenantId`
- **THEN** the system MUST return HTTP 404 without forwarding the call to Temporal

#### Scenario: Task-queue naming prevents cross-tenant task pickup

- **WHEN** the workflow worker polls for tasks on a task queue derived from the tenant or namespace strategy chosen by the ADR
- **THEN** a worker bound to tenant A's task queue or namespace MUST NOT dequeue or execute activities belonging to tenant B

### Requirement: Workflow IDs are generated server-side and scoped to tenant

The system SHALL generate workflow IDs in the form `{tenantId}:{workspaceId}:{flowId}:{runUuid}` exclusively on the server; clients MUST NOT be able to supply, predict, or override a workflow ID in any execution-start request.

#### Scenario: Client-supplied workflowId is rejected at execution start

- **WHEN** a client submits an execution-start request that includes a `workflowId` field in the request body
- **THEN** the system MUST ignore the client-supplied value, generate its own namespaced workflow ID, and proceed using the server-generated ID

#### Scenario: Server-generated workflow ID contains the caller's tenantId

- **WHEN** the system starts an execution for tenant A workspace W and flow F
- **THEN** the resulting workflow ID MUST begin with `{tenantA}:{W}:{F}:` followed by a run-unique UUID suffix

### Requirement: Per-execution credentials are scoped to tenant and workspace and expire with the run

The system SHALL mint a short-lived service token for each execution start, scoped to exactly `{ tenantId, workspaceId }` of the triggering identity, carry it via Temporal headers or payload context, and ensure the token expiry does not outlast the maximum allowed flow run duration. Activities MUST validate the token before accessing any tenant data; a missing or expired token MUST cause the activity to fail with a non-retryable error.

#### Scenario: Token scope matches execution tenant and workspace

- **WHEN** a flow execution is started for tenant A workspace W
- **THEN** the per-execution token in the Temporal payload context MUST carry `tenantId = A` and `workspaceId = W` with no other tenants' identifiers

#### Scenario: Expired per-execution token causes activity failure

- **WHEN** an activity receives a Temporal payload context whose embedded token has passed its `expiresAt` timestamp
- **THEN** the activity MUST fail with error code `EXECUTION_TOKEN_EXPIRED` and MUST NOT access any tenant data store

#### Scenario: Token from a different tenant is rejected by activity

- **WHEN** an activity receives a token whose `tenantId` does not match the `tenantId` search attribute stamped on the workflow execution
- **THEN** the activity MUST fail with error code `EXECUTION_TOKEN_TENANT_MISMATCH` and MUST NOT process the task

### Requirement: Per-tenant and per-workspace quota dimensions limit flow resource consumption

The system SHALL enforce five quota dimensions for the `workflows` capability using the existing `quota-enforce` action: `max_flows` (stored flow definitions per tenant), `max_flow_versions` (published versions per flow), `max_concurrent_executions` (running executions per workspace), `flow_starts_per_minute` (execution start rate per workspace), and `flow_signal_rate_per_minute` (signal calls per workspace per minute). Exceeding a hard limit MUST result in HTTP 429 with a body indicating the breached dimension. One tenant saturating any quota dimension MUST NOT reduce throughput or increase latency for another tenant's flow operations.

#### Scenario: Exceeding concurrent-execution hard limit returns 429

- **WHEN** a workspace has reached its `max_concurrent_executions` hard limit and a new execution-start request arrives
- **THEN** the system MUST return HTTP 429 with `code: "QUOTA_EXCEEDED"` and `dimension: "max_concurrent_executions"` in the response body and MUST NOT start a new Temporal workflow

#### Scenario: Tenant A saturating start rate does not delay Tenant B

- **WHEN** tenant A has exhausted its `flow_starts_per_minute` quota and is receiving 429 responses
- **THEN** a concurrent execution-start request from tenant B with quota headroom MUST complete within normal latency bounds and MUST NOT be affected by tenant A's rate state

#### Scenario: Quota enforcement is consistent with existing quota-plans capability conventions

- **WHEN** a platform operator calls the quota effective-limits endpoint for a tenant's workspace with dimension key `max_concurrent_executions`
- **THEN** the response MUST include `effectiveLimit`, `quotaType`, `source`, and `currentUsage` fields in the same structure returned by existing quota dimensions such as `max_functions`

### Requirement: All flow lifecycle actions emit tenant-scoped audit events

The system SHALL emit an audit event to the existing audit pipeline for each of the following actions: flow definition created, flow definition updated, flow version published, flow definition deleted, execution started, execution cancelled, execution retry triggered, and signal sent. Every audit event MUST carry `tenantId`, `workspaceId`, `actorId`, `flowId`, `flowVersion` (where applicable), and `occurredAt` as non-nullable fields.

#### Scenario: Flow publish emits audit event with correct tenant context

- **WHEN** an authenticated user from tenant A workspace W publishes flow F as version V
- **THEN** the audit pipeline MUST receive an event with `eventType: "flow.version_published"`, `tenantId = A`, `workspaceId = W`, `flowId = F`, `flowVersion = V`, and `actorId` matching the authenticated identity

#### Scenario: Execution-start audit event contains all required fields

- **WHEN** an execution of flow F version V is started by actor U in tenant A workspace W
- **THEN** the audit pipeline MUST receive an event with `eventType: "flow.execution_started"`, `tenantId = A`, `workspaceId = W`, `flowId = F`, `flowVersion = V`, `actorId = U`, and a non-null `occurredAt` timestamp

#### Scenario: Signal audit event is tenant-scoped

- **WHEN** actor U from tenant A sends a signal to a running execution of tenant A's flow F
- **THEN** the audit pipeline MUST receive an event with `eventType: "flow.signal_sent"` carrying `tenantId = A` and `actorId = U`

### Requirement: Tenant deletion cascades to all workflows domain resources with no orphans

The system SHALL add a `workflows` domain entry to the `TEARDOWN_PLAN` in `tenant-purge-sweep.mjs` so that when a tenant is purged, all flow definitions, flow versions, schedules, and (per tenancy model) the Temporal namespace or all workflow executions owned by that tenant are removed. The teardown step MUST be idempotent and MUST follow the same partial-failure semantics as the existing six domain teardowns: on error the purge is NOT finalized, `purge.failed` is emitted, and the sweep is retried.

#### Scenario: Tenant purge removes all flow definitions and versions

- **WHEN** a tenant transitions to `state='purged'` and the `TEARDOWN_PLAN` workflows step executes
- **THEN** no `flow_definitions` or `flow_versions` rows for that tenant MUST remain in the database after the step completes successfully

#### Scenario: Temporal namespace or executions are removed on tenant purge

- **WHEN** the workflows teardown applier runs for a purged tenant
- **THEN** either the dedicated Temporal namespace is deleted (namespace-per-tenant model) or all workflow executions with `tenantId` matching the purged tenant are terminated and removed from visibility (shared-namespace model); no orphaned Temporal state remains

#### Scenario: Workflows teardown failure blocks finalization and emits purge.failed

- **WHEN** the workflows domain teardown step encounters an error during tenant purge
- **THEN** the system MUST NOT hard-delete service rows, MUST NOT transition the tenant to `state='purged'`, MUST emit `purge.failed` with `failedDomain: "workflows"`, and MUST leave the sweep eligible for retry

### Requirement: Cross-tenant isolation probe suite covers all flows routes and execution paths

The system SHALL include a black-box two-tenant probe suite (tenant A and tenant B provisioned as separate fixtures) that exercises every flows API route and execution observation path and asserts that every cross-tenant access attempt returns HTTP 404 or 403 with zero tenant data leakage in response bodies or error messages. The suite MUST include probes for: list flows, get flow, start execution, get execution detail, list executions, cancel execution, retry execution, send signal, get execution history, and observation/streaming endpoints if any.

#### Scenario: Tenant A cannot list Tenant B's flow definitions

- **WHEN** an authenticated request from tenant A targets the list-flows endpoint with tenant B's workspace ID
- **THEN** the system MUST return HTTP 403 or 404 and the response body MUST NOT contain any flow definition belonging to tenant B

#### Scenario: Tenant A cannot observe Tenant B's execution history

- **WHEN** tenant A sends a get-execution-history request using a workflow ID belonging to tenant B
- **THEN** the system MUST return HTTP 404 and MUST NOT include any event entries from tenant B's execution history

#### Scenario: Forged workflow ID with wrong tenant prefix returns 404

- **WHEN** a request arrives with a workflow ID whose `{tenantId}:` prefix does not match the caller's authenticated `tenantId`
- **THEN** the system MUST return HTTP 404 without making any Temporal API call

### Requirement: Flows section is reachable via dedicated console routes

The system SHALL register two lazy React Router v6 routes under `/console/flows` in
`apps/web-console/src/router.tsx`: a list route (`/console/flows`) rendered by
`ConsoleFlowsPage` and a designer route (`/console/flows/:flowId`) rendered by
`ConsoleFlowDesignerPage`. Both routes SHALL be wrapped in `ProtectedRoute` (matching
the pattern at `apps/web-console/src/router.tsx::RequireSuperadminRoute` and the lazy
imports of `ConsoleRealtimePage`). The Flows section bundle SHALL be code-split via
`React.lazy` so the `@xyflow/react` canvas library is not included in the initial shell
chunk.

#### Scenario: Navigating to /console/flows renders the flow list page
- **WHEN** an authenticated console user navigates to `/console/flows`
- **THEN** the system SHALL render `ConsoleFlowsPage` listing available flows for the active tenant
- **THEN** the `@xyflow/react` canvas bundle SHALL NOT have been loaded as part of the initial shell chunk

#### Scenario: Navigating to /console/flows/:flowId renders the designer
- **WHEN** an authenticated console user navigates to `/console/flows/some-flow-id`
- **THEN** the system SHALL render `ConsoleFlowDesignerPage` with the canvas editor for that flow
- **THEN** the route SHALL be protected and redirect to login when no valid session exists

#### Scenario: Unauthenticated access is rejected
- **WHEN** a request reaches `/console/flows` without a valid console session
- **THEN** the system SHALL redirect the user to `/login` via `ProtectedRoute`

---

### Requirement: Flow API service module wraps the control-plane flow endpoints

The system SHALL provide `apps/web-console/src/services/flowsApi.ts` exporting typed
helper functions that call the flow API (introduced by `add-flows-control-plane-api`)
using `requestConsoleSessionJson` from `apps/web-console/src/lib/console-session.ts`.
The module SHALL export at minimum: `listFlows`, `getFlow`, `createFlowDraft`,
`updateFlowDraft`, `validateFlow`, and `publishFlow`. Each function SHALL carry
TypeScript return-type annotations matching the DSL schema types from
`@falcone/internal-contracts`.

#### Scenario: listFlows returns tenant-scoped flow list
- **WHEN** `listFlows(tenantId, workspaceId)` is called with a valid tenant context
- **THEN** it SHALL call `GET /v1/flows/workspaces/{workspaceId}/flows` via `requestConsoleSessionJson`
- **THEN** it SHALL return a typed `{ items: FlowSummary[] }` result

#### Scenario: publishFlow calls the publish endpoint
- **WHEN** `publishFlow(flowId)` is called
- **THEN** it SHALL call `POST /v1/flows/{flowId}/publish` via `requestConsoleSessionJson`
- **THEN** it SHALL return an accepted/published status response

#### Scenario: validateFlow surfaces 422 errors with node IDs
- **WHEN** `validateFlow(flowId, definition)` receives a 422 response from the server
- **THEN** the rejected Promise SHALL carry an error object whose `body.errors` array includes entries with `nodeId` fields that can be mapped onto canvas nodes

---

### Requirement: Task-type registry service module provides dynamic palette data

The system SHALL provide `apps/web-console/src/services/taskTypeRegistryApi.ts` exporting
a `listTaskTypes(workspaceId)` function that fetches the server task-type catalog (from
`add-flows-activity-catalog` / `#360`). The function SHALL return a typed array of
`TaskTypeDescriptor` objects, each carrying at minimum `id`, `label`, `inputSchema`
(JSON Schema object for the property panel), and `category`. The palette component SHALL
call this function on mount and SHALL NOT hard-code task types.

#### Scenario: Palette renders task types from the server catalog
- **WHEN** `ConsoleFlowDesignerPage` mounts and the task-type catalog request succeeds
- **THEN** the palette SHALL display one draggable entry per `TaskTypeDescriptor` returned
- **THEN** no task type SHALL be statically coded in the palette component

#### Scenario: Palette gracefully handles catalog fetch failure
- **WHEN** the task-type catalog request fails (network error or 5xx)
- **THEN** the palette SHALL display an error state with a retry affordance
- **THEN** the canvas MUST still render existing nodes from the loaded flow definition

---

### Requirement: Canvas renders DSL nodes as typed custom node components

The system SHALL implement a custom `@xyflow/react` node type for each DSL construct:
`task`, `branch`, `parallel`, `wait`, `approval`, and `sub-flow`. Each node component
SHALL be styled using the existing Tailwind/Radix design system (using class names from
`apps/web-console/src/styles/globals.css` and `shadcn/ui` primitives already present in
`apps/web-console/src/components/ui/`). Node components SHALL accept a
`data.validationErrors` prop of type `ValidationError[]` and SHALL render an error badge
overlay when the array is non-empty.

#### Scenario: Task node displays task type label and retry badge
- **WHEN** a `task` node is rendered with `data.taskType = "send-email"` and `data.retryPolicy.maxAttempts = 3`
- **THEN** the node component SHALL display the task type label
- **THEN** the node component SHALL display a retry-count badge

#### Scenario: Node with validation errors shows an error badge
- **WHEN** a node receives a non-empty `data.validationErrors` prop (e.g. FLW-E006 for unknown taskType)
- **THEN** the node component SHALL render a visible error badge indicator
- **THEN** the error count SHALL be displayed on the badge

#### Scenario: Branch node renders correct number of output handles
- **WHEN** a `branch` node has two condition arms defined
- **THEN** the node component SHALL render exactly two labelled output handles plus one default handle

---

### Requirement: Connection rules enforce DSL graph semantics at interaction time

The system SHALL configure `@xyflow/react` connection validation callbacks to enforce
DSL graph rules before an edge is committed. The rules enforced at connection time SHALL
include: acyclicity (no path from target back to source exists after adding the proposed
edge), branch-node arity (a branch node's condition-arm handle may only have one outgoing
connection), valid handle pairs (a node's output handle may not connect to its own input
handle). Violations SHALL be silently rejected (the edge is not added) and SHALL produce
a user-visible inline message in the Problems panel.

#### Scenario: Connecting a node to itself is rejected
- **WHEN** a user attempts to drag an edge from a node's output handle back to the same node's input handle
- **THEN** the system SHALL discard the connection attempt
- **THEN** no self-loop edge SHALL appear in the graph

#### Scenario: Creating a cycle is rejected
- **WHEN** a user attempts to add edge B→A when path A→B already exists in the canvas graph
- **THEN** the system SHALL detect the cycle and discard the edge
- **THEN** the Problems panel SHALL display a message referencing the acyclicity rule (FLW-E002)

#### Scenario: Overfilling a branch arm handle is rejected
- **WHEN** a user attempts to connect a second outgoing edge to a branch node's single condition-arm handle
- **THEN** the system SHALL reject the connection
- **THEN** the existing connection on that handle SHALL remain unchanged

---

### Requirement: Property panels generate forms from task input JSON Schemas

The system SHALL render a per-node property panel when a node is selected on the canvas.
For `task` nodes, the panel SHALL generate form fields dynamically from the
`inputSchema` of the matching `TaskTypeDescriptor` returned by the task-type catalog.
The panel SHALL include: a retry-policy sub-form (fields: `maxAttempts` integer,
`backoffCoefficient` decimal, `initialInterval` ISO 8601 duration string), and expression
fields for string-typed inputs (rendered with syntax validation using the expression
syntax rule `FLW-E005`). All panel inputs SHALL be controlled React components whose
changes are immediately reflected in the in-memory DSL model.

#### Scenario: Selecting a task node opens its property panel
- **WHEN** a user clicks a `task` node on the canvas
- **THEN** the property panel SHALL appear and display form fields derived from the task type's `inputSchema`
- **THEN** changes to panel fields SHALL update the in-memory DSL model without requiring an explicit save

#### Scenario: Retry policy editor validates maxAttempts
- **WHEN** the user enters a non-integer value in the `maxAttempts` field of the retry-policy editor
- **THEN** the field SHALL display an inline validation error
- **THEN** the invalid value SHALL NOT be written to the DSL model

#### Scenario: Expression field rejects syntactically invalid expressions
- **WHEN** the user types an expression string that violates the expression engine syntax (FLW-E005)
- **THEN** the field SHALL display an inline syntax error
- **THEN** the error SHALL also appear in the Problems panel with code FLW-E005 and the node ID

---

### Requirement: Client-side semantic validation runs on every graph change

The system SHALL run the semantic validation rules `FLW-E001`…`FLW-E009` (as defined in
the `add-flows-dsl-schema` spec) against the in-memory DSL model after every structural
graph change (node add/remove, edge add/remove, property edit). Validation results SHALL
be node-scoped: each `ValidationError` SHALL carry a `nodeId`, `code`, and `message`.
The system SHALL distribute errors to the corresponding node components (via
`data.validationErrors`) so they render badge overlays, and SHALL aggregate all errors in
a Problems panel visible below or alongside the canvas.

#### Scenario: Duplicate node IDs produce FLW-E001 badge on affected nodes
- **WHEN** the in-memory DSL model contains two nodes with the same `id`
- **THEN** both affected node components SHALL render an error badge
- **THEN** the Problems panel SHALL list an entry with code `FLW-E001`

#### Scenario: Dangling edge reference produces FLW-E003 in Problems panel
- **WHEN** a node's `next` field references an ID that does not exist in the nodes array
- **THEN** the Problems panel SHALL display an entry with code `FLW-E003` and the originating node ID

#### Scenario: Clean graph shows no error badges and empty Problems panel
- **WHEN** the in-memory DSL model passes all semantic rules
- **THEN** no node SHALL render an error badge
- **THEN** the Problems panel SHALL be empty or hidden

---

### Requirement: Server 422 errors are mapped onto canvas nodes

The system SHALL intercept 422 responses from `validateFlow` and `publishFlow` API
calls. When the response body contains an `errors` array where entries carry a `nodeId`
field, the system SHALL map each error onto the corresponding canvas node by merging the
server error into that node's `data.validationErrors` array. Errors without a `nodeId`
SHALL be displayed in the Problems panel as flow-level errors.

#### Scenario: 422 response with nodeId errors decorates the correct nodes
- **WHEN** `publishFlow` returns a 422 with `errors: [{"nodeId": "step-1", "code": "FLW-E006", "message": "Unknown task type"}]`
- **THEN** the canvas node whose `id` is `"step-1"` SHALL render an error badge
- **THEN** the Problems panel SHALL display the error with code `FLW-E006`

#### Scenario: 422 response without nodeId shows as flow-level error
- **WHEN** `publishFlow` returns a 422 with `errors: [{"code": "FLW-E099", "message": "Flow name already exists"}]`
- **THEN** no individual node badge SHALL be added
- **THEN** the Problems panel SHALL display the error as a flow-level item

---

### Requirement: Canvas layout is persisted in the DSL canvasMetadata section

The system SHALL write each node's `{x, y}` position from the `@xyflow/react` layout
into the DSL `canvasMetadata.nodes` map (keyed by node ID) on every draft save, and
SHALL read initial positions from `canvasMetadata.nodes` when loading an existing flow
definition. Positions SHALL be floats in logical canvas pixels. The `canvasMetadata`
section SHALL NOT affect server-side execution semantics (consistent with the
`add-flows-dsl-schema` requirement for that section).

#### Scenario: Draft save writes node positions to canvasMetadata
- **WHEN** the user repositions a node to coordinates (320, 140) and saves the draft
- **THEN** the persisted flow definition SHALL contain `canvasMetadata.nodes["<nodeId>"] = {"x": 320, "y": 140}`

#### Scenario: Loading a flow restores node positions from canvasMetadata
- **WHEN** a flow definition is loaded that contains `canvasMetadata.nodes` entries
- **THEN** each canvas node SHALL be initialised at the position recorded in `canvasMetadata.nodes`

#### Scenario: Flow without canvasMetadata renders with auto-layout
- **WHEN** a flow definition is loaded that contains no `canvasMetadata` section
- **THEN** the designer SHALL apply a default auto-layout algorithm to position nodes
- **THEN** no error or warning SHALL be shown to the user

---

### Requirement: Draft save, load, and publish lifecycle is fully supported from the canvas

The system SHALL provide toolbar controls in `ConsoleFlowDesignerPage` for:
save-as-draft (calling `updateFlowDraft`), revert-to-saved (reloading the last persisted
draft), and publish (calling `publishFlow`). The publish action SHALL be disabled while
any `ValidationError` with a blocking severity is present in the client-side validation
result. After a successful publish the UI SHALL display a confirmation and reflect the
new published version.

#### Scenario: Save draft persists the current canvas state
- **WHEN** the user clicks "Save draft"
- **THEN** the system SHALL call `updateFlowDraft` with the current DSL model including `canvasMetadata`
- **THEN** the toolbar SHALL display a "Saved" confirmation and the unsaved-changes indicator SHALL clear

#### Scenario: Publish is blocked when blocking validation errors exist
- **WHEN** the Problems panel contains at least one error with blocking severity
- **THEN** the "Publish" button SHALL be disabled
- **THEN** a tooltip or inline message SHALL indicate that errors must be resolved first

#### Scenario: Successful publish updates the displayed version
- **WHEN** `publishFlow` returns a success response with a version number
- **THEN** the designer header SHALL display the new published version identifier
- **THEN** the "Publish" button SHALL return to enabled state (for future edits)

---

### Requirement: Component tests cover graph-to-DSL-model mapping and connection rules

The system SHALL include Vitest component tests under
`apps/web-console/src/__tests__/` that cover: serialising a multi-node canvas graph to
the DSL `nodes` array (including `canvasMetadata` positions), deserialising a DSL
definition back to `@xyflow/react` node and edge arrays, and rejecting illegal connections
(self-loop, cycle, overfull branch handle). Tests SHALL use `@testing-library/react`
(already in `apps/web-console/package.json` devDependencies). All new tests SHALL pass;
the pre-existing failing test set SHALL remain unchanged (the web-console vitest baseline
is broken on main — verification is new-tests-pass + unchanged failing set).

#### Scenario: Graph serialisation round-trip preserves node count and types
- **WHEN** a three-node canvas graph (task → branch → task) is serialised to DSL and deserialised back
- **THEN** the resulting `@xyflow/react` nodes array SHALL contain exactly three entries
- **THEN** each entry's `type` SHALL match the original DSL node type

#### Scenario: Self-loop connection rule test rejects invalid edge
- **WHEN** the connection-validation function is called with `source === target`
- **THEN** the function SHALL return `false`

#### Scenario: New tests pass without changing the pre-existing failing set
- **WHEN** `vitest run` is executed after adding the new test files
- **THEN** all new test files SHALL report 0 failures
- **THEN** the set of pre-existing failing tests SHALL be identical to the baseline recorded before this change

### Requirement: Monaco editor is loaded lazily as a code-split chunk

The system SHALL load `monaco-editor` and `monaco-yaml` only when the user navigates to
a Flows section that requires the YAML editor, using a dynamic `import()` call that Vite
resolves into a separate chunk, so that the root bundle size of the web console is not
increased by Monaco's footprint.

#### Scenario: Monaco chunk is absent from the initial bundle
- **WHEN** `vite build` is executed for the web console
- **THEN** the output directory MUST contain a distinct chunk file whose name includes
  `monaco` that is NOT referenced by the main entry chunk's static import graph

#### Scenario: Editor renders after lazy load
- **WHEN** a user opens the YAML editor view for a flow
- **THEN** the `FlowYamlEditor` component MUST mount successfully after the dynamic import
  resolves and MUST display the Monaco editor surface

---

### Requirement: Monaco editor is wired to the versioned DSL JSON Schema for autocomplete and diagnostics

The system SHALL configure the `monaco-yaml` language service with the `flow-definition.json`
JSON Schema from `@falcone/internal-contracts` so that the editor provides keyword
autocomplete, hover documentation, and inline structural diagnostics against the full DSL.

#### Scenario: Autocomplete suggests valid node types
- **WHEN** a user types `type: ` inside a node block in the YAML editor
- **THEN** the editor MUST offer autocomplete suggestions containing at least
  `sequence`, `parallel`, `task`, `branch`, `wait`, `approval`, and `sub-flow`

#### Scenario: Structural diagnostic appears for unknown node type
- **WHEN** the YAML editor contains a node with `type: loop` (not in the schema enum)
- **THEN** the editor MUST display a red marker on that line without any server round-trip

#### Scenario: Hover shows documentation for a known keyword
- **WHEN** a user hovers over the `apiVersion` key in the editor
- **THEN** the editor MUST show a hover tooltip sourced from the JSON Schema description
  for that field

---

### Requirement: Semantic validation error codes are surfaced as Monaco markers

The system SHALL run the semantic validation rules (FLW-E001…FLW-E009, specified in
add-flows-dsl-schema) client-side after every document change and attach the resulting
errors as Monaco editor markers so that each error is anchored to its source line.

#### Scenario: Duplicate node ID produces a FLW-E001 marker
- **WHEN** the YAML editor contains two nodes with the same `id` value
- **THEN** a Monaco marker with severity Error MUST appear on the line of the second
  duplicate node, carrying the code `FLW-E001`

#### Scenario: Clean document produces no semantic markers
- **WHEN** the YAML editor contains a well-formed flow document that passes all semantic rules
- **THEN** no semantic markers MUST be present in the editor (structural markers from the
  JSON Schema language service are evaluated independently)

---

### Requirement: YAML is the canonical document with deterministic serialisation

The system SHALL treat the YAML document as the single source of truth. When the canvas
serialises a graph to YAML it MUST use a stable key-order algorithm (keys emitted in the
order defined by the JSON Schema `properties` array, then alphabetically for
`additionalProperties`) so that repeated canvas→YAML round-trips produce byte-identical
output for the same logical graph.  The `canvasMetadata` section MUST always be
serialised as the last top-level key.

#### Scenario: Canvas edit produces stable YAML output
- **WHEN** the same graph is serialised to YAML twice in succession without modification
- **THEN** both serialisation outputs MUST be byte-identical strings

#### Scenario: canvasMetadata is last key
- **WHEN** a flow document with canvas position data is serialised to YAML
- **THEN** `canvasMetadata` MUST appear as the final top-level key in the YAML output

---

### Requirement: Comment-handling policy is explicit and enforced

The system SHALL document and enforce a comment normalisation policy: YAML comments
entered in the editor are preserved while the user edits YAML directly; when the user
switches from YAML to canvas and then back to YAML, comments from the previous YAML
session are discarded and the YAML is re-serialised from the in-memory graph model.
This policy MUST be stated in a code comment adjacent to the serialiser entry point.

#### Scenario: Comments survive a YAML-only edit session
- **WHEN** a user types a comment `# my note` in the YAML editor and then makes a
  further YAML edit without switching to canvas
- **THEN** the comment MUST still be present in the editor content

#### Scenario: Comments are discarded after a canvas round-trip
- **WHEN** a user adds a comment in YAML, switches to canvas view, moves a node, and
  switches back to YAML
- **THEN** the comment MUST NOT appear in the re-serialised YAML output

---

### Requirement: Graph-to-YAML-to-graph round-trip is lossless for all example fixtures

The system SHALL provide a property-based test that, for each fixture in
`services/internal-contracts/src/fixtures/flows/`, serialises the parsed graph to YAML
and then deserialises back to a graph, and asserts that the resulting graph is
structurally equal to the original (deep equality on all fields except `canvasMetadata`
which is compared independently).

#### Scenario: Round-trip identity over minimal-3-node fixture
- **WHEN** `minimal-3-node.json` is parsed into a graph, serialised to YAML, and
  deserialised back to a graph
- **THEN** the resulting graph MUST deeply equal the original graph

#### Scenario: Round-trip identity over branch-retry fixture
- **WHEN** `branch-retry.json` is parsed into a graph, serialised to YAML, and
  deserialised back to a graph
- **THEN** the resulting graph MUST deeply equal the original graph

#### Scenario: canvasMetadata survives round-trip
- **WHEN** a flow document with non-empty `canvasMetadata` is serialised to YAML and
  deserialised
- **THEN** the `canvasMetadata` object MUST deeply equal the original

---

### Requirement: View switcher provides canvas, YAML, and side-by-side modes

The system SHALL provide a `FlowViewSwitcher` component that renders three mutually
exclusive mode buttons (canvas, YAML, side-by-side). The active mode MUST be reflected
in the component's visible state. Switching modes MUST NOT discard unsaved edits.

#### Scenario: Default mode is canvas
- **WHEN** the `FlowViewSwitcher` is first mounted for a new flow
- **THEN** the canvas mode button MUST be marked active and only the canvas pane MUST
  be visible

#### Scenario: Switching to YAML renders the editor
- **WHEN** a user clicks the YAML mode button
- **THEN** the YAML editor pane MUST become visible and the canvas pane MUST be hidden

#### Scenario: Side-by-side renders both panes
- **WHEN** a user clicks the side-by-side mode button
- **THEN** both the canvas pane and the YAML editor pane MUST be visible simultaneously

---

### Requirement: Dirty-state tracking and conflict handling across views

The system SHALL track dirty state per view independently. When the user has unsaved
edits in YAML and switches to canvas, the system MUST serialise the YAML changes into
the graph model before rendering the canvas. If the YAML is syntactically invalid at
switch time, the system MUST block the switch, display an inline error message, and
leave the user in the YAML view.

#### Scenario: Switching from dirty YAML to canvas flushes edits
- **WHEN** the user edits the YAML (valid content) and then clicks the canvas mode button
- **THEN** the canvas MUST reflect the changes from the YAML before being shown

#### Scenario: Switching from invalid YAML to canvas is blocked
- **WHEN** the YAML editor contains syntactically invalid YAML and the user clicks the
  canvas mode button
- **THEN** the view switch MUST NOT complete, an error banner MUST be shown, and the
  user MUST remain in YAML view

---

### Requirement: Invalid YAML degrades gracefully without corrupting the stored draft

The system SHALL ensure that while the YAML editor holds syntactically or semantically
invalid content: (a) the canvas displays the last-valid graph with a visible warning
banner; (b) line-anchored Monaco markers identify every error; (c) the `PATCH /flows/:id`
draft-save endpoint is NOT called, preserving the last-valid stored draft.

#### Scenario: Canvas shows last-valid state during invalid YAML edit
- **WHEN** a user introduces a YAML syntax error in the editor
- **THEN** the canvas pane (if visible) MUST continue to display the graph from the
  last syntactically valid document and MUST show a warning banner

#### Scenario: Draft is not persisted while YAML is invalid
- **WHEN** the auto-save timer fires while the YAML editor holds an invalid document
- **THEN** no draft-save HTTP request MUST be issued to the server

#### Scenario: Recovery on valid edit clears the warning banner
- **WHEN** the user corrects the YAML error so that the document is valid again
- **THEN** the warning banner MUST be dismissed and the canvas MUST update to the
  corrected graph

---

### Requirement: New console component tests follow the broken-baseline rule

The system SHALL include vitest component tests for `FlowYamlEditor` and
`FlowViewSwitcher` that pass with the Vite 6 / jsdom / `@testing-library/react` 16
setup already present in `apps/web-console/vite.config.ts::test`. Adding these tests
MUST NOT cause any previously-passing test in the suite to begin failing; the
pre-existing broken-baseline test count MUST NOT increase.

#### Scenario: FlowYamlEditor component test passes
- **WHEN** `vitest run` is executed in `apps/web-console`
- **THEN** the test `FlowYamlEditor` MUST pass and the total number of failing tests
  MUST NOT exceed the count recorded before this change

#### Scenario: FlowViewSwitcher mode switching test passes
- **WHEN** `vitest run` is executed in `apps/web-console`
- **THEN** the test asserting that clicking YAML mode renders the editor surface MUST
  pass

### Requirement: Cron trigger — Temporal Schedule creation on publish
The system SHALL, when a flow version is published containing one or more cron triggers, create or update a Temporal Schedule for each cron trigger using the Temporal Schedules API; the schedule ID SHALL be namespaced as `{tenantId}:{workspaceId}:{flowId}` so that the tenant and workspace are structurally encoded and no schedule can be addressed across tenant boundaries; overlap policy and catch-up window SHALL be taken verbatim from the DSL trigger options.

#### Scenario: Publishing a flow version with a cron trigger creates a Temporal Schedule
- **WHEN** a tenant publishes flow version 1 containing a cron trigger with expression `0 * * * *` and overlap policy `skip`
- **THEN** the flow executor creates a Temporal Schedule with ID `{tenantId}:{workspaceId}:{flowId}`, spec `0 * * * *`, overlap policy `skip`, and the schedule fires `DslInterpreterWorkflow` at the next wall-clock hour boundary

#### Scenario: Schedule ID encodes tenant identity and cannot address another tenant's flow
- **WHEN** Tenant A publishes a flow and Tenant B attempts to reference the resulting schedule ID
- **THEN** the schedule ID prefix `{tenantA_id}:{workspaceId}:` is structurally incompatible with Tenant B's tenant namespace and Tenant B's flow executor rejects any cross-tenant schedule reference

---

### Requirement: Cron trigger — Temporal Schedule removal on unpublish
The system SHALL delete the Temporal Schedule associated with a flow trigger when the flow version is unpublished or the flow is deleted; no orphaned schedule SHALL remain after a successful unpublish operation.

#### Scenario: Unpublishing a flow version removes its Temporal Schedule
- **WHEN** a tenant unpublishes flow version 1 that previously had a cron trigger registered
- **THEN** the Temporal Schedule with ID `{tenantId}:{workspaceId}:{flowId}` is deleted and no further executions are scheduled by that cron trigger

#### Scenario: Schedule is removed even when the flow definition is also deleted
- **WHEN** a flow definition and all its versions are deleted
- **THEN** all Temporal Schedules associated with that flow are deleted before the deletion operation is acknowledged

---

### Requirement: Cron trigger — separation from scheduling-engine standalone jobs
The system SHALL NOT create or update scheduling-engine job records (table `scheduled_jobs` managed by `services/scheduling-engine/src/job-model.mjs`) for flow cron triggers; flow cron scheduling SHALL be handled exclusively via Temporal Schedules so that the two subsystems have disjoint execution paths and a single cron expression never fires twice from both systems.

#### Scenario: Publishing a flow with a cron trigger creates no scheduling-engine job
- **WHEN** a flow version containing a cron trigger is published
- **THEN** no row is inserted into the `scheduled_jobs` table and no scheduling-engine management action is invoked

---

### Requirement: Inbound webhook trigger — route and HMAC verification
The system SHALL expose a route `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` for receiving inbound webhook deliveries; before starting a workflow execution the system SHALL verify the HMAC-SHA256 signature in the `x-platform-webhook-signature` request header against the per-trigger secret stored in the `flow_trigger_secrets` table using `verifyIncomingWebhook` (reusing `services/webhook-engine/src/webhook-signing.mjs::verifyIncomingWebhook`); if signature verification fails the system SHALL return HTTP 401 and SHALL NOT start a workflow execution.

#### Scenario: Valid HMAC signature starts a workflow execution
- **WHEN** an inbound HTTP POST to `/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` carries a valid `x-platform-webhook-signature` header computed over the raw request body using the registered per-trigger secret
- **THEN** the system accepts the request, calls `StartWorkflowExecution` on the flow bound to `triggerId`, and returns HTTP 202

#### Scenario: Invalid HMAC signature is rejected with 401 and no run is started
- **WHEN** an inbound HTTP POST to `/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` carries an `x-platform-webhook-signature` header whose value does not match the per-trigger secret
- **THEN** the system returns HTTP 401 and does NOT call `StartWorkflowExecution`

#### Scenario: Missing signature header is rejected with 401
- **WHEN** an inbound HTTP POST to `/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` has no `x-platform-webhook-signature` header
- **THEN** the system returns HTTP 401 and does NOT call `StartWorkflowExecution`

---

### Requirement: Inbound webhook trigger — per-trigger HMAC secrets with tenant scope
The system SHALL generate a cryptographically random per-trigger HMAC secret on trigger registration using `generateSigningSecret` (32 random bytes, hex-encoded) and store the encrypted secret in a `flow_trigger_secrets` table with non-nullable `tenant_id` and `workspace_id` columns following the pattern established by `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`; a secret belonging to one tenant SHALL NOT be loadable by a query carrying a different tenant's `tenant_id`.

#### Scenario: Per-trigger secret row carries non-nullable tenant columns
- **WHEN** a webhook trigger is registered for Tenant A / Workspace W
- **THEN** the resulting `flow_trigger_secrets` row has `tenant_id` equal to Tenant A's ID and `workspace_id` equal to W's ID and neither column is NULL

#### Scenario: Cross-tenant secret lookup returns no rows
- **WHEN** a query for `flow_trigger_secrets` supplies a `trigger_id` belonging to Tenant A but a `tenant_id` belonging to Tenant B
- **THEN** the query returns zero rows and no secret material is disclosed

---

### Requirement: Inbound webhook trigger — replay deduplication via workflow-ID idempotency keys
The system SHALL derive a Temporal workflow-ID deduplication key from a delivery-ID header (e.g. `x-platform-webhook-id`) supplied by the sender; if a workflow with that derived ID is already running or completed the system SHALL return HTTP 202 without starting a second execution (idempotent delivery).

#### Scenario: Replayed delivery with the same delivery ID does not start a second execution
- **WHEN** an inbound POST with delivery ID `d-abc123` has already triggered a workflow execution
- **AND** the same POST is replayed with the same `x-platform-webhook-id: d-abc123` header
- **THEN** the system returns HTTP 202 and no new `DslInterpreterWorkflow` instance is started

---

### Requirement: Inbound webhook trigger — registered in the gateway allow-list
The system SHALL register the webhook trigger ingestion route in the authoritative gateway allow-list `services/gateway-config/public-route-catalog.json` with `privilege_domain: "data_access"`, consistent with the existing flows execution routes (which the gateway treats as high-frequency event-class data traffic). This follows the established convention for the `flows` family, whose routes live in the gateway-config allow-list rather than the generated `services/internal-contracts/src/public-route-catalog.json` (which is regenerated from the OpenAPI source by `validate:public-api` and does not carry the flows family — see `tests/blackbox/flows-api-route-catalog.test.mjs`).

#### Scenario: Route catalog entry is present in the gateway allow-list with the data-access domain
- **WHEN** the gateway allow-list is inspected for `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}`
- **THEN** the entry is present with `privilege_domain` equal to `"data_access"`

---

### Requirement: Platform-event trigger — Kafka and CDC topic subscription
The system SHALL, when a flow version with platform-event triggers is published, register consumer subscriptions matching the tenant's Kafka topics (`evt.{workspaceId}.{topic}` physical naming per `apps/control-plane/src/runtime/events-executor.mjs::physicalTopic`) and/or CDC topics (`{tenantId}.{workspaceId}.pg-changes`, `{tenantId}.{workspaceId}.mongo-changes` per `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` and `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic`); for each matching message the system SHALL forward the event payload as workflow input and call `StartWorkflowExecution`.

#### Scenario: Platform event on a subscribed topic starts the bound flow
- **WHEN** Tenant A publishes a flow with a platform-event trigger subscribed to topic `order-placed`
- **AND** a message is produced to the physical topic `evt.{workspaceA_id}.order-placed`
- **THEN** the flow executor calls `StartWorkflowExecution` for the bound flow with the message payload as input and the `triggerType` search attribute set to `platform_event`

#### Scenario: Unsubscribed topic events do not start any flow
- **WHEN** a message is produced to `evt.{workspaceA_id}.some-other-topic` for which no flow trigger subscription exists
- **THEN** no `StartWorkflowExecution` call is made

---

### Requirement: Platform-event trigger — cross-tenant isolation via structural topic namespacing
The system SHALL never start a flow belonging to Tenant A as a result of an event produced to a topic whose physical name begins with a prefix other than `evt.{workspaceA_id}.` or `{tenantA_id}.{workspaceA_id}.`; the structural namespacing of physical topic names (enforced by `physicalTopic` and `deriveTopic`) SHALL be the mechanism preventing cross-tenant event fan-out, with no additional runtime check required beyond consuming only the tenant's own physical topic set.

#### Scenario: Event from Tenant B's topic cannot trigger Tenant A's flow
- **WHEN** a message is produced to `evt.{workspaceB_id}.order-placed` (Tenant B's workspace)
- **AND** Tenant A has a flow subscribed to a trigger named `order-placed`
- **THEN** no flow execution is started for Tenant A because the consumer only subscribes to `evt.{workspaceA_id}.order-placed`

---

### Requirement: Platform-event trigger — at-least-once delivery with idempotent start
The system SHALL deliver platform-event trigger activations at-least-once; duplicate Kafka message deliveries SHALL be handled by using a deterministic workflow-ID deduplication key derived from the Kafka topic, partition, and offset so that replaying the same message offset does not start a second `DslInterpreterWorkflow` execution.

#### Scenario: Kafka message redelivery does not produce a duplicate workflow execution
- **WHEN** the flow executor consumer processes the same Kafka message offset twice due to a consumer group rebalance or crash recovery
- **THEN** only one `DslInterpreterWorkflow` execution is started; the second attempt with the same deduplication key is treated as a no-op by Temporal's workflow-ID uniqueness enforcement

---

### Requirement: Version swap on publish — atomic trigger replacement
The system SHALL, when publishing flow version N+1 over version N, atomically delete the trigger registrations for version N and create trigger registrations for version N+1 within the same logical transaction or Temporal Schedule update operation; in-flight version N workflow executions SHALL continue to completion on version N semantics and SHALL NOT be cancelled by the version swap.

#### Scenario: Publishing v2 replaces v1 triggers without stopping in-flight v1 runs
- **WHEN** a flow has version 1 with a cron trigger currently running an execution
- **AND** the tenant publishes version 2 with a modified cron trigger
- **THEN** the Temporal Schedule is updated to fire version 2 for future runs and the in-flight version 1 execution reaches completion without cancellation

#### Scenario: New triggers fire against the new version immediately after publish
- **WHEN** version 2 is published and the cron schedule fires
- **THEN** the new execution runs version 2 of the flow definition, not version 1

---

### Requirement: triggerType search attribute on every trigger-initiated start
The system SHALL stamp a `triggerType` search attribute on every `StartWorkflowExecution` call initiated by a trigger; valid values are `cron`, `webhook`, `platform_event`, and `manual`; the attribute SHALL be visible via Temporal visibility queries and is the normative contract for the monitoring sibling (#366).

#### Scenario: Cron-triggered execution carries triggerType = cron
- **WHEN** a Temporal Schedule fires and starts a `DslInterpreterWorkflow` execution
- **THEN** the execution's search attributes include `triggerType: "cron"`

#### Scenario: Webhook-triggered execution carries triggerType = webhook
- **WHEN** an inbound POST to the webhook trigger route with a valid HMAC starts a `DslInterpreterWorkflow` execution
- **THEN** the execution's search attributes include `triggerType: "webhook"`

#### Scenario: Platform-event-triggered execution carries triggerType = platform_event
- **WHEN** a Kafka platform-event consumer match starts a `DslInterpreterWorkflow` execution
- **THEN** the execution's search attributes include `triggerType: "platform_event"`

### Requirement: Execution SSE event stream
The system SHALL expose a Server-Sent Events endpoint `GET /v1/flows/workspaces/{workspaceId}/executions/{executionId}/events` that streams node-status and log-line events for a single workflow execution in near-real-time. The endpoint SHALL follow the existing SSE conventions: `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, `Cache-Control: no-cache`, `retry: 3000` reconnect hint, and a 25-second keep-alive ping comment. The endpoint SHALL accept the tenant API key via the `?apikey=` query parameter so that a browser `EventSource` (which cannot set headers) can authenticate. Header credentials SHALL take precedence over the query parameter.

#### Scenario: Successful stream connection
- **WHEN** an authenticated tenant client opens an `EventSource` to `GET /v1/flows/workspaces/{workspaceId}/executions/{executionId}/events?apikey=<anon-key>`
- **THEN** the server responds with HTTP 200, `Content-Type: text/event-stream`, and `X-Accel-Buffering: no`

#### Scenario: Node-status event emission
- **WHEN** the Temporal execution advances a node (scheduled / started / retrying / completed / failed / skipped)
- **THEN** the server emits an SSE frame `event: node-status` with a JSON data payload containing `nodeId`, `status`, `attemptNumber`, `startedAt`, `completedAt`, and optional `error`

#### Scenario: Log-line event emission
- **WHEN** the flow executor captures a log entry from an activity
- **THEN** the server emits an SSE frame `event: log-line` with a JSON data payload containing `nodeId`, `level`, `message`, and `timestamp`

#### Scenario: Keep-alive ping
- **WHEN** 25 seconds elapse without a data frame
- **THEN** the server emits an SSE comment `: ping` to keep the connection alive through proxy idle timeouts

#### Scenario: Client reconnect with last-event-id
- **WHEN** the client reconnects and supplies the `Last-Event-ID` header
- **THEN** the server resumes the stream from the event following the indicated position and does not re-emit already-delivered events

#### Scenario: Completed execution
- **WHEN** the execution has already reached a terminal state (completed / failed / cancelled / timed-out) before the client connects
- **THEN** the server replays all persisted history events as SSE frames and then emits `event: stream-end` before closing the connection

#### Scenario: Stream closed on client disconnect
- **WHEN** the client closes the connection
- **THEN** the server clears the 25-second ping interval and releases all Temporal SDK subscriptions associated with that stream

### Requirement: Execution SSE tenant isolation
The system SHALL enforce that the `tenantId` resolved from the presented credential matches the `tenantId` of the workspace identified by `{workspaceId}` in the SSE URL. A request whose credential maps to a different tenant SHALL be rejected with HTTP 403 before any Temporal history is accessed.

#### Scenario: Cross-tenant SSE probe rejected
- **WHEN** a client authenticated as tenant A requests the SSE stream for an execution belonging to tenant B's workspace
- **THEN** the server returns HTTP 403 and emits no event frames

#### Scenario: Invalid or missing API key
- **WHEN** a client supplies no credential or an unrecognisable `?apikey=` value
- **THEN** the server returns HTTP 401 before opening the stream

### Requirement: Run-view canvas overlay
The system SHALL render the flow designer canvas in read-only run mode, overlaying each DSL node with a status badge reflecting the latest `node-status` SSE event received for that node. The badge SHALL display the node status (scheduled / started / retrying / completed / failed / skipped), the current attempt number when greater than 1, and the elapsed or total duration. The canvas SHALL be non-interactive (no drag, no edit) while in run mode.

#### Scenario: Live status badge update
- **WHEN** a `node-status` SSE event is received for a node currently visible on the canvas
- **THEN** the node's badge updates within one render cycle to reflect the new status without a full page reload

#### Scenario: Node detail panel
- **WHEN** the user clicks a node in the run-view canvas
- **THEN** a detail panel opens showing the node's activity input payload (capped at 4 KB display), output payload (capped at 4 KB display), final error message and stack excerpt if the node failed, and a chronological list of attempt entries each with status and timestamps

#### Scenario: Completed run rendered from history
- **WHEN** the user opens the run view for an execution that has already reached a terminal state
- **THEN** all nodes are rendered with their final statuses derived from persisted Temporal history without requiring an open SSE connection

### Requirement: Run-history list
The system SHALL provide a paginated list view of workflow executions for a given flow, filterable by `flowId`, `flowVersion`, status, `triggerType`, and a time range (ISO 8601 `startedAfter` / `startedBefore`). The list SHALL be strictly scoped to the authenticated tenant's workspace.

#### Scenario: Filter by status
- **WHEN** the user selects a status filter (e.g. `failed`) in the run-history list
- **THEN** only executions with that status are displayed and the result set is tenant-scoped

#### Scenario: Pagination
- **WHEN** the result set exceeds the page size
- **THEN** the UI renders a next-page control that fetches the subsequent page using the continuation token returned by the list endpoint

#### Scenario: Empty result set
- **WHEN** no executions match the applied filters
- **THEN** the list view shows an empty-state message and no execution rows

#### Scenario: Cross-tenant isolation in list
- **WHEN** the list endpoint is called with a valid credential
- **THEN** it returns only executions belonging to the tenant identified by the credential, regardless of any `tenantId` supplied in query parameters

### Requirement: Cancel execution action
The system SHALL allow a tenant user to cancel a running workflow execution from the run view. The cancel action SHALL be guarded by a confirmation dialog. On confirmation, the system SHALL call the flows control-plane cancel endpoint and optimistically update the execution status in the UI. The action SHALL be recorded in the tenant audit log.

#### Scenario: Cancel confirmation dialog
- **WHEN** the user clicks the Cancel button on an in-progress execution
- **THEN** a confirmation dialog appears before any API call is made

#### Scenario: Successful cancel
- **WHEN** the user confirms cancellation
- **THEN** the system calls the cancel endpoint, the UI reflects the `cancelled` status, and an audit entry is created

#### Scenario: Cancel on already-terminal execution
- **WHEN** the user attempts to cancel an execution that has already completed or failed
- **THEN** the cancel button is disabled and no API call is made

### Requirement: Retry execution action
The system SHALL allow a tenant user to retry a failed or cancelled workflow execution by launching a new run with the same flow version and original trigger input. The retry action SHALL be guarded by a confirmation dialog and SHALL be audited.

#### Scenario: Retry confirmation dialog
- **WHEN** the user clicks Retry on a failed or cancelled execution
- **THEN** a confirmation dialog appears before any API call is made

#### Scenario: Successful retry
- **WHEN** the user confirms the retry
- **THEN** the system submits a new execution with the same `flowId`, `flowVersion`, and trigger input, the UI navigates to the new run view, and an audit entry is created

#### Scenario: Retry unavailable for running executions
- **WHEN** the execution is in a non-terminal state (scheduled / started / retrying)
- **THEN** the retry action is not presented in the UI

### Requirement: Approval signal action
The system SHALL allow a tenant user to send an approval or rejection signal to a human-approval node that is waiting for input. The signal action SHALL be guarded by a confirmation dialog and SHALL be audited.

#### Scenario: Approval signal confirmation dialog
- **WHEN** a node in the run view is in `waiting-approval` status and the user clicks Approve or Reject
- **THEN** a confirmation dialog appears identifying the node and the signal type before any API call is made

#### Scenario: Successful approval signal
- **WHEN** the user confirms the approval signal
- **THEN** the system calls the approval-signal endpoint with the resolved node signal ID, the node's badge updates to reflect the signal sent, and an audit entry is created

#### Scenario: Signal rejected for non-approval nodes
- **WHEN** a node is not in `waiting-approval` status
- **THEN** no approval or rejection controls are rendered for that node

### Requirement: Console component tests for flow monitoring
The system SHALL include Vitest component tests covering the run-view SSE subscription hook, the node-status badge rendering for each status value, the run-history list filters, and the cancel/retry/signal confirmation dialogs. All new tests SHALL pass. Pre-existing Vitest test failures on the main branch SHALL NOT be introduced or widened by this change.

#### Scenario: Node-status badge renders all statuses
- **WHEN** the node-status badge component receives each of the six status values (scheduled / started / retrying / completed / failed / skipped)
- **THEN** the rendered badge displays the correct label and styling for each status

#### Scenario: SSE hook closes subscription on unmount
- **WHEN** the run-view component is unmounted
- **THEN** the `EventSource` subscription is closed and no further state updates are dispatched


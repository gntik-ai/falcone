## ADDED Requirements

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

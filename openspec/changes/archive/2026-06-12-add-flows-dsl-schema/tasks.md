## 1. JSON Schema artifact

- [x] 1.1 Create `services/internal-contracts/src/flow-definition.json` with `$schema` Draft-07, `$id: "flow-definition"`, top-level required fields (`apiVersion`, `name`, `nodes`), `additionalProperties: false`, and `apiVersion` enum containing `"v1.0"`
- [x] 1.2 Add `definitions` block covering all node types: `sequence`, `parallel`, `task` (with nested `retryPolicy` definition), `branch` (condition arms + default arm), `wait`, `approval`, `sub-flow`
- [x] 1.3 Add `inputs` section definition (typed parameter descriptors with `type` enum and optional `required` boolean)
- [x] 1.4 Add `triggers` section definition (array of trigger objects with `kind` enum `["cron","webhook","platform-event"]` and type-specific optional fields)
- [x] 1.5 Add `canvasMetadata` top-level definition with `additionalProperties: true` (free-form, semantically ignored)
- [x] 1.6 Wire all node type definitions via a `oneOf` discriminator on the `type` field in the `nodes` array items sub-schema (base `node` carries the `type` enum so AJV emits an `enum` error on `/type` for unknown node types, per the spec scenario)

## 2. Index export

- [x] 2.1 Add URL constant `FLOW_DEFINITION_SCHEMA_URL` in `services/internal-contracts/src/index.mjs` pointing to `./flow-definition.json` (plus `FLOW_DEFINITION_MAPPING_URL`)
- [x] 2.2 Add named default export `flowDefinitionSchema` (with `{ type: 'json' }`) in `index.mjs`; also export `flowDefinitionMapping`, `validateFlowDefinition`, and `FLOW_VALIDATION_ERROR_CODES`

## 3. Example fixtures

- [x] 3.1 Create directory `services/internal-contracts/src/fixtures/flows/` (plus `fixtures/flows/invalid/` for the FLW-E-triggering documents)
- [x] 3.2 Write `minimal-3-node.json`: linear sequence of three task nodes, `apiVersion: "v1.0"`, no triggers or inputs
- [x] 3.3 Write `branch-retry.json`: branch node with two condition arms; each arm leads to a task node carrying a `retryPolicy`
- [x] 3.4 Write `parallel-fan-out.json`: parallel block with three concurrent task branches merging to a final task node
- [x] 3.5 Write `human-approval.json`: sequence containing one approval node followed by one task node
- [x] 3.6 Write `sub-flow-ref.json`: flow with a sub-flow node carrying `flowId` and `flowVersion` referencing a named child flow

## 4. Contract tests

- [x] 4.1 Create `tests/contracts/flow-definition.contract.test.mjs`; import `flow-definition.json` directly and use `ajv` to compile it
- [x] 4.2 Add test: each of the five fixtures in `fixtures/flows/` validates with zero errors
- [x] 4.3 Add test: document missing `apiVersion` fails with a `required` violation referencing `apiVersion`
- [x] 4.4 Add test: document with `apiVersion: "v99.0"` fails with an `enum` violation on `apiVersion`
- [x] 4.5 Add test: document with a node missing `id` fails with a `required` violation referencing `id`
- [x] 4.6 Add test: document with a node of type `"loop"` fails with an `enum` violation on `type`
- [x] 4.7 Add test: document with an unknown top-level field fails with an `additionalProperties` violation
- [x] 4.8 Verify `node --test tests/contracts/flow-definition.contract.test.mjs` exits 0

## 5. Semantic validation rule table (spec normative) + shared validator

- [x] 5.1 Confirm all nine error codes `FLW-E001` through `FLW-E009` appear in `specs/workflows/spec.md` with descriptions matching the normative table
- [x] 5.2 Confirm the DSL-to-Temporal mapping table covers all eight construct rows listed in the spec
- [x] 5.3 Implement the shared semantic validator `flow-definition-validator.mjs` (deviation recorded in design.md): all nine rules with node-scoped `{code, nodeId, message}` output, injectable CEL engine (`cel-js`) for FLW-E005, sub-flow resolver seam (FLW-E004), task-type catalog seam (FLW-E006); covered by `tests/unit/flow-definition-validator.test.mjs`
- [x] 5.4 Add `flow-definition-mapping.json` machine-readable bindings (error codes, DSL→Temporal, retryPolicy→Temporal, evolution policy) co-located in the contract package; covered by the contract test
- [x] 5.5 Add blackbox tests `tests/blackbox/flows-dsl-schema.test.mjs` (`bbx-flows-dsl-001`…`017`) exercising only the public surface

## 6. Validation and archive readiness

- [x] 6.1 Run `openspec validate add-flows-dsl-schema --strict` and resolve all errors
- [x] 6.2 Confirm no documentation files (README*, docs/) were modified

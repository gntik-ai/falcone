## 1. JSON Schema artifact

- [ ] 1.1 Create `services/internal-contracts/src/flow-definition.json` with `$schema` Draft-07, `$id: "flow-definition"`, top-level required fields (`apiVersion`, `name`, `nodes`), `additionalProperties: false`, and `apiVersion` enum containing `"v1.0"`
- [ ] 1.2 Add `definitions` block covering all node types: `sequence`, `parallel`, `task` (with nested `retryPolicy` definition), `branch` (condition arms + default arm), `wait`, `approval`, `sub-flow`
- [ ] 1.3 Add `inputs` section definition (typed parameter descriptors with `type` enum and optional `required` boolean)
- [ ] 1.4 Add `triggers` section definition (array of trigger objects with `kind` enum `["cron","webhook","platform-event"]` and type-specific optional fields)
- [ ] 1.5 Add `canvasMetadata` top-level definition with `additionalProperties: true` (free-form, semantically ignored)
- [ ] 1.6 Wire all node type definitions via a `oneOf` discriminator on the `type` field in the `nodes` array items sub-schema

## 2. Index export

- [ ] 2.1 Add URL constant `FLOW_DEFINITION_SCHEMA_URL` in `services/internal-contracts/src/index.mjs` pointing to `./flow-definition.json`
- [ ] 2.2 Add named default export `export { default as flowDefinitionSchema } from './flow-definition.json' with { type: 'json' }` in `index.mjs`

## 3. Example fixtures

- [ ] 3.1 Create directory `services/internal-contracts/src/fixtures/flows/`
- [ ] 3.2 Write `minimal-3-node.json`: linear sequence of three task nodes, `apiVersion: "v1.0"`, no triggers or inputs
- [ ] 3.3 Write `branch-retry.json`: branch node with two condition arms; each arm leads to a task node carrying a `retryPolicy`
- [ ] 3.4 Write `parallel-fan-out.json`: parallel block with three concurrent task branches merging to a final task node
- [ ] 3.5 Write `human-approval.json`: sequence containing one approval node followed by one task node
- [ ] 3.6 Write `sub-flow-ref.json`: flow with a sub-flow node carrying `flowId` and `flowVersion` referencing a named child flow

## 4. Contract tests

- [ ] 4.1 Create `tests/contracts/flow-definition.contract.test.mjs`; import `flow-definition.json` directly and use `ajv` (or the project's existing validator helper) to compile it
- [ ] 4.2 Add test: each of the five fixtures in `fixtures/flows/` validates with zero errors
- [ ] 4.3 Add test: document missing `apiVersion` fails with a `required` violation referencing `apiVersion`
- [ ] 4.4 Add test: document with `apiVersion: "v99.0"` fails with an `enum` violation on `apiVersion`
- [ ] 4.5 Add test: document with a node missing `id` fails with a `required` violation referencing `id`
- [ ] 4.6 Add test: document with a node of type `"loop"` fails with an `enum` violation on `type`
- [ ] 4.7 Add test: document with an unknown top-level field fails with an `additionalProperties` violation
- [ ] 4.8 Verify `node --test tests/contracts/flow-definition.contract.test.mjs` exits 0

## 5. Semantic validation rule table (spec-only, no code)

- [ ] 5.1 Confirm all nine error codes `FLW-E001` through `FLW-E009` appear in `specs/workflows/spec.md` with descriptions matching the normative table
- [ ] 5.2 Confirm the DSL-to-Temporal mapping table covers all eight construct rows listed in the spec

## 6. Validation and archive readiness

- [ ] 6.1 Run `openspec validate add-flows-dsl-schema --strict` and resolve all errors
- [ ] 6.2 Confirm no documentation files (README*, docs/) were modified

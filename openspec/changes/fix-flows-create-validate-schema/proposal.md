# fix-flows-create-validate-schema

## Change type
bugfix

## Capability
workflows

## Priority
P2

## Why
A flow whose task node uses the wrong parameter field (`params`/`parameters` instead of the schema's
`input`) is **accepted at create/publish (201)** and only fails later **at execution** with a
misleading `ApplicationFailure: Table undefined.undefined not found` — the interpreter
(`services/workflow-worker/.../DslInterpreterWorkflow.ts`) reads `node.input`, which is empty, so the
activity gets undefined args. GitHub issue #625.

**Root cause (code-verified).** The DSL JSON Schema (`services/internal-contracts/src/flow-definition.json`)
declares the task node with `additionalProperties:false` and the param field named `input`, and the
semantic validator (`flow-definition-validator.mjs`) explicitly delegates structural rules to it
("Callers typically run JSON Schema first, then this validator"). But the control-plane flows path
ran ONLY the semantic validator (`runValidation` → `validateFlowDefinition`), never the JSON Schema:
`createDefinition` did no definition validation at all (→ 201), and `validateDraft`/`publishVersion`
ran only the semantic layer (→ `{valid:true}` / publish). So a node with `params` passed every check
and failed confusingly at runtime. A Step-Functions-style `{startAt, states}` document was likewise
accepted and failed at execution with "flow definition has no nodes". The repo's own example
(`tests/live-campaign/verify-p1-flows.mjs`) used `params`, so a user following it authored flows that
publish fine but fail at runtime.

**Second drift uncovered.** Enforcing the schema revealed that the schema's `trigger` definition was
missing the `options` field (`overlap`, `catchupWindow`) that the trigger registry actually consumes
(`flow-trigger-registry.mjs`: `trigger.options.overlap` / `catchupWindow`). With `additionalProperties:false`
a legitimate cron trigger with options would have been rejected — so the schema is brought in line with
the runtime.

## What Changes
- New `services/internal-contracts/src/flow-definition-schema-validator.mjs`: a shared structural
  validator `validateFlowDefinitionSchema(definition)` that compiles `flow-definition.json` with AJV
  and returns `{ ok, errors }` (stable code `FLW-E000`). Node errors are produced against the node's
  declared `type` subschema so the message names the offending field (e.g. `params`) instead of raw
  `oneOf` noise. Exported from `@in-falcone/internal-contracts`.
- `apps/control-plane/src/runtime/flow-executor.mjs`: `runValidation` now runs JSON Schema FIRST,
  then the semantic validator, returning `{ ok, kind, errors }` (kind `schema` → 400
  `FLOW_DEFINITION_INVALID`; `semantic` → 422 `FLOW_VALIDATION_FAILED`). `createDefinition` and the
  `update_definition` (PATCH) path reject a structurally-malformed supplied definition (400) at the
  write boundary (an empty draft is still allowed; validate/publish enforce later).
- `services/internal-contracts/src/flow-definition.json`: add the `trigger.options` object
  (`overlap` enum + `catchupWindow`) to match what the trigger registry consumes.
- `apps/control-plane/package.json` + `services/internal-contracts/package.json`: add `ajv` (already
  the repo's JSON-Schema validator) so the executor image resolves it at runtime.
- `tests/live-campaign/verify-p1-flows.mjs`: fix the first-party example to use `input` (not `params`).

## Impact
- A malformed flow definition (unknown node field like `params`/`parameters`, an unsupported
  top-level shape, a missing required field) is rejected with `400 FLOW_DEFINITION_INVALID` at create,
  PATCH, validate, and publish — an actionable error before publish instead of a misleading activity
  failure at runtime.
- Semantic violations (FLW-E001..009) keep their `422 FLOW_VALIDATION_FAILED` contract.
- Legitimate cron triggers with `options` validate (the schema now models them).
- Structurally-valid first-party examples and existing flows specs are unchanged (191/191 flows
  black-box tests green).
- Affected specs: `workflows`.

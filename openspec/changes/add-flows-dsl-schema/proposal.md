## Why

The flow DSL is the contract boundary between the console editors, the server-side
validation endpoint, and the Temporal interpreter worker. Without a versioned,
machine-readable JSON Schema published in `services/internal-contracts/src/` — the
repository's single home for shared contracts (e.g. `console-workflow-invocation.json`,
`domain-model.json`) — none of those sibling changes (#359 interpreter, #360 control-plane
API, #363/#364 editors) can start without duplicating or guessing the shape. This change
closes that blocking gap for GitHub issue #358, epic #355.

## What Changes

- New JSON Schema artifact `services/internal-contracts/src/flow-definition.json` with
  `additionalProperties: false` discipline matching the existing contract style; Draft-07,
  `$id: "flow-definition"`, carrying `apiVersion` as an enum-gated version stamp.
- New index export `flowDefinitionSchema` from `services/internal-contracts/src/index.mjs`.
- Semantic validation rule table specified with stable error codes (`FLW-E001` … `FLW-E009`)
  consumable by editor diagnostics and API 422 responses.
- Normative DSL-to-Temporal mapping table (sequence, parallel, task, wait, branch, approval,
  sub-flow, cron, webhook triggers).
- Example flow fixtures under
  `services/internal-contracts/src/fixtures/flows/` (minimal 3-node, branch+retry,
  parallel fan-out, human-approval, sub-flow reference).
- Unit/contract tests under `tests/contracts/flow-definition.contract.test.mjs` validating
  all five fixtures and rejecting a set of invalid documents.
- Schema evolution policy: backward-compatible field additions bump `apiVersion` minor
  segment; breaking node-type removals or field renames require a new major `apiVersion`
  value, and stored definitions using the old value SHALL continue to parse against the
  schema version they were written with.

## Capabilities

### New Capabilities

- `workflows`: Flow DSL schema contract — versioned JSON Schema, semantic validation rules
  with error codes, DSL-to-Temporal mapping table, example fixtures, and schema evolution
  policy. This capability covers the shared contract layer only; interpreter, API endpoints,
  and editor integrations are tracked as separate sibling capabilities.

### Modified Capabilities

(none)

## Impact

- **services/internal-contracts/src/**: new `flow-definition.json` + fixtures directory +
  index.mjs export.
- **tests/contracts/**: new `flow-definition.contract.test.mjs`.
- **Consumers** (blocked siblings): `add-flows-dsl-interpreter-worker` (#359),
  `add-flows-control-plane-api` (#360), `add-console-flow-designer` (#363),
  `add-console-flow-yaml-editor` (#364) — all import the schema from
  `@falcone/internal-contracts`.
- No runtime service changes; purely a contract/schema artifact.

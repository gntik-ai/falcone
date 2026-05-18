## Why

The control-plane workflow registry under `apps/control-plane/src/workflows/` ships
two divergent "not-implemented" payload shapes, one publicly-addressable workflow
with no handler, and a dispatcher that assumes every workflow module exports a
`default`. From `openspec/audit/cap-a1-unified-public-api-contract.md`:

- **B2** (`workflows/index.mjs:23-25` and `saga-engine.mjs:57-59`) — WF-CON-005
  is registered as publicly addressable but unimplemented; `workflows/index.mjs`
  returns `{ notImplemented: true }` for it while `saga-engine.mjs` returns
  `{ status: 'not-implemented', workflowId }` for `definition.provisional`
  workflows. Two shapes for one concept; any consumer pattern-matching on either
  field mis-serialises.
- **G1** (`saga-definitions.mjs:50-87`) — every step in WF-CON-002/003/004/006
  (11 occurrences) carries `// TODO: verify step key matches catalog entry`. The
  keys are written into audit events at `saga-engine.mjs:101-104`; no validator
  cross-checks them against any catalog.
- **G9** (`workflows/index.mjs:29`) — the dispatcher calls
  `(await WORKFLOW_REGISTRY.get(workflowId)()).default`. No type or test
  enforces that every workflow module has a `default` export; a missing one
  throws an unhelpful runtime `TypeError` instead of `WorkflowNotFoundError`.

## What Changes

- Implement WF-CON-005 with a real handler matching the catalogue entry, or move
  it to a single canonical `not-implemented` shape if the work is deferred.
- Collapse the two not-implemented payload shapes to one shared
  `{ status: 'not-implemented', workflowId }` envelope; `workflows/index.mjs`
  and `saga-engine.mjs` MUST agree.
- Add a build-time validator (`scripts/validate-workflow-step-keys.mjs`) that
  cross-checks every step key in `saga-definitions.mjs` against the public
  capability catalogue and fails CI on drift.
- Make the dispatcher assert that each loaded workflow module exports a callable
  `default`, throwing a structured `WorkflowHandlerInvalidError` otherwise.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: workflow registry completeness, canonical
  not-implemented envelope, step-key validation, and dispatcher contract.

## Impact

- Affected code: `apps/control-plane/src/workflows/index.mjs`,
  `apps/control-plane/src/workflows/wf-con-005-*.mjs` (new or stub),
  `apps/control-plane/src/saga/saga-engine.mjs`,
  `apps/control-plane/src/saga/saga-definitions.mjs`,
  `scripts/validate-workflow-step-keys.mjs` (new).
- Migrations: none (no schema changes).
- Breaking changes: consumers pattern-matching on `notImplemented: true` MUST
  migrate to the canonical `status === 'not-implemented'` shape.
- Out of scope: implementing the actual business logic of WF-CON-005 if the
  catalogue marks it provisional — only the envelope shape and dispatcher
  contract are corrected here.

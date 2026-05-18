## Why

The workspace capability catalog response can be built into a payload that
violates its own published JSON Schema, and the handler does no runtime
validation before returning it. From
`openspec/audit/cap-c2-workspace-capability-catalog.md`:

- **B3** (`services/internal-contracts/src/workspace-capability-catalog-response.json:65-71`) —
  the `oneOf` branch for `enabled === true` requires `examples.minItems: 1`,
  but `services/workspace-docs-service/src/capability-catalog-builder.mjs:51-67`
  returns `[]` if no snippet entry matches `serviceKey === id`. A new
  capability without snippets yields a schema-noncompliant response.
- **B4** (migration 104 + `workspace-capability-catalog-response.json`) — a row
  with `status='provisioning'` and `enabled=true` (as in
  `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs:33-37`)
  must still satisfy the `enabled === true` schema branch; with no snippets
  yet seeded for a freshly-provisioning capability the response violates
  `examples.minItems: 1`.
- **G9** — same root cause as B3/B4: the contract demands non-empty examples
  for any enabled capability but the runtime has no guarantee snippets exist.
- **G10** — empty `examples[]` for an enabled capability also violates the
  schema; no runtime guard.
- **G18** (`workspace-capability-catalog.mjs:24-46`) —
  `fetchCapabilities`'s expected row shape is undocumented; the builder
  accepts both `row.capability_key` / `row.id` and snake_case / camelCase
  variants, allowing drift between producers.

## What Changes

- Tighten `capability-catalog-builder.mjs` so an `enabled === true`
  capability with no snippets is treated as a contract violation: either
  fall the capability back to `enabled === false` (with the enablement
  guide) or raise a structured `CatalogSnippetMissingError`. The spec below
  mandates the explicit error path so the gap is visible.
- Add a runtime response-schema validation step at the handler return site
  in `workspace-capability-catalog.mjs` so any future drift surfaces as a
  500 with a clear error rather than as a silent downstream rejection.
- Reconcile the `provisioning + enabled=true` test fixture so it matches
  the contract (provisioning capabilities ship without `enabled=true`, or
  with at least one snippet seeded).
- Document and enforce the canonical row shape `fetchCapabilities` returns;
  remove dual-shape `??` fallbacks in the builder.

## Capabilities

### Modified Capabilities

- `workspace-management`: schema-conformance enforcement on the workspace
  capability catalog response, including non-empty `examples[]` for
  enabled capabilities and a single canonical row shape.

## Impact

- Affected code:
  `services/workspace-docs-service/src/capability-catalog-builder.mjs`,
  `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`,
  `services/internal-contracts/src/workspace-capability-catalog-response.json`,
  `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs`.
- Migrations: none. Behaviour-only fix.
- Breaking changes: callers that today receive schema-noncompliant
  responses with empty `examples[]` will instead receive a structured
  error or a falsey-enabled capability; consumers MUST be prepared.
- Out of scope: action-implementation completion (covered by
  `complete-c2-action-implementation`); cross-service import boundaries
  (covered by `harden-c2-cross-service-coupling`).

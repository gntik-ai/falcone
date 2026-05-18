## Why

The canonical pipeline restricts self-audit (configuration changes
emitting audit events through the same pipeline) to the `superadmin`
actor — but the check cannot work because every audited surface checks
`superadmin` as a scope literal rather than a realm role. From
`openspec/audit/cap-m1-audit-contract-surface.md`:

- **B9** (`services/internal-contracts/src/observability-audit-pipeline.json:258-269`)
  — declares `self_audit.restricted_actors: ['superadmin']`. Per the L1
  capability audit (B1) and the B1 capability audit, the `superadmin`
  realm role is created in Keycloak bootstrap but every consumer checks
  it as a scope literal (`scope === 'superadmin'`). The bootstrap path
  does not grant a scope literal of that name, so the check is dead and
  the pipeline restriction cannot be enforced.

## What Changes

- Introduce a single helper `isSuperadminActor(authzContext)` in
  `services/audit/src/authorization-context.mjs` that resolves the
  question by inspecting the JWT's `realm_access.roles` array for
  `'superadmin'` — not a scope literal.
- Replace the dead scope-literal check at the self-audit enforcement
  point (a thin wrapper around `emitAuditEvent`) with
  `isSuperadminActor(authzContext)`.
- Add a contract test that confirms a non-superadmin actor cannot
  self-audit (i.e., emit an event whose `scope.subsystem_id` indicates a
  pipeline-configuration change).

## Capabilities

### Modified Capabilities

- `observability-and-audit`: self-audit authorization check resolves
  against realm roles, not scope literals.

## Impact

- **Affected code**: `services/audit/src/authorization-context.mjs`,
  `services/audit/src/emit.mjs` (self-audit gating wrapper),
  `services/audit/test/self-audit.contract.test.mjs`.
- **Migration required**: none.
- **Breaking changes**: any caller that emitted self-audit events while
  carrying a scope literal `'superadmin'` (no caller observed in this
  repo) MUST migrate to a JWT with `superadmin` in `realm_access.roles`.
- **Out of scope**: the broader B1/L1 superadmin-scope-literal cleanup
  (tracked under capability-B1 and L1 proposals).

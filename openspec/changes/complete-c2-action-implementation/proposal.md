## Why

The workspace capability catalog endpoint is wired through the gateway but is
non-functional in production: the default action factory has no real
`fetchCapabilities` or `emitAuditEvent` implementation, and the only persistence
artefact that exists (migration 090) seeds a table no audited code path reads.
From `openspec/audit/cap-c2-workspace-capability-catalog.md`:

- **B1** (`services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:97`) —
  `main = createWorkspaceCapabilityCatalogAction()` is constructed with no
  `fetchCapabilities`. The handler calls `await fetchCapabilities?.({...})` at
  `:24`; `?.()` returns `undefined`; the `Array.isArray` check at `:26` rejects
  and the endpoint returns `404 WORKSPACE_NOT_FOUND` for every request.
- **B6** (`workspace-capability-catalog.mjs:5`) — the default `emitAuditEvent`
  is `async () => {}` and nothing wires a real producer. The
  `workspace.capability-catalog.accessed` event contract is never emitted in
  production.
- **B7** (`services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql:16-30`) —
  seeds six rows into `capability_catalog_metadata` that no action queries.
  Dead data, dead migration.
- **G1** (handler default at `workspace-capability-catalog.mjs:97`) — no
  production wiring of `fetchCapabilities` anywhere in the package.
- **G4** (`workspace-capability-catalog.mjs:5`) — no module wires a real
  audit emitter.

## What Changes

- Implement a real `fetchCapabilities` that queries `capability_catalog_metadata`
  joined with per-workspace enablement state, replacing the DI stub at
  `workspace-capability-catalog.mjs:97`.
- Wire a real Kafka audit emitter for the `workspace.capability-catalog.accessed`
  event, replacing the no-op default at `workspace-capability-catalog.mjs:5`.
- Either consume migration 090's seeded rows from the new `fetchCapabilities`
  or remove the migration; the system MUST NOT carry a seeded table that no
  code path reads.
- Add an end-to-end test that exercises the wired `main` (not a DI-mocked
  variant) against the gateway and asserts a 200 with at least one capability.

## Capabilities

### Modified Capabilities

- `workspace-management`: a real, production-wired capability-catalog action
  that returns a populated catalog and emits the audited access event.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`,
  a new `services/provisioning-orchestrator/src/repositories/workspace-capability-catalog-repository.mjs`,
  a new audit emitter wiring (e.g. `services/provisioning-orchestrator/src/runtime/audit-emitter.mjs`),
  and either retention or removal of `services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql`.
- Migrations: if migration 090 is retained, add a per-workspace enablement
  table or column so `fetchCapabilities` has somewhere to read enablement
  state from; if removed, replace with a new migration that establishes the
  canonical table the new repository queries.
- Breaking changes: callers that today receive 404 from this endpoint will
  begin to receive 200 with a real catalog; downstream snippet consumers MUST
  be prepared to receive non-empty `capabilities[]`.
- Out of scope: schema-conformance bugs (B3/B4 — covered by
  `fix-c2-schema-conformance`); correlation/audit semantics (B2/B11/B12 —
  `harden-c2-correlation-and-audit`); cross-service import boundaries (B5/B9 —
  `harden-c2-cross-service-coupling`).

## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/provisioning-orchestrator/tests/workspace-capability-catalog-wired.test.mjs`
      that imports the default `main` from
      `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`
      and asserts a request with valid claims returns HTTP 200 with a
      non-empty `capabilities[]` (proves B1 at `:97`); the test MUST also
      assert that the `workspace.capability-catalog.accessed` event is
      published to the configured emitter (proves B6 at `:5`).
- [ ] 1.2 [test] Add a test that asserts every row seeded by
      `services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql:16-30`
      is reachable via the new `fetchCapabilities` for at least one
      workspace (proves B7).

## 2. Implementation

- [ ] 2.1 [impl] Add `services/provisioning-orchestrator/src/repositories/workspace-capability-catalog-repository.mjs`
      that joins `capability_catalog_metadata` with the per-workspace
      enablement source and returns rows in the shape the handler at
      `workspace-capability-catalog.mjs:24-46` already consumes.
- [ ] 2.2 [impl] Wire a real `fetchCapabilities` and a real Kafka
      `emitAuditEvent` into the default factory call at
      `workspace-capability-catalog.mjs:97`, replacing the DI stub
      (B1) and the no-op emitter (B6/G4).
- [ ] 2.3 [migration] Add a per-workspace enablement migration (or extend
      `boolean_capability_catalog`) so the new repository has a real
      enablement source; reconcile or supersede migration 090 so B7's
      dead-data condition is resolved.
- [ ] 2.4 [impl] Add tenant-equality enforcement inside
      `fetchCapabilities` so a workspace lookup never returns rows from a
      different tenant even if the upstream `workspaceId` check is bypassed.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the wired `fetchCapabilities` data source and the
      audit-emitter wiring in
      `services/provisioning-orchestrator/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate complete-c2-action-implementation --strict`; both
      green before merge.

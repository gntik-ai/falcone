## 1. Failing tests

- [ ] 1.1 [test] Add `tests/adapters/storage-tenant-context-provisioning.test.mjs`
      that invokes `provisionWorkspaceStorageBoundary` with a valid request
      and asserts the returned record contains `boundaryId`, `namespace`,
      `defaultPolicyId`, `initialQuotaEnvelope`, and an `auditEnvelope`
      (proves B6 at
      `services/adapters/src/storage-tenant-context.mjs:465-469`).
- [ ] 1.2 [test] Add a case asserting the helper throws
      `WORKSPACE_STORAGE_PUBLISHER_MISSING` when `context.publishAuditEvent`
      is absent (fail-closed contract aligned with
      `fix-g1-audit-emission-wiring`).

## 2. Implementation

- [ ] 2.1 [impl] Replace the unconditional throw at
      `storage-tenant-context.mjs:465-469` with a real implementation that
      builds the workspace-storage boundary record (namespace via
      `deriveTenantStorageNamespace`, default policy seed, initial quota
      envelope from the plan).
- [ ] 2.2 [impl] Stitch the helper into the provisioning-orchestrator's
      workspace-create flow per the design.md contract; the orchestrator
      persists the boundary and emits the audit event.
- [ ] 2.3 [impl] Add a feature-flag guarded short-circuit
      (`STORAGE_BOUNDARY_PROVISIONING_DISABLED=true`) that returns
      `NOT_YET_IMPLEMENTED` so the unconditional throw is replaced rather
      than hidden.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`
      describing the provisioning contract and the audit-publisher
      requirement.
- [ ] 3.2 [docs] Document the new helper in the adapter README and the
      provisioning-orchestrator README; cross-reference the C1 workspace-create
      workflow.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- storage-tenant-context` and
      `openspec validate complete-g1-workspace-storage-provisioning --strict`;
      both green before merge.

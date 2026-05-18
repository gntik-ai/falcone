## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/provisioning-orchestrator/tests/workspace-capability-catalog-coupling.test.mjs`
      that imports the catalog handler and asserts `buildCatalog` is
      sourced through a stable package export (not a
      `../../../workspace-docs-service/...` relative path); the test MUST
      fail today against the import at
      `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:1`
      (proves B5/G3).
- [ ] 1.2 [test] Add a test that invokes the handler with no
      `params.host` / `params.endpoints`; assert the response is HTTP 500
      `WORKSPACE_CONTEXT_MISSING` and that no snippet in the response
      contains the substring `.example.internal` (proves B9 at `:37-46`).
- [ ] 1.3 [test] Add a test that spies on `fetchCapabilities`; assert the
      argument shape is exactly `{ workspaceId, capabilityId, tenantId,
      claims }` and contains no `params`, `headers`, or token material
      (proves B13 at `:24`).
- [ ] 1.4 [test] Add a test that submits
      `params.resourceNames.extraB = "javascript:alert(0)"`; assert the
      handler rejects with HTTP 400 `INVALID_RESOURCE_URL` and no example
      snippet in any response carries that value (proves B14 at `:42`).

## 2. Implementation

- [ ] 2.1 [fix] Move
      `services/workspace-docs-service/src/capability-catalog-builder.mjs`
      to `services/internal-contracts/src/capability-catalog-builder.mjs`
      and export it via `services/internal-contracts/src/index.mjs`;
      update the import at
      `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:1`
      to the package path.
- [ ] 2.2 [fix] Replace the `.example.internal` fallbacks at
      `workspace-capability-catalog.mjs:37-46` with a strict check: when
      `params.host`, `params.port`, `params.resourceNames`, or
      `params.endpoints` are missing, return HTTP 500
      `WORKSPACE_CONTEXT_MISSING`.
- [ ] 2.3 [fix] Narrow the argument passed to `fetchCapabilities` at
      `workspace-capability-catalog.mjs:24` to an allow-listed
      `{ workspaceId, capabilityId, tenantId, claims }`; redact token
      material from `claims` before hand-off.
- [ ] 2.4 [fix] Add URL-shape validation for
      `params.resourceNames.extraA` / `extraB`: reject anything whose
      protocol is not `https:` or `wss:`; reject if the host fails a
      basic hostname regex.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the new package import path, the strict
      workspace-context contract, and the `fetchCapabilities` argument
      shape in `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate harden-c2-cross-service-coupling --strict`; both
      green before merge.

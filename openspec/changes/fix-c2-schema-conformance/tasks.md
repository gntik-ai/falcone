## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a unit test in
      `services/workspace-docs-service/tests/capability-catalog-builder-schema.test.mjs`
      that builds a capability row with `enabled: true` and no matching
      snippet entry; assert the builder raises `CatalogSnippetMissingError`
      and that `buildCatalog` output, when validated against
      `services/internal-contracts/src/workspace-capability-catalog-response.json`,
      never produces `examples: []` for an `enabled: true` capability
      (proves B3, G9, G10).
- [ ] 1.2 [test] Update
      `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs:33-37`
      to assert the response validates against
      `workspace-capability-catalog-response.json` for a
      `status='provisioning'` capability; the current fixture with
      `enabled=true` and no snippet rows MUST fail this assertion (proves B4).
- [ ] 1.3 [test] Add a test that feeds the builder a row using camelCase
      keys (`displayName`, `catalogVersion`) and a second row using
      snake_case keys; assert one and only one canonical shape is accepted
      and the other is rejected (proves G18).

## 2. Implementation

- [ ] 2.1 [fix] Tighten
      `services/workspace-docs-service/src/capability-catalog-builder.mjs:51-67`
      so an `enabled === true` capability with no snippet entries raises
      `CatalogSnippetMissingError` rather than returning `examples: []`.
- [ ] 2.2 [fix] Add runtime response-schema validation in
      `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs`
      before the 200 return; on failure, log the validation error and
      return `500 CATALOG_CONTRACT_VIOLATION`.
- [ ] 2.3 [fix] Remove the snake_case / camelCase dual fallbacks in
      `capability-catalog-builder.mjs:69-89`; settle on snake_case as the
      canonical row shape and document it in the file header.
- [ ] 2.4 [fix] Update
      `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs`
      so `status='provisioning'` fixtures either ship snippets or carry
      `enabled=false`; the contract MUST hold for every test row.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the canonical row shape and the
      `CatalogSnippetMissingError` contract in
      `services/workspace-docs-service/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate fix-c2-schema-conformance --strict`; both green
      before merge.

## 1. Failing tests

- [ ] 1.1 [test] Add `services/audit/test/contract-presence.test.mjs`
      asserting `getContract('audit_record')`,
      `getContract('iam_lifecycle_event')`,
      `getContract('mongo_admin_event')`, and
      `getContract('kafka_admin_event')` all return a non-`undefined`
      object whose `version` is a non-empty string, proving B5 from
      `contract-boundary.mjs:9-12`.
- [ ] 1.2 [test] Add a case asserting `auditPersistenceAdapters` is a
      non-empty array; the test fails if the registry attributes no
      ports to `'audit_module'`, proving G11.
- [ ] 1.3 [test] Add `services/audit/test/declared-surfaces.test.mjs`
      AJV-loading both `observability-audit-export-surface.json` and
      `observability-audit-correlation-surface.json`; assert each
      declares at least one route operation id, proving B12.
- [ ] 1.4 [test] Add a case asserting
      `auditRelevantNegativeAuthorizationScenarios` either equals the
      filtered subset (`scenario.surface === 'observability'`) or
      matches the unfiltered `listNegativeAuthorizationScenarios()`
      call; fail with a clear message if the variable name and value
      disagree, proving G12.

## 2. Implementation

- [ ] 2.1 [test] Add helper `loadSchemaFile(name)` used by both
      `contract-presence` and `declared-surfaces` tests; centralise
      AJV setup in `services/audit/test/_ajv.mjs`.

## 3. Validation

- [ ] 3.1 [docs] Document each test's purpose and the audit B/G
      reference in `services/audit/test/README.md` so future
      maintainers know which audit finding the failure proves.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/audit test` and
      `openspec validate coverage-m1-contract-validation --strict`;
      both green.

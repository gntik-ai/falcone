## 1. Failing tests

- [ ] 1.1 [test] Add `tests/contracts/secret-metadata-contracts.test.mjs`
      that loads both YAMLs with `@apidevtools/swagger-parser` and asserts
      they are valid OpenAPI documents (proves G-T1's invariant: no test
      currently parses them).
- [ ] 1.2 [test] Add a case in the same file that builds an AJV validator
      from the detail-response schema and asserts a payload of `{}` is
      rejected, then asserts a payload missing `accessPolicies` is rejected,
      then asserts a payload carrying `value: "abc"` is rejected via
      `not.anyOf`.
- [ ] 1.3 [test] Add `tests/contracts/secret-inventory-pagination.test.mjs`
      with cases for: (a) a mid-list page validates with `hasMore: true,
      nextOffset > offset`, (b) the final page validates with `hasMore:
      false, nextOffset: null`, (c) a payload missing the `pagination`
      envelope is rejected.
- [ ] 1.4 [test] Add a case to `secret-inventory-pagination.test.mjs` that
      asserts a payload missing the `tenantId` query parameter is rejected
      by the gateway-contract harness when the caller lacks
      `platform:admin:secrets:list`.

## 2. Implementation

- [ ] 2.1 [test] Rewrite `tests/hardening/suites/tenant-isolation.test.mjs:38,52`
      to call the declared `/v1/secrets/workspaces/{workspaceId}/metadata`
      route and assert the response body against the contract schema (not
      just the HTTP status).
- [ ] 2.2 [test] Add an AJV validator harness at
      `tests/contracts/helpers/secret-validators.mjs` that compiles both
      YAML schemas once and exposes named validators
      (`validateSecretDetail`, `validateSecretInventoryPage`,
      `validateSecretMetadataItem`) to the new tests.
- [ ] 2.3 [impl] Wire the new test files into
      `package.json:scripts.test:contracts` so CI executes them; add an
      `OPENAPI_VALIDATE` glob to the `scripts.lint` chain that walks
      `services/internal-contracts/**/*.yaml` and rejects malformed files.

## 3. Validation

- [ ] 3.1 [docs] Document the new contract-test entrypoints in
      `tests/contracts/README.md` (creating it if absent) so future authors
      know where to add new schema cases.
- [ ] 3.2 [test] Run `corepack pnpm test:contracts`, `corepack pnpm lint`,
      and `openspec validate coverage-m3-contract-tests --strict`; all
      green before merge.

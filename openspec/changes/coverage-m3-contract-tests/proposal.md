## Why

M3's two metadata YAMLs have **no tests**. The repo's only consumer is a
hardening test that calls a route the contracts don't even declare. From
`openspec/audit/cap-m3-secret-metadata-api-contracts.md`:

- **G-T1** (verified by `ls tests/contracts/` — no `secret-*` test file) —
  no test under `tests/contracts/` validates the YAMLs against any OpenAPI
  validator (AJV, `@apidevtools/swagger-parser`, or similar). The two
  YAMLs may not even be valid OpenAPI 3.0.3; nobody knows because nothing
  parses them.
- **G-T2** (`tests/hardening/suites/tenant-isolation.test.mjs:38,52`) — the
  one consumer that exercises `/v1/secrets/*` hits a path the contracts
  don't declare. The test passes against any 200/403 — including a
  fortuitous response from an unrelated handler — without ever asserting
  contract conformance.
- **G-T3** (`secret-inventory-v1.yaml:6-29, :30-43, :45-59`) — no test
  covers the inventory's pagination semantics, the `tenantId`-omitted
  scoping behaviour, or the `not.anyOf` forbidden-field enforcement.

## What Changes

- Add `tests/contracts/secret-metadata-contracts.test.mjs` that parses both
  YAMLs with `@apidevtools/swagger-parser`, asserts they are valid OpenAPI
  documents, and asserts the schemas reject known-bad payloads (empty
  object, missing required field, `value` field present, reversed-time
  window).
- Add `tests/contracts/secret-inventory-pagination.test.mjs` that asserts
  the inventory payload validates a full-page response, a final-page
  response, and rejects a payload missing the `pagination` envelope (after
  `harden-m3-security-and-pagination` lands; before it, the test asserts
  the current bare envelope).
- Replace the path shape in `tests/hardening/suites/tenant-isolation.test.mjs:38,52`
  with the declared `/v1/secrets/workspaces/{workspaceId}/metadata` route
  (introduced by `complete-m3-endpoint-implementation`) and assert against
  the actual contract schema, not just the HTTP status.
- Wire the new contract tests into `package.json:scripts.test:contracts` so
  CI runs them on every PR.

## Capabilities

### Modified Capabilities

- `secret-management`: requirement that the M3 contracts have CI-enforced
  schema validation, pagination/scoping coverage, and that the hardening
  test asserts against a declared route.

## Impact

- **Affected code**: new `tests/contracts/secret-metadata-contracts.test.mjs`;
  new `tests/contracts/secret-inventory-pagination.test.mjs`; edit of
  `tests/hardening/suites/tenant-isolation.test.mjs:38,52`; edit of
  `package.json` to include the new tests in `scripts.test:contracts`.
- **Migration required**: none.
- **Breaking changes**: existing CI may fail until `complete-m3-endpoint-implementation`
  and the two fix/harden proposals land; document the sequencing in the PR.
- **Cross-cutting**: this change is the "tests-only" complement to
  `fix-m3-contract-schema-conformance` and `harden-m3-security-and-pagination`;
  it should land last so it asserts the corrected schemas, not the broken
  ones.

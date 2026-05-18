## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `apps/control-plane/src/iam-admin.test.mjs` with a case
      that stubs `iamAdminRequestContract` as `undefined` and asserts
      `getIamCompatibilitySummary()` throws `MissingContractError` rather than
      returning `'2026-03-24'`, proving B7/G6 from `iam-admin.mjs:39`.
- [ ] 1.2 [test] Add `scripts/validate-openapi-version-pins.test.mjs` that
      runs the new validator against the current spec and asserts it flags the
      drift at `control-plane.openapi.json:55125`, `:64600`, `:66423`, `:67701`,
      proving B8.
- [ ] 1.3 [test] Add a façade-conformance test asserting every facade reports
      the same `contractVersion` derived from `PLATFORM_API_VERSION`.

## 2. Implementation

- [ ] 2.1 [fix] Replace `iam-admin.mjs:39`'s `?? '2026-03-24'` fallback with a
      `MissingContractError` throw; remove the literal version string from the
      file entirely.
- [ ] 2.2 [impl] Add `PLATFORM_API_VERSION` constant in
      `services/internal-contracts/src/index.mjs`; rewrite every per-family
      contract to derive its `X-API-Version` from it.
- [ ] 2.3 [impl] Add `scripts/validate-openapi-version-pins.mjs` walking every
      `pattern`/`const`/`enum` field whose property name matches
      `/X-API-Version|x-api-version/`; fail on any mismatch with
      `PLATFORM_API_VERSION`.
- [ ] 2.4 [fix] Regenerate `apps/control-plane/openapi/control-plane.openapi.json`
      and `apps/control-plane/openapi/families/*.openapi.json` so all pins
      match `PLATFORM_API_VERSION`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the single-source-of-truth versioning rule in
      `apps/control-plane/src/README.md` and `scripts/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate harden-a1-contract-version-fallbacks --strict`; both
      green.

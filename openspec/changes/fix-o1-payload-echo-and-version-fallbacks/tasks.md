## 1. Failing tests

- [ ] 1.1 [test] Add `services/adapters/tests/keycloak-payload-sanitise.test.mjs`
      that calls `buildIamAdminAdapterCall` with
      `payload: {clientSecret: 'shh', signingCertificatePem: 'pem-data',
      temporaryPassword: 'pw'}` and asserts none of those values appear in
      the resulting envelope (including under `payload.providerPayload`);
      today they appear verbatim (proves B4, G7).
- [ ] 1.2 [test] Add a test that calls the module with the
      `iamAdminRequestContract` mocked to `undefined` and asserts the call
      throws `IAM_ADMIN_CONTRACT_VERSION_UNAVAILABLE`; today both sites at
      `:152` and `:510` silently fall back to `'2026-03-24'` (proves B8,
      G-S3.4).
- [ ] 1.3 [test] Add a CI scan under `services/adapters/tests/` that fails
      if any `services/adapters/src/*.mjs` contains the pattern
      `?? '20\d\d-\d\d-\d\d'` (a hard-coded YYYY-MM-DD contract fallback)
      (proves G4).

## 2. Implementation

- [ ] 2.1 [impl] Add `services/adapters/src/payload-sanitiser.mjs`
      exporting `sanitiseProviderPayload(payload, options)` that strips the
      named secret fields and any field whose key matches
      `/secret|password|token|credential|certificate/i`.
- [ ] 2.2 [fix] Apply the sanitiser at
      `services/adapters/src/keycloak-admin.mjs:506`: replace
      `providerPayload: payload` with
      `providerPayload: sanitiseProviderPayload(payload)` (resolves B4, G7,
      G-S3.4).
- [ ] 2.3 [fix] Replace both `?? '2026-03-24'` fallbacks at
      `services/adapters/src/keycloak-admin.mjs:152, :510` with an explicit
      throw `Error('IAM_ADMIN_CONTRACT_VERSION_UNAVAILABLE')` so the
      runtime never advertises a contract version it cannot back (resolves
      B8).
- [ ] 2.4 [impl] Wire the CI scan from 1.3 into the package's lint step so
      future adapters cannot reintroduce the hard-coded fallback pattern.

## 3. Validation

- [ ] 3.1 [docs] Document the payload sanitiser, the fail-fast contract
      version semantics, and the cross-adapter scan in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run the three new tests; run
      `openspec validate fix-o1-payload-echo-and-version-fallbacks --strict`;
      all green before merge.

## 1. Failing tests

- [ ] 1.1 [test] Add a test under `services/adapters/tests/` that calls
      `validateIamAdminRequest` on a `client` resource with
      `defaultScopes: ['openid']` and asserts a
      `GW_IAM_RESERVED_SCOPE_DENIED` violation; today the request passes
      (proves B6 client part, G-S3.3 part 1).
- [ ] 1.2 [test] Add a test that calls `validateIamAdminRequest` on a
      `realm` resource with `optionalScopes: ['email']` and asserts a
      `GW_IAM_RESERVED_SCOPE_DENIED` violation; today the request passes
      (proves B6 realm part, G-S3.3 part 2).
- [ ] 1.3 [test] Add a test that calls `validateIamAdminRequest` against
      `realm: 'master'` with `context: {scope: 'platform',
      platformAttestationId: undefined}` and asserts a
      `GW_IAM_RESERVED_REALM_NOT_ATTESTED` violation; today the bypass
      fires on `scope === 'platform'` alone (proves G-S3.11).

## 2. Implementation

- [ ] 2.1 [impl] Extract the reserved-scope check into a shared helper
      (e.g., `assertNoReservedScopes(scopes)`); apply it at
      `services/adapters/src/keycloak-admin.mjs:307-308` (realm
      `defaultScopes`/`optionalScopes`) and `:335-336` (client
      `defaultScopes`/`optionalScopes`) in addition to the existing
      `:416` site (resolves B6, G-S3.3).
- [ ] 2.2 [fix] Strengthen the reserved-realm bypass at
      `services/adapters/src/keycloak-admin.mjs:301`: require BOTH
      `context.scope === 'platform'` AND a non-empty
      `context.platformAttestationId`; emit
      `GW_IAM_RESERVED_REALM_NOT_ATTESTED` when attestation is missing
      (resolves G-S3.11).
- [ ] 2.3 [docs] Document the symmetric reserved-scope policy and the
      attested platform-bypass contract in
      `services/adapters/src/README.md`.

## 3. Validation

- [ ] 3.1 [test] Run the three new tests; run
      `openspec validate fix-o1-reserved-realm-and-scope-asymmetry --strict`;
      all green before merge.

## 1. Failing tests

- [ ] 1.1 [test] Add `services/adapters/tests/kafka-context-only.test.mjs`
      that calls `buildKafkaAdminAdapterCall` with `context: {tenantId:
      undefined}` and `payload: {tenantId: 'tenant-evil', ...}` and asserts
      the result is `{ok: false, violations: [{code:
      'GW_ADAPTER_CONTEXT_MISSING', field: 'tenantId'}]}`; today the call
      silently uses `payload.tenantId` (proves B1, G-S2.3).
- [ ] 1.2 [test] Add `services/adapters/tests/keycloak-scopes-validated.test.mjs`
      that calls `buildIamAdminAdapterCall` with arbitrary
      `payload.providerPayload.scopes` and asserts the resulting envelope's
      `scopes` field is not a verbatim copy — it MUST be derived from the
      validated context only; today the values pass through unchecked
      (proves G-S3.2).
- [ ] 1.3 [test] Add a CI scan under
      `services/adapters/tests/context-only-coverage.test.mjs` that fails if
      any `services/adapters/src/*.mjs` contains the pattern
      `context.tenantId ?? payload.tenantId` or
      `context.workspaceId ?? payload.workspaceId`.

## 2. Implementation

- [ ] 2.1 [fix] Remove the `?? payload.tenantId` and `?? payload.workspaceId`
      fallbacks at `services/adapters/src/kafka-admin.mjs:475`; replace with
      a context-presence check that emits
      `GW_ADAPTER_CONTEXT_MISSING` violations on absence (resolves B1,
      G-S2.3).
- [ ] 2.2 [fix] Apply the same change pattern to any other adapter that
      reads `tenantId`/`workspaceId` from payload (Mongo per E1 B1,
      OpenWhisk per H1 B1) — covered cross-cutting by the CI scan in 1.3.
- [ ] 2.3 [fix] In `services/adapters/src/keycloak-admin.mjs:480-481,
      :514-515`, replace the raw pass-through of `scopes`/`effectiveRoles`
      with the validated copy that the `validateAdapterCallAuthorization`
      helper (from `harden-o1-authorization-policy-adoption`) returns; if
      that helper is not yet wired, fall back to asserting both fields are
      non-empty arrays.

## 3. Validation

- [ ] 3.1 [docs] Document the context-only rule and the
      `GW_ADAPTER_CONTEXT_MISSING` violation in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run the three new tests; run
      `openspec validate fix-o1-context-trust-from-payload --strict`; all
      green before merge.

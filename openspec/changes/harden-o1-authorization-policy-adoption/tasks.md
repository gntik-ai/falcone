## 1. Failing tests

- [ ] 1.1 [test] Add `services/adapters/tests/authorization-policy-adoption.test.mjs`
      that scans `services/adapters/src/*.mjs` for imports of
      `./authorization-policy.mjs`; today the test fails because no adapter
      imports it (proves B9, G1).
- [ ] 1.2 [test] Add a per-provider test (Kafka + Keycloak first) that calls
      `buildKafkaAdminAdapterCall` and `buildIamAdminAdapterCall` with empty
      `scopes` against a non-public surface and asserts the result is
      `{ok: false, violations: [{code: 'GW_ADAPTER_AUTHZ_NOT_ATTESTED'}]}`;
      today the envelope is built unchecked (proves G2, G-S2.1, G-S3.1).

## 2. Implementation

- [ ] 2.1 [impl] Add a helper to
      `services/adapters/src/authorization-policy.mjs` named
      `validateAdapterCallAuthorization({surface, scopes, effectiveRoles,
      authorizationDecisionId, actorId})` that returns
      `{ok, violations[]}` based on the
      `adapterEnforcementSurfaces` set and the contract targets.
- [ ] 2.2 [impl] Wire the helper into every `buildXxxAdapterCall` across the
      six providers (PostgreSQL, MongoDB, Kafka, Keycloak, OpenWhisk,
      storage); the call MUST short-circuit envelope construction when the
      validation fails.
- [ ] 2.3 [impl] Add a per-adapter mapping that names the enforcement
      surface for each `(resourceKind, action)` pair so the helper can pick
      the correct attestation requirement (e.g., Kafka topic.create →
      `event_bus`; Keycloak realm.create → `iam_admin`).
- [ ] 2.4 [impl] Wire the CI scan from 1.1 so a new adapter without an
      `authorization-policy` import or an explicit `not-applicable` comment
      blocks merge.

## 3. Validation

- [ ] 3.1 [docs] Document the new adoption contract and the
      `validateAdapterCallAuthorization` helper in
      `services/adapters/src/README.md`; cross-reference the per-provider
      surface mapping.
- [ ] 3.2 [test] Run the adoption scan and the Kafka/Keycloak unit tests;
      run `openspec validate harden-o1-authorization-policy-adoption
      --strict`; all green before merge.

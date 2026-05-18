## 1. Failing tests

- [ ] 1.1 [test] Add a Kafka slug-collision test that registers workspace
      `alpha-beta`, then attempts to register workspace `alpha--beta` and
      asserts the validator emits a `GW_KAFKA_SLUG_COLLISION` violation;
      today both slugs normalise to `alpha.beta` silently (proves B11,
      G-S2.5).
- [ ] 1.2 [test] Add an ACL dedup test that submits two bindings differing
      only in `patternType` (literal vs prefixed) on the same `(principal,
      resource, ops)` and asserts both survive dedup; today they collide
      (proves B12, G-S2.10).
- [ ] 1.3 [test] Add an audit-id uniqueness test that emits 100 successive
      audit records and asserts all 100 `auditRecordId` values are unique;
      today the `evt01` default and 16-char suffix collide (proves B13,
      G-S2.6).
- [ ] 1.4 [test] Add a Keycloak temp-password test asserting
      `'aaaaaaaaaaaa'` is rejected and a charset-diverse `'Aa1!Aa1!Aa1!'`
      is accepted; today the length-only check passes both (proves B15,
      G-S3.5).
- [ ] 1.5 [test] Add a Keycloak SAML client test asserting
      `samlSigningCertificate` survives normalisation into the output
      resource shape; today it is dropped at `:182-205` (proves B16,
      G-S3.6).
- [ ] 1.6 [test] Add a Keycloak realm-consistency test asserting that
      `context.realmId: 'r1'` with `payload.realm: 'r2'` yields a
      `GW_IAM_REALM_MISMATCH` violation (proves B18).

## 2. Implementation

- [ ] 2.1 [fix] Update `services/adapters/src/kafka-admin.mjs:135-142,
      :163-169`: collapse repeated separator runs into a single `.`;
      maintain a per-tenant slug registry (or compare against existing
      managed topic prefixes) and emit `GW_KAFKA_SLUG_COLLISION` on hit
      (resolves B11, G-S2.5).
- [ ] 2.2 [fix] Include `patternType` in the ACL dedup key at
      `services/adapters/src/kafka-admin.mjs:442` (resolves B12, G-S2.10).
- [ ] 2.3 [fix] Replace the audit-id derivation at
      `services/adapters/src/kafka-admin.mjs:655` with a UUIDv4 (or a hash
      of `callId + timestamp + counter`); remove the `'evt01'` default
      (resolves B13, G-S2.6).
- [ ] 2.4 [fix] Strengthen temp-password validation at
      `services/adapters/src/keycloak-admin.mjs:456` to require ≥3 of 4
      charset classes AND a short common-password dictionary check
      (resolves B15, G-S3.5).
- [ ] 2.5 [fix] Include `samlSigningCertificate` in the normalised client
      output at `services/adapters/src/keycloak-admin.mjs:182-205` when the
      client protocol is `saml` (resolves B16, G-S3.6).
- [ ] 2.6 [fix] Validate `authorizationDecisionId` at
      `services/adapters/src/keycloak-admin.mjs:483, :516` as a non-empty
      string matching a documented id grammar (e.g.
      `/^[a-z0-9-]{6,}$/`); reject otherwise (resolves B17, G-S3.7).
- [ ] 2.7 [fix] Add a realm-consistency check at every Keycloak per-kind
      branch: when both `context.realmId` and `payload.realm` are present
      and differ, emit `GW_IAM_REALM_MISMATCH` (resolves B18).

## 3. Validation

- [ ] 3.1 [docs] Document the slug/dedup/audit-id rules, the temp-password
      policy, the SAML cert carry-through, and the realm-consistency rule
      in `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run the six new tests; run
      `openspec validate harden-o1-secondary-validation-gaps --strict`; all
      green before merge.

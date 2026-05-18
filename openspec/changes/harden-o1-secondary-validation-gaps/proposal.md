## Why

Seven secondary validation gaps survive the headline fixes and combine into
collision, normalisation, and pass-through defects across both Kafka and
Keycloak adapters. From `openspec/audit/cap-o1-backing-system-adapters.md`:

- **B11** (`services/adapters/src/kafka-admin.mjs:135-142, :163-169`) — topic
  slugify strips non-alphanumerics; `'alpha-beta'` and `'alpha--beta'` both
  normalise to `alpha.beta`; two workspaces can collide on topic prefix.
- **B12** (`services/adapters/src/kafka-admin.mjs:442`) — ACL dedup key omits
  `patternType`; literal vs prefixed bindings on the same `(principal,
  resource, ops)` both pass dedup.
- **B13** (`services/adapters/src/kafka-admin.mjs:655`) — `auditRecordId =
  'aud_${callId.slice(-16)}'` with `'evt01'` default fallback. Multiple
  calls with similar last-16-char callIds or missing callId share the same
  audit id.
- **B15** (`services/adapters/src/keycloak-admin.mjs:456`) — temporary-password
  validation is length-only (≥ 12); `'aaaaaaaaaaaa'` passes.
- **B16** (`services/adapters/src/keycloak-admin.mjs:338-340, :182-205`) —
  SAML signing certificate extracted and validated for SAML clients but
  not included in the normalised client output; downstream consumers lose
  the cert.
- **B17** (`services/adapters/src/keycloak-admin.mjs:483, :516`) —
  `authorizationDecisionId` passed through without validation.
- **B18** (`services/adapters/src/keycloak-admin.mjs`, same `??` fallback
  as B7) — `realmId` not validated for consistency between context and
  payload.
- **G-S2.5**, **G-S2.6**, **G-S2.10**, **G-S3.5**, **G-S3.6**, **G-S3.7**,
  **G-S3.10** — same findings restated as gaps.

## What Changes

- Kafka slugify (`:135-142`): collapse repeated separator runs into a
  single `.` and reject input that produces a slug already used by another
  managed workspace; the validator MUST surface a collision violation.
- Kafka ACL dedup (`:442`): include `patternType` in the dedup key.
- Kafka audit-record id (`:655`): replace the 16-char suffix with a real
  unique id (UUIDv4 or hash-of-callId-plus-timestamp); the `evt01` default
  MUST go.
- Keycloak temporary password (`:456`): add a charset-class check (at
  least 3 of 4 of {lower, upper, digit, symbol}) plus a dictionary check
  against a short common-password list.
- Keycloak SAML cert preservation (`:182-205`): include
  `samlSigningCertificate` in the normalised client output for clients
  whose protocol is `saml`.
- Keycloak `authorizationDecisionId` (`:483, :516`): validate as a
  non-empty string matching a documented id grammar.
- Keycloak `realmId` consistency: when both `context.realmId` and
  `payload.realm` are present, they MUST be equal; otherwise emit
  `GW_IAM_REALM_MISMATCH`.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: Kafka slugify, dedup, and audit-id
  derivation MUST be collision-resistant; Keycloak temporary passwords MUST
  satisfy charset and dictionary rules; SAML cert MUST be carried in the
  normalised output; authorization-decision id MUST be validated; realm
  references MUST be consistent.

## Impact

- Affected code: `services/adapters/src/kafka-admin.mjs` (`:135-142`,
  `:163-169`, `:442`, `:655`); `services/adapters/src/keycloak-admin.mjs`
  (`:182-205`, `:338-340`, `:456`, `:483`, `:516`); tests under
  `services/adapters/tests/`.
- Cross-cutting: realm-consistency rule reinforces the context-only realm
  read from `fix-o1-acl-prefix-and-realm-fallback`.
- Breaking changes: temp passwords that previously passed length-only will
  now require charset diversity; ACL submissions relying on the dedup
  collision will start receiving paired entries.
- Out of scope: executor implementation (covered by
  `complete-o1-executor-stubs`); authorization-policy validation (covered
  by `harden-o1-authorization-policy-adoption`).

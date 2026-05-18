## Why

The Keycloak adapter echoes the raw caller payload (including any secret
material) into the audit envelope and hard-codes a contract-version fallback
that drifts from sibling adapters. From
`openspec/audit/cap-o1-backing-system-adapters.md`:

- **B4** (`services/adapters/src/keycloak-admin.mjs:506`) — verified-by-author:
  `payload.providerPayload = payload`. If the payload contains
  `clientSecret`, `signingCertificatePem`, password, or any secret material,
  it is included verbatim in the envelope returned by
  `buildIamAdminAdapterCall`. No sanitiser; M2 forbidden-field policy is not
  applied here.
- **B8** (`services/adapters/src/keycloak-admin.mjs:152, :510`) —
  verified-by-author: `iamAdminRequestContract?.version ?? '2026-03-24'` at
  both sites. If the contract is unloaded, every envelope advertises a stale
  date.
- **G4** (cross-cutting) — D1 PostgreSQL uses `'2026-03-24'`, Mongo and Kafka
  reference `'2026-03-25'`, OpenWhisk uses `'2026-03-25'`, Keycloak uses
  `'2026-03-24'`. Three different dates across one capability boundary.
- **G7** (cross-cutting) — `providerPayload`-style raw-payload echo in audit
  envelope flagged across adapters; Keycloak explicit.
- **G-S3.4** — same finding restated.

## What Changes

- Replace `providerPayload: payload` at `keycloak-admin.mjs:506` with a
  sanitiser that strips known-secret fields (`clientSecret`,
  `signingCertificatePem`, `temporaryPassword`, `password`,
  `apiToken`, `refreshToken`) and any field whose name matches
  `/secret|password|token|credential|certificate/i`.
- Replace both hard-coded `'2026-03-24'` fallbacks at
  `keycloak-admin.mjs:152, :510` with a fail-fast: if
  `iamAdminRequestContract?.version` is unloaded, throw
  `Error('IAM_ADMIN_CONTRACT_VERSION_UNAVAILABLE')` so the runtime never
  advertises a contract version it cannot back.
- Add a CI scan under `services/adapters/tests/` that asserts no adapter
  `.mjs` carries a hard-coded contract-version literal matching
  `/^['"]\d{4}-\d{2}-\d{2}['"]$/` as a fallback for an undefined contract
  version.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: Keycloak audit envelopes MUST NOT contain
  unsanitised payload secrets; adapters MUST fail-fast rather than advertise
  a hard-coded fallback contract version.

## Impact

- Affected code: `services/adapters/src/keycloak-admin.mjs` (`:152`,
  `:506`, `:510`); a sanitiser helper either in
  `services/adapters/src/authorization-policy.mjs` or a new
  `services/adapters/src/payload-sanitiser.mjs`; new CI scan.
- Cross-cutting: same drift family flagged in F1
  (`fix-f1-contract-version-fallbacks`) and the per-cap fixes — this
  proposal owns the Keycloak case and the cross-adapter scan.
- Breaking changes: consumers reading `providerPayload.clientSecret` from
  the envelope will stop seeing it; runtime errors when the contract
  package is misloaded instead of silent stale-version envelopes.
- Out of scope: SAML cert preservation (covered by
  `harden-o1-secondary-validation-gaps` B16); per-provider stub coverage
  (covered by `complete-o1-executor-stubs`).

## Why

The Keycloak adapter enforces the reserved-scope policy on the `scope`
resource but lets realms and clients reference reserved scope names freely,
and a single `context.scope === 'platform'` flag bypasses the reserved-realm
guard with no further attestation. From
`openspec/audit/cap-o1-backing-system-adapters.md`:

- **B6** (`services/adapters/src/keycloak-admin.mjs:416` vs `:307-308`,
  `:335-336`) — `scope` resource validation blocks
  `RESERVED_SCOPE_NAMES = {openid, profile, email, roles, web-origins}`. But
  realm validation at `:307-308` and client validation at `:335-336` allow
  `defaultScopes`/`optionalScopes` to reference these reserved names freely.
  Asymmetry — a caller can attach a reserved scope to any client without
  violation.
- **G-S3.3** — same finding restated as a major gap.
- **G-S3.11** (`services/adapters/src/keycloak-admin.mjs:301`) — reserved-realm
  bypass `context.scope === 'platform'` lets a misconfigured caller target
  `master` or `in-falcone-platform` realms by setting platform scope.

## What Changes

- Extract the reserved-scope check into a shared helper applied to:
  - the `scope` resource validation (existing at `:416`),
  - realm `defaultScopes` and `optionalScopes` (`:307-308`),
  - client `defaultScopes` and `optionalScopes` (`:335-336`).
- Strengthen the reserved-realm bypass at `:301`: `context.scope === 'platform'`
  is not sufficient; the bypass MUST require BOTH
  `context.scope === 'platform'` AND a non-empty
  `context.platformAttestationId` (the same attestation contract any
  platform action requires). Missing attestation MUST yield
  `GW_IAM_RESERVED_REALM_NOT_ATTESTED`.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: the reserved-scope policy MUST apply
  uniformly across realm, client, and scope resources; the reserved-realm
  bypass MUST require an attestation id in addition to the platform-scope
  flag.

## Impact

- Affected code: `services/adapters/src/keycloak-admin.mjs` (`:301`, `:307-308`,
  `:335-336`, `:416`); tests under `services/adapters/tests/`.
- Cross-cutting: the attestation id MAY come from the same source the
  `harden-o1-authorization-policy-adoption` helper validates; this proposal
  is mergeable independently.
- Breaking changes: callers that today attach `openid`/`profile`/`email`/
  `roles`/`web-origins` to a custom client via `defaultScopes` will start
  receiving violations; callers that today reach reserved realms with
  `context.scope === 'platform'` alone will need to provide the attestation
  id.
- Out of scope: payload sanitisation (covered by
  `fix-o1-payload-echo-and-version-fallbacks`); SAML cert preservation
  (covered by `harden-o1-secondary-validation-gaps`).

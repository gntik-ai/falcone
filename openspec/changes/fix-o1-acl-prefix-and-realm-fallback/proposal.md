## Why

Three prefix/fallback constructions in the adapters silently let attacker-shaped
inputs escape isolation boundaries. From
`openspec/audit/cap-o1-backing-system-adapters.md`:

- **B2** (`services/adapters/src/kafka-admin.mjs:419`) — verified-by-author:
  `binding.principal.startsWith(profile.namingPolicy.serviceAccountPrincipalPrefix)`.
  If the policy prefix is `User:svc_alpha_dev_`, an attacker principal
  `User:svc_alpha_dev_ATTACKER_suffix` passes the check and becomes part of
  the ACL binding.
- **B7** (`services/adapters/src/keycloak-admin.mjs:184, :210, :221, :236`) —
  `realmId: context.realmId ?? payload.realm` at every per-kind branch. If
  both are `undefined`, the resource is normalised with `realmId: undefined`
  and joined to the wrong realm downstream.
- **B14** (`services/adapters/src/keycloak-admin.mjs:374`) — workspace
  clientId namespace check is `clientId.startsWith(workspaceClientNamespace)`
  only. Workspaces with overlapping prefixes (`ws-a` and `ws-a-backup`) can
  collide on clientId.
- **G-S2.4**, **G-S3.8**, **G-S3.9** — same findings restated as gaps.

## What Changes

- Replace the `startsWith` ACL principal check at `kafka-admin.mjs:419` with
  a strict-match against the documented suffix grammar: principals MUST be
  exactly `${prefix}${alphanumDash}` with no further `_`-delimited segments
  after the policy suffix.
- Replace the `?? payload.realm` fallback chain at
  `keycloak-admin.mjs:184, :210, :221, :236` with a context-only read; an
  undefined `context.realmId` MUST yield a `GW_ADAPTER_REALM_MISSING`
  violation and short-circuit normalisation.
- Replace the `startsWith` clientId namespace check at
  `keycloak-admin.mjs:374` with an exact-segment match: the clientId MUST be
  `${namespace}_${alphanumDashSegment}` where the segment contains no
  further namespace-separator characters that could overlap a sibling
  namespace.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: ACL principal validation MUST use exact
  suffix grammar; realmId MUST come from context only (no payload
  fallback); clientId namespace MUST be exact-segment, not prefix.

## Impact

- Affected code: `services/adapters/src/kafka-admin.mjs` (`:419`);
  `services/adapters/src/keycloak-admin.mjs` (`:184, :210, :221, :236, :374`);
  tests under `services/adapters/tests/`.
- Cross-cutting: complements `fix-o1-context-trust-from-payload` (same
  family of payload-trust defects).
- Breaking changes: principals or clientIds shaped to exploit the prefix
  match will now be rejected; documented in the runbook so legitimate
  callers using the suffix shape (if any) can be migrated.
- Out of scope: SAML cert preservation (covered by
  `harden-o1-secondary-validation-gaps`); environment downgrade (covered by
  `fix-o1-environment-and-tier-silent-downgrade`).

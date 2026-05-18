## Why

The shared adapter authorization contract exists but is consumed by zero
adapters, leaving the adapter layer trusting caller-supplied authorization
context. From `openspec/audit/cap-o1-backing-system-adapters.md`:

- **B9** (`services/adapters/src/authorization-policy.mjs` vs every
  `services/adapters/src/*.mjs`) — `grep -rln "authorization-policy"
  services/adapters/src/` returns only the README. The 18-LOC shared module
  exports `adapterEnforcementSurfaces`, `adapterContextTargets`, and
  `workspaceOwnedResourceSemantics` but no adapter imports it.
- **G1** (same module) — exported by README, consumed by nobody. The
  README's claim that the module is "the adapter-facing enforcement surface
  for contextual authorization" is decorative.
- **G2** (verified across every adapter in this directory) — `scopes`,
  `effectiveRoles`, `authorization_decision_id`, `actor_id` are accepted
  from `buildXxxAdapterCall(payload)` and threaded into envelopes without
  validation.
- **G-S2.1** (`services/adapters/src/kafka-admin.mjs:514-515, :722, :754`) —
  Kafka adapter passes `scopes`/`effectiveRoles`/`authorizationDecisionId`
  to its envelope without checking.
- **G-S3.1** (`services/adapters/src/keycloak-admin.mjs`, confirmed via grep)
  — Keycloak adapter has zero authorization enforcement.

## What Changes

- Wire `authorization-policy.mjs` into every `buildXxxAdapterCall` so that
  before an envelope is built, the adapter validates the caller-supplied
  `(scopes, effectiveRoles, authorization_decision_id)` against the
  `adapterEnforcementSurfaces` set the policy module exports. Mismatches MUST
  return `{ok: false, violations: [{code: 'GW_ADAPTER_AUTHZ_NOT_ATTESTED',
  ...}]}` instead of building the envelope.
- Validate that `actor_id` is present and matches a non-anonymous shape; an
  envelope built for an anonymous caller against a non-public surface MUST
  return a violation.
- Add a CI check that every adapter `.mjs` file imports
  `authorization-policy` or carries an explicit `// authorization-policy:
  not-applicable` comment with a reason.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: every adapter `buildXxxAdapterCall` MUST
  validate the caller-supplied authorization context against
  `authorization-policy.mjs` before building an envelope; the README's claim
  about the module being the enforcement surface MUST be code-enforced.

## Impact

- Affected code: every `services/adapters/src/*.mjs` file (~25 files); the
  shared module `services/adapters/src/authorization-policy.mjs` MAY need a
  helper export (e.g., `validateAdapterCallAuthorization(context, surface)`);
  a new CI check under `services/adapters/tests/`.
- Cross-cutting: the validation MUST be a no-op for adapter calls that the
  policy explicitly marks as public; otherwise the change creates new
  rejections for callers that previously slipped through.
- Breaking changes: callers that today pass an empty `scopes` or no
  `authorization_decision_id` will start getting violations; document the
  upgrade path so consumers attach the required attestation context.
- Out of scope: the trust-in-payload identity fields (`tenantId`,
  `workspaceId`) covered by `fix-o1-context-trust-from-payload`; per-provider
  validation gaps covered by other proposals.

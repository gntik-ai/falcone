## Why

The Kafka adapter accepts `tenantId` and `workspaceId` from the caller
payload as a fallback when context is missing, and passes `scopes` and
`effectiveRoles` straight through to the envelope. The pattern recurs across
adapters. From `openspec/audit/cap-o1-backing-system-adapters.md`:

- **B1** (`services/adapters/src/kafka-admin.mjs:475`) — verified-by-author:
  `tenantId: context.tenantId ?? payload.tenantId, workspaceId:
  context.workspaceId ?? payload.workspaceId`. A caller controlling payload
  can inject a different workspace id and derive a naming policy that
  escapes the intended boundary.
- **G-S2.3** (`kafka-admin.mjs:475`) — same finding restated as a major gap.
- **G-S3.2** (`services/adapters/src/keycloak-admin.mjs:480-481, :514-515`) —
  `scopes` and `effectiveRoles` passed through unchecked into the envelope;
  the adapter accepts whatever the caller asserts.

## What Changes

- Remove the `?? payload.tenantId` and `?? payload.workspaceId` fallbacks at
  `kafka-admin.mjs:475`. `tenantId` and `workspaceId` MUST come from
  `context` only. A missing or empty context value MUST return
  `{ok: false, violations: [{code: 'GW_ADAPTER_CONTEXT_MISSING', field:
  'tenantId'|'workspaceId'}]}`.
- Apply the same context-only rule to every adapter that today reads
  `tenantId`/`workspaceId` from payload (audited individually in H1 B1 for
  OpenWhisk and E1 B1 for Mongo; this proposal owns the Kafka case and the
  cross-adapter parity check).
- Add an explicit contract that `scopes` and `effectiveRoles` in
  `buildIamAdminAdapterCall` MUST be the intersection of the caller's
  attested claims and the `adapterEnforcementSurfaces` mapping; raw
  pass-through MUST be replaced with the validated copy
  `harden-o1-authorization-policy-adoption` introduces.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: adapter `tenantId`/`workspaceId` MUST come
  from `context` only; `scopes`/`effectiveRoles` MUST be validated against
  the shared authorization policy before being placed in the envelope.

## Impact

- Affected code: `services/adapters/src/kafka-admin.mjs` (`:475`);
  `services/adapters/src/keycloak-admin.mjs` (`:480-481, :514-515`); a new
  CI scan under `services/adapters/tests/`.
- Cross-cutting: relies on `harden-o1-authorization-policy-adoption` for the
  shared validator; the two proposals reinforce each other but each is
  individually mergeable (this one falls back to a structural
  context-presence check if the validator helper is not yet available).
- Breaking changes: callers that today inject `payload.tenantId` to override
  context will start receiving `GW_ADAPTER_CONTEXT_MISSING`; this is the
  intended behaviour.
- Out of scope: realm/clientId namespace bypass (covered by
  `fix-o1-acl-prefix-and-realm-fallback`); silent plan-tier downgrade
  (covered by `fix-o1-environment-and-tier-silent-downgrade`).

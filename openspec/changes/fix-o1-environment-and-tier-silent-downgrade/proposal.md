## Why

Two Kafka adapter helpers silently map unknown inputs to a default value with
no log and no violation, and the same downgrade leaks the topic-capability
enable flag past the plan boundary. From
`openspec/audit/cap-o1-backing-system-adapters.md`:

- **B3** (`services/adapters/src/kafka-admin.mjs:148-157, :281`) — unknown
  `planId` silently maps to `'starter'`; then
  `topicCapabilityEnabled = resolvedCapability || (resolvedTopicQuota?.limit
  ?? 0) > 0`. If a quota override accidentally sets `limit > 0` for a starter
  tenant, the capability is silently enabled despite the plan disallowing
  it. Fail-open authorization through quota override.
- **B5** (`services/adapters/src/kafka-admin.mjs:159-161`) — `deriveEnvironment`
  maps only `{dev, sandbox, staging, prod}`; an unknown value silently
  becomes `'dev'`. Topic prefix becomes `ia.<tenant>.<workspace>.dev` even
  for `workspaceEnvironment='production'`. Production traffic pollutes dev
  cluster naming.
- **G-S2.2** (`:148-157`), **G-S2.9** (`:159-161`) — same findings restated
  as gaps.

## What Changes

- `derivePlanTier`: an unrecognised `planId` MUST emit a violation
  `GW_ADAPTER_UNKNOWN_PLAN_TIER` instead of silently mapping to `'starter'`.
- `topicCapabilityEnabled`: the boolean MUST be derived from
  `resolvedCapability` alone. A quota override MUST NOT enable the
  capability when the plan tier disallows it.
- `deriveEnvironment`: an unrecognised environment value MUST emit
  `GW_ADAPTER_UNKNOWN_ENVIRONMENT`; the prefix MUST NOT silently default to
  `dev`.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: Kafka adapter MUST reject unknown plan tiers
  and unknown environments with explicit violations; the topic-capability
  enable flag MUST come from the plan capability alone, not from quota
  override side-effects.

## Impact

- Affected code: `services/adapters/src/kafka-admin.mjs` (`:148-157`,
  `:159-161`, `:281`); tests under `services/adapters/tests/`.
- Cross-cutting: the same silent-downgrade pattern is flagged across F1, H1,
  E1, G1 audits — each provider's adapter is fixed in its own per-cap
  proposal; this one owns the Kafka case.
- Breaking changes: callers that today pass an unknown plan or environment
  string will start getting violations; document the upgrade.
- Out of scope: per-provider error-code map drift (covered by
  `fix-o1-payload-echo-and-version-fallbacks`); secondary validation gaps
  (covered by `harden-o1-secondary-validation-gaps`).

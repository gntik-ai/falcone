## 1. Failing tests

- [ ] 1.1 [test] Add a test under `services/adapters/tests/` that calls
      `derivePlanTier('plan-unknown-x')` and asserts the result is
      `{ok: false, violations: [{code: 'GW_ADAPTER_UNKNOWN_PLAN_TIER'}]}`;
      today the function silently returns `'starter'` (proves B3 part 1,
      G-S2.2).
- [ ] 1.2 [test] Add a test that calls `validateKafkaAdminRequest` with a
      starter tenant whose quota override sets `limit > 0` for topics, and
      asserts `topicCapabilityEnabled === false`; today the boolean is
      `true` via the override (proves B3 part 2).
- [ ] 1.3 [test] Add a test that calls `deriveEnvironment('production')`
      and asserts a `GW_ADAPTER_UNKNOWN_ENVIRONMENT` violation (the
      canonical value is `prod`); today the function silently returns
      `'dev'` (proves B5, G-S2.9).

## 2. Implementation

- [ ] 2.1 [fix] Replace the silent default in `derivePlanTier` at
      `services/adapters/src/kafka-admin.mjs:148-157` with an explicit
      violation `GW_ADAPTER_UNKNOWN_PLAN_TIER` for unrecognised plan ids;
      preserve `starter` as a return value only when the planId
      case-insensitively contains `starter` (resolves B3 part 1, G-S2.2).
- [ ] 2.2 [fix] Change the `topicCapabilityEnabled` derivation at
      `services/adapters/src/kafka-admin.mjs:281` to
      `resolvedCapability` only; remove the
      `|| (resolvedTopicQuota?.limit ?? 0) > 0` clause so quota override
      cannot enable a capability the plan disallows (resolves B3 part 2).
- [ ] 2.3 [fix] Replace the silent default in `deriveEnvironment` at
      `services/adapters/src/kafka-admin.mjs:159-161` with an explicit
      violation `GW_ADAPTER_UNKNOWN_ENVIRONMENT`; the canonical set stays
      `{dev, sandbox, staging, prod}` (resolves B5, G-S2.9).

## 3. Validation

- [ ] 3.1 [docs] Document the new violation codes and the canonical plan-tier
      / environment sets in `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run the three new tests; run
      `openspec validate fix-o1-environment-and-tier-silent-downgrade --strict`;
      all green before merge.

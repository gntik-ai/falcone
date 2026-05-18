## 1. Failing tests

- [ ] 1.1 [test] Add `services/audit/test/inline-events.contract.test.mjs`
      asserting `capabilityEnforcementDeniedEvent` validates against
      `observability-audit-event-schema.json` (10-field envelope with
      `actor/scope/resource/action/result/origin` nesting), proving B3
      from `contract-boundary.mjs:24-43`.
- [ ] 1.2 [test] Add a case asserting `actorType` values resolve to one
      of the six canonical `actor.actor_type` enum values, proving B4
      from `:32`.
- [ ] 1.3 [test] Add a case asserting every inline event constant carries
      `schema_version === '2026-03-28'` and that the test fails when the
      canonical contract version is bumped without updating the constant,
      proving B10 / G10.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `capabilityEnforcementDeniedEvent` at
      `contract-boundary.mjs:24-43` into the canonical 10-field envelope;
      move the 14 flat fields into the `detail` block where they don't
      map onto canonical envelope fields.
- [ ] 2.2 [fix] Replace the local `actorType` enum at
      `contract-boundary.mjs:32` with the canonical six-value enum;
      delete the literal `'user'` and `'service_account'` ad-hoc list.
- [ ] 2.3 [impl] Add `services/audit/src/legacy-actor-type-map.mjs`
      exporting `mapLegacyActorType(legacyValue, scope)` returning a
      canonical `actor_type`; document the two-line lookup.
- [ ] 2.4 [fix] Stamp the inline event with `schema_version:
      '2026-03-28'` matching `observability-audit-event-schema.json:2`.
- [ ] 2.5 [impl] Hoist the contract version to a shared constant
      `CANONICAL_SCHEMA_VERSION` imported by both the schema validator
      (per `complete-m1-*`) and the inline event so a single update
      flows through both.

## 3. Validation

- [ ] 3.1 [docs] Document the canonical envelope mapping and the legacy
      `actorType` translation in `services/audit/src/README.md`.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/audit test` and
      `openspec validate fix-m1-canonical-envelope-conformance --strict`;
      both green.

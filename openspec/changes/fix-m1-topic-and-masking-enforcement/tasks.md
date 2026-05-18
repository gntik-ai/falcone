## 1. Failing tests

- [ ] 1.1 [test] Add `services/audit/test/topic-router.test.mjs`
      asserting `routeTopic({scope: {mode:'tenant', tenant_id:'T1'}})
      === 'audit.T1'` and `routeTopic({scope: {mode:'platform'}}) ===
      'audit.platform'`; assert any other topic string throws, proving
      B7 from the cross-emitter cite.
- [ ] 1.2 [test] Add `services/audit/test/masking-policy.test.mjs`
      asserting an envelope with `detail.password = 'p'`,
      `detail.api_secret = 's'`, `detail.access_token = 't'` has all
      three stripped after `applyMaskingPolicy`, proving B8 from
      `observability-audit-pipeline.json:272-282`.
- [ ] 1.3 [test] Add a lint-rule test asserting an ESLint run flags
      any literal `'platform.audit.events'`, `'console.audit'`,
      `'console.audit.gateway'`, `'console.webhook.*'`, or
      `'mongo.admin'` Kafka-topic string, proving G7.

## 2. Implementation

- [ ] 2.1 [impl] Implement `services/audit/src/topic-router.mjs`
      exporting `routeTopic(envelope)` per
      `observability-audit-pipeline.json:154-158`; throw
      `AuditTopicError` on unsupported scope.
- [ ] 2.2 [impl] Implement `services/audit/src/masking-policy.mjs`
      exporting `applyMaskingPolicy(envelope)` covering the nine
      canonical forbidden fields plus `_<field>` / `<field>_` variants
      (e.g., `api_secret`, `client_secret`, `access_token`).
- [ ] 2.3 [fix] Add the repo-root ESLint rule forbidding
      Kafka-topic literals matching the legacy conventions; configure
      it as `error` so CI fails on any new legacy topic literal.
- [ ] 2.4 [docs] Document the canonical topic conventions and the
      masking-field list in `services/audit/src/README.md`.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/audit test`,
      `pnpm -w lint`, and
      `openspec validate fix-m1-topic-and-masking-enforcement --strict`;
      all green.

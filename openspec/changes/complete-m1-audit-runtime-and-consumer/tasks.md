## 1. Failing tests

- [ ] 1.1 [test] Add `services/audit/test/emit.test.mjs` cases: (a) a
      well-formed canonical envelope is accepted and routed to
      `audit.<tenant_id>`; (b) a missing required field throws
      `AuditValidationError`; (c) a forbidden field name (`password`,
      `secret`, `token`, etc.) is masked before publish, proving B1 from
      `services/audit/` and G6 from the cross-emitter grep.
- [ ] 1.2 [test] Add `services/backup-status/test/audit-emitter.contract.test.mjs`
      asserting the migrated emitter calls `emitAuditEvent` with a
      canonical envelope (not the legacy `'backup.*' / 'restore.*'` ad-hoc
      shape), proving B2 from the consumer grep.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/audit/src/schema-validator.mjs` wrapping
      AJV against `observability-audit-event-schema.json`; export
      `validateEnvelope(envelope)` throwing `AuditValidationError` on
      failure.
- [ ] 2.2 [impl] Add `services/audit/src/topic-router.mjs` exporting
      `routeTopic(envelope)` returning `audit.${tenant_id}` for tenant
      scope or `audit.platform` otherwise, per
      `observability-audit-pipeline.json:154-158`.
- [ ] 2.3 [impl] Add `services/audit/src/masking-policy.mjs` enforcing
      the forbidden-field list from
      `observability-audit-pipeline.json:272-282`.
- [ ] 2.4 [impl] Add `services/audit/src/emit.mjs` composing validator +
      masker + router + Kafka producer; export `emitAuditEvent(envelope)`.
- [ ] 2.5 [migration] Rewrite
      `services/backup-status/src/audit/audit-emitter.mjs` to build a
      canonical envelope and call `emitAuditEvent` instead of publishing
      to `platform.audit.events` directly.
- [ ] 2.6 [fix] Replace `services/audit/package.json:7-9` placeholders
      with real `vitest run` and `eslint .` commands; add `ajv` and
      `kafkajs` to dependencies.

## 3. Validation

- [ ] 3.1 [docs] Rewrite `services/audit/src/README.md` documenting
      `emitAuditEvent`, the canonical envelope, and the single-emitter
      contract.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/audit test`,
      `pnpm --filter @in-falcone/backup-status test`, and
      `openspec validate complete-m1-audit-runtime-and-consumer --strict`;
      all green.

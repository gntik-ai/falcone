## 1. Failing tests

- [ ] 1.1 [test] Add `services/secret-audit-handler/test/topic.test.mjs`
      asserting the default topic is `'audit.platform'` (not
      `'console.secrets.audit'`), proving B9 from `index.mjs:7`.
- [ ] 1.2 [test] Add `services/secret-audit-handler/test/partition-key.test.mjs`
      asserting `publishAuditEvent` sends with `key === event.tenantId`
      (or `'platform'` when absent) and never with `key ===
      event.domain`, proving B10 from `kafka-publisher.mjs:22`.
- [ ] 1.3 [test] Add a case asserting events carry a `tenantId` field
      sourced from Vault `auth.metadata.tenant_id`, falling back to
      `'platform'`, proving G10.

## 2. Implementation

- [ ] 2.1 [fix] Change the default at `index.mjs:7` from
      `'console.secrets.audit'` to `'audit.platform'`; update the
      env-var name and the README accordingly.
- [ ] 2.2 [fix] Change `key: event.domain` at
      `kafka-publisher.mjs:22` to
      `key: event.tenantId ?? 'platform'`.
- [ ] 2.3 [impl] Add `tenantId` extraction to `parseVaultEntry` in
      `vault-log-reader.mjs` (read `auth.metadata.tenant_id`; default
      `'platform'`).
- [ ] 2.4 [migration] Add `tenantId` to the `SecretAuditEvent` schema
      constant in `event-schema.mjs` and to the canonical YAML
      `secret-audit-event-v1.yaml`; mark as required.
- [ ] 2.5 [docs] Document the topic + partition migration in
      `services/secret-audit-handler/README.md`; include the
      consumer-resubscription steps.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/secret-audit-handler test`
      and `openspec validate fix-m2-topic-and-partitioning-alignment --strict`;
      both green.

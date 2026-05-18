## 1. Failing tests

- [ ] 1.1 [test] Add `services/secret-audit-handler/test/event-schema.test.mjs`
      cases: (a) an event with `domain: 'unknown'` is rejected; (b) an
      event with `operation: 'banana'` is rejected; (c) an event with
      an extra unknown property is rejected, proving B4 from
      `event-schema.mjs:39-48`.
- [ ] 1.2 [test] Add `services/secret-audit-handler/test/parser.test.mjs`
      asserting `parseVaultEntry` with a path lacking `secret/data/`
      yields `domain: 'platform'` (one of the canonical enum values)
      and never `'unknown'`, proving B5 from `vault-log-reader.mjs:7-8`.
- [ ] 1.3 [test] Add `services/secret-audit-handler/test/sanitizer.test.mjs`
      asserting `secret_value`, `api_key`, `access-token`, and
      `client_secret` are stripped, proving B6 from `sanitizer.mjs:3`.
- [ ] 1.4 [test] Add a contract test asserting the JS schema constant
      is byte-identical (after normalisation) to the canonical YAML
      `secret-audit-event-v1.yaml`, proving B7.

## 2. Implementation

- [ ] 2.1 [migration] Add `ajv` and `ajv-formats` to
      `services/secret-audit-handler/package.json` dependencies.
- [ ] 2.2 [fix] Replace `validateAuditEvent` at
      `event-schema.mjs:39-48` with an AJV-compiled validator over
      `SecretAuditEvent`; throw `SchemaValidationError` on any
      enum/format/additionalProperties violation.
- [ ] 2.3 [fix] Fix `parseVaultEntry` at `vault-log-reader.mjs:7-8` to
      coerce unrecognised prefixes to `'platform'` (matching the
      destructuring default's intent).
- [ ] 2.4 [fix] Broaden the matcher at `sanitizer.mjs:3` to
      `/(^|[-_])(value|data|secret|password|token|key)([-_]|$)/i` so
      composite key names are stripped.
- [ ] 2.5 [impl] Add
      `services/secret-audit-handler/scripts/generate-schema-from-yaml.mjs`
      reading `secret-audit-event-v1.yaml` and writing
      `event-schema.generated.mjs`; wire as a pre-test/pre-build hook.

## 3. Validation

- [ ] 3.1 [docs] Update `services/secret-audit-handler/README.md`
      documenting the AJV validator and the YAML-as-single-source rule.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/secret-audit-handler test`
      and `openspec validate fix-m2-event-schema-validation --strict`;
      both green.

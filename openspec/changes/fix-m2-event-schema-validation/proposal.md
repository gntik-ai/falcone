## Why

The hand-rolled `validateAuditEvent` accepts events with invalid enum
values, the parser produces out-of-enum `domain` values, the sanitiser
misses common variants, and the YAML and JS schemas disagree on policy.
From `openspec/audit/cap-m2-secret-audit-pipeline.md`:

- **B4** (`services/secret-audit-handler/src/event-schema.mjs:39-48`) —
  `validateAuditEvent` checks only required-field presence and forbidden
  fields. The schema constant at `:3-28` declares enums for `operation`,
  `domain`, `result`, `requestorIdentity.type`, plus format and
  `additionalProperties: false` — none enforced. AJV is not declared.
- **B5** (`vault-log-reader.mjs:7-8`) — `domain` defaults to the literal
  string `'unknown'` when the path lacks the `secret/data/` prefix;
  `'unknown'` is not in the canonical enum `['platform', 'tenant',
  'functions', 'gateway', 'iam']`.
- **B6** (`sanitizer.mjs:3`) — `forbiddenMatcher` is anchored exact-key.
  Hyphenated/prefixed/suffixed keys (`secret_value`, `api_key`,
  `access-token`, `client_secret`) are not stripped.
- **B7** (`internal-contracts/secrets/secret-audit-event-v1.yaml` vs
  `event-schema.mjs:1`) — the canonical YAML forbids only `value` and
  `data`; the JS constant forbids 6. Two sources of truth, both
  incomplete.
- **G6** (no AJV dep) — schema-validity is hand-rolled and incomplete.
- **G19/G20** (`vault-log-reader.mjs`) — parser produces values outside
  the schema enum and the validator does not reject them.

## What Changes

- Add `ajv` and `ajv-formats` to `services/secret-audit-handler/package.json`.
  Replace `validateAuditEvent` with an AJV-compiled validator backed by
  the JSON-Schema-shaped `SecretAuditEvent` constant; enforce enums,
  formats, and `additionalProperties: false`.
- Fix the parser at `vault-log-reader.mjs:7-8` to return one of the five
  canonical `domain` enum values; an unrecognised prefix falls back to
  `'platform'` (the default per the destructuring contract).
- Broaden `forbiddenMatcher` at `sanitizer.mjs:3` to match
  case-insensitive substrings/word-boundaries on the canonical forbidden
  set (`(^|[-_])(value|data|secret|password|token|key)([-_]|$)`).
- Reconcile the YAML and JS schemas: generate the JS schema constant
  from the canonical YAML at build time; both consumers SHALL agree.

## Capabilities

### Modified Capabilities

- `secret-management`: event-schema validation, parser-domain
  vocabulary, sanitiser-matcher breadth, and YAML/JS schema unification.

## Impact

- **Affected code**:
  `services/secret-audit-handler/src/event-schema.mjs`,
  `services/secret-audit-handler/src/vault-log-reader.mjs`,
  `services/secret-audit-handler/src/sanitizer.mjs`,
  `services/secret-audit-handler/package.json`, new
  `services/secret-audit-handler/scripts/generate-schema-from-yaml.mjs`.
- **Migration required**: build step adds a schema-generation hook
  before `pnpm test` / `pnpm build`.
- **Breaking changes**: events that previously slipped past validation
  (`domain: 'unknown'`, unknown operation) now throw
  `SchemaValidationError`; the handler routes them to the parse-error
  DLQ once `complete-m2-tail-and-checkpoint` lands.
- **Out of scope**: the tailer/checkpoint behaviour (covered by
  `complete-m2-tail-and-checkpoint`); Kafka error handling
  (`fix-m2-kafka-errors-and-id-binding`).

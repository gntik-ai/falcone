Secret-audit sanitizer strips only by key name, not by value

**Change ID:** fix-secret-audit-value-redaction
**Capability:** audit
**Type:** bug
**Priority:** P2
**OpenSpec change:** openspec/changes/fix-secret-audit-value-redaction/

---

## Why

`sanitizer.mjs::stripForbidden` removes object entries whose **key** matches the `FORBIDDEN_FIELDS` deny-list (`['value', 'data', 'secret', 'password', 'token', 'key']`). It does not inspect the **values** of surviving fields. The post-sanitization guard `hasForbiddenField` in `event-schema.mjs` (lines 31-37) also only checks object key names. A Vault audit-log entry where secret material appears inside an allowed-key string field (e.g., a `message` or `denialReason` string that embeds the secret verbatim, or a `request.path` containing a secret path component) passes through unredacted and is published to the `console.secrets.audit` Kafka topic.

## What Changes

- Add value-level pattern matching to `stripForbidden`: replace any string value matching known secret formats (Vault token prefixes `hvs.`/`s.`, PEM headers, long base64 strings) with the sentinel `[REDACTED]`.
- Add allowlist-only field projection in `sanitize()` using `SecretAuditEvent.properties` as the source of truth — drop any top-level key not declared in the schema before publishing.
- Update `hasForbiddenField` in `event-schema.mjs` to return `true` when any string value matches known secret-value patterns.
- No change to the `SecretAuditEvent` schema, the Kafka topic name, or the published event structure for events that were already clean.

---

## Spec delta (EARS)

### Requirement: Secret-audit sanitizer MUST redact secret material appearing in string values

The system SHALL inspect every surviving string value in the sanitized audit-log entry for patterns matching known secret formats (long base64-encoded strings, hex tokens, PEM-formatted data) and SHALL replace any matching substring with the sentinel `[REDACTED]` before publishing the event to the `console.secrets.audit` topic.

#### Scenario: Secret value embedded in an allowed string field is redacted (bbx-secret-sanitize-value)

- **WHEN** a Vault audit-log entry is passed to the sanitizer where a field with an allowed key (e.g., `message`) contains a string value that matches a known secret pattern (e.g., a Vault secret value or a long base64 token)
- **THEN** the sanitized output replaces that string value (or the matching substring) with `[REDACTED]` and does NOT publish the raw secret material to `console.secrets.audit`

#### Scenario: Entry with no secret material in values passes through unchanged

- **WHEN** a Vault audit-log entry is passed to the sanitizer where no string value contains secret material
- **THEN** the sanitized output is identical to the input (with forbidden-keyed fields removed) and is published normally

### Requirement: Sanitizer MUST use allowlist-only field projection for the final exported event

The system SHALL project the sanitized audit-log entry onto the fields declared in `SecretAuditEvent.properties` before publishing, dropping any fields not in that allowlist. The system SHALL NOT publish any field that is not part of the declared `SecretAuditEvent` schema.

#### Scenario: Unknown field from Vault log is dropped before publishing

- **WHEN** a Vault audit-log entry contains a field whose key is not declared in `SecretAuditEvent.properties` (e.g., a future Vault extension field `extra_context` carrying secret material)
- **THEN** the sanitized output does NOT include that field and the field value is NOT published to `console.secrets.audit`

### Requirement: hasForbiddenField MUST detect secret material in string values

The system SHALL update `hasForbiddenField` to return `true` when any string value within the object matches a known secret-value pattern, in addition to its existing key-name check.

#### Scenario: hasForbiddenField detects secret in string value

- **WHEN** `hasForbiddenField` is called with an object whose allowed-key field contains a string value matching a known secret pattern
- **THEN** `hasForbiddenField` returns `true` and `sanitize` throws `Error('Forbidden field survived sanitization')`

---

## Tasks

### 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-secret-sanitize-value` to `tests/blackbox/` that passes a Vault audit-log entry to `sanitize()` where the `message` field (an allowed key) contains a string value matching a known secret pattern; assert that the returned event does NOT contain the raw secret string
- [ ] 1.2 Confirm the test fails (red) against the current unpatched code before proceeding

### 2. Implement the Fix

- [ ] 2.1 Define a `SECRET_VALUE_PATTERN` regex in `services/secret-audit-handler/src/sanitizer.mjs` that matches known secret formats (Vault token prefixes `hvs.`/`s.`, PEM `-----BEGIN`, long base64 strings above a safe threshold)
- [ ] 2.2 Add a `redactSecretValues(value)` helper in `sanitizer.mjs` that, for string values, replaces any substring matching `SECRET_VALUE_PATTERN` with `[REDACTED]`; for objects/arrays, recurses as `stripForbidden` does
- [ ] 2.3 Call `redactSecretValues` on each surviving value in `stripForbidden` after the key filter, before returning
- [ ] 2.4 Add an `ALLOWED_FIELDS` set derived from `Object.keys(SecretAuditEvent.properties)` in `event-schema.mjs` and apply an allowlist projection step in `sanitize()` after `stripForbidden` — drop any top-level key not in `ALLOWED_FIELDS`
- [ ] 2.5 Update `hasForbiddenField` in `services/secret-audit-handler/src/event-schema.mjs` to return `true` when any string value matches `SECRET_VALUE_PATTERN`

### 3. Verify

- [ ] 3.1 Confirm `bbx-secret-sanitize-value` test now passes (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

---

## Acceptance criteria

**bbx-secret-sanitize-value**: calling `sanitize()` with a Vault audit-log entry where an allowed-key field (e.g., `message`) contains a string value matching a known secret pattern (e.g., `hvs.CAESIJB...`) returns an event where that string value is replaced with `[REDACTED]`; the raw secret material does not appear anywhere in the published event.

---

## Code evidence

- `services/secret-audit-handler/src/sanitizer.mjs::stripForbidden` — lines 13-25: filters entries by key only (`!forbiddenMatcher.test(key)`); string values of surviving entries are returned as-is with no inspection
- `services/secret-audit-handler/src/event-schema.mjs::hasForbiddenField` — lines 31-37: inspects only key names (`normalized === field || normalized.endsWith(...)`) — does not examine string values
- `services/secret-audit-handler/src/event-schema.mjs::FORBIDDEN_FIELDS` — line 1: `['value', 'data', 'secret', 'password', 'token', 'key']` — deny-list with no value-pattern counterpart
- `services/secret-audit-handler/src/sanitizer.mjs::sanitize` — lines 5-11: calls `stripForbidden` then `hasForbiddenField`; neither step catches secret material in string values

---

## Resolution (OpenSpec)

1. `/opsx:apply fix-secret-audit-value-redaction` — implement the fix following tasks.md
2. `/opsx:verify fix-secret-audit-value-redaction` — run the verify profile
3. `bash tests/blackbox/run.sh` — confirm green
4. `/opsx:archive fix-secret-audit-value-redaction` — sync delta into openspec/specs/ and archive the change

Or use the wrapper: `/fix-bug fix-secret-audit-value-redaction`

Optional real E2E: `/e2e-issue fix-secret-audit-value-redaction`

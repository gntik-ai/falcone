## Why

`services/secret-audit-handler/src/sanitizer.mjs::stripForbidden` removes object entries whose **key** matches the `FORBIDDEN_FIELDS` list (`['value', 'data', 'secret', 'password', 'token', 'key']`). It does not inspect the **values** of surviving fields. A Vault audit-log entry where secret material appears inside an allowed string field (for example, a `message`, `error`, `request.path`, or `denialReason` string that embeds the secret verbatim) passes through unredacted and is published to the `console.secrets.audit` Kafka topic.

The guard `hasForbiddenField` that runs after `stripForbidden` (sanitizer.mjs line 7) also only checks object keys, not string values — so it cannot catch this case either. Secret material in string values reaches the audit topic, where any consumer of that topic can read it.

## What Changes

- Extend `stripForbidden` to also scan every surviving string value for patterns that match known secret material: regular-expression-based detection of common secret formats (base64 encoded strings above a length threshold, hex tokens, Vault secret path references) and/or allowlist-only export (export only the fields enumerated in `SecretAuditEvent` and redact or drop everything else).
- Preferred approach: replace the deny-list key filter with an **allowlist projection** that retains only the fields declared in `SecretAuditEvent.properties` and explicitly rejects any field not in that allowlist, eliminating the class of unknown-field leakage entirely.
- As a secondary layer, add value-level pattern matching for strings that match known secret formats (long base64, hex token, PEM header) and replace them with a `[REDACTED]` sentinel.
- Update `hasForbiddenField` in `event-schema.mjs` to also inspect string values for the sentinel absence or detect known secret value patterns.
- No change to the `SecretAuditEvent` schema or the Kafka topic name.

## Capabilities

### New Capabilities

- `audit`: Secret-audit sanitizer redacts secret material by value pattern and allowlist-only field projection, not only by key name; secret values embedded in allowed string fields are replaced with `[REDACTED]` before the event is published to the audit topic.

### Modified Capabilities

## Impact

- `services/secret-audit-handler/src/sanitizer.mjs::stripForbidden` (lines 13-25) — key-only filter, no value inspection
- `services/secret-audit-handler/src/event-schema.mjs::hasForbiddenField` (lines 31-37) — key-only check, does not detect secret material in string values
- `services/secret-audit-handler/src/event-schema.mjs::FORBIDDEN_FIELDS` (line 1) — deny-list replaced or supplemented by allowlist projection

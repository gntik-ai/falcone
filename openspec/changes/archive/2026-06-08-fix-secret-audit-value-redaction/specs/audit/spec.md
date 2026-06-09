## ADDED Requirements

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

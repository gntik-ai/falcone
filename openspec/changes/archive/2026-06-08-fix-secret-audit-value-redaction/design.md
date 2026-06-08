## Context

`sanitizer.mjs::stripForbidden` uses a deny-list approach: it recursively walks the Vault audit-log entry and removes any object entry whose key matches the `FORBIDDEN_FIELDS` regex (`/^(value|data|secret|password|token|key)$/i`). String values that survive the key filter are returned as-is. The post-sanitization guard `hasForbiddenField` (event-schema.mjs lines 31-37) also operates only on key names, so it cannot detect secret material embedded within a string value such as `message`, `error`, `request.path`, or `denialReason`.

Vault audit logs can include secret values in unexpected places: a `message` field explaining a denial might include the path or a partial value; an `error` field from a failed write might echo back the submitted data. Because the current sanitizer only operates on keys, these survive undetected.

The `SecretAuditEvent` schema (event-schema.mjs lines 3-29) already enumerates the exact fields that should appear in the published event. An allowlist projection is therefore straightforward and eliminates the entire class of unknown-field leakage, complementing the key-based approach.

## Goals / Non-Goals

**Goals:**
- Add value-level pattern matching to `stripForbidden` to redact known secret formats in string values.
- Add allowlist-only field projection using `SecretAuditEvent.properties` as the source of truth.
- Update `hasForbiddenField` to detect secret material in string values.
- Keep the `console.secrets.audit` topic contract unchanged.

**Non-Goals:**
- Changing the `SecretAuditEvent` schema or adding new fields to it.
- Modifying the Kafka topic name or partition strategy.
- Detecting arbitrary unknown secret formats beyond common patterns (long base64, hex tokens, PEM data).

## Decisions

**Decision: Apply allowlist projection as the primary defence; value-pattern matching as a secondary layer.**
Rationale: The allowlist approach gives the strongest guarantee — fields not in `SecretAuditEvent` simply never reach the topic, regardless of their content. Value-pattern matching addresses the residual risk of a known-schema field containing embedded secret material.

**Decision: Use `[REDACTED]` sentinel for replaced values rather than dropping the entire field.**
Rationale: Dropping the field changes the event structure and may break consumers. Replacing the value with a sentinel preserves the schema while making the redaction visible.

**Alternative considered:** Allow-list only, no value-pattern matching. Rejected: a `message` or `denialReason` field is legitimately included in `SecretAuditEvent` but could still carry embedded secret material; value scanning covers this case.

## Risks / Trade-offs

**Risk:** Value-pattern matching introduces false positives (legitimate high-entropy strings in `message` fields matched as secrets).
**Mitigation:** The pattern set should be conservative — match only unambiguous formats (PEM headers, Vault's `s.XXXXX` token format, `hvs.XXXXX`) rather than arbitrary entropy thresholds. Allowlist projection reduces the surface where false positives can occur.

**Risk:** Allowlist projection may drop fields that Vault adds in a future version that should be included in the audit event.
**Mitigation:** The `SecretAuditEvent` schema must be reviewed and updated when Vault is upgraded; this is the correct process regardless of the sanitizer strategy.

## Migration Plan

No schema or topic changes. The fix is additive to the existing sanitizer logic. Existing consumers of `console.secrets.audit` see no structural change to events that were already correct. Events that previously leaked secret material will now have those values replaced with `[REDACTED]`; consumer parsing is unaffected since the field type remains `string`.

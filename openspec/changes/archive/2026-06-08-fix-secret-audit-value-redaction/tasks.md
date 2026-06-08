## 1. Add Failing Black-Box Test

- [x] 1.1 Add test `bbx-secret-sanitize-value` to `tests/blackbox/` that passes a Vault audit-log entry to `sanitize()` where the `message` field (an allowed key) contains a string value matching a known secret pattern; assert that the returned event does NOT contain the raw secret string
- [x] 1.2 Confirm the test fails (red) against the current unpatched code before proceeding

## 2. Implement the Fix

- [x] 2.1 Define a `SECRET_VALUE_PATTERN` regex in `services/secret-audit-handler/src/sanitizer.mjs` that matches known secret formats (Vault token prefixes `hvs.`/`s.`, PEM `-----BEGIN`, long base64 strings above a safe threshold)
- [x] 2.2 Add a `redactSecretValues(value)` helper in `sanitizer.mjs` that, for string values, replaces any substring matching `SECRET_VALUE_PATTERN` with `[REDACTED]`; for objects/arrays, recurses as `stripForbidden` does
- [x] 2.3 Call `redactSecretValues` on each surviving value in `stripForbidden` after the key filter, before returning
- [x] 2.4 Add an `ALLOWED_FIELDS` set derived from `Object.keys(SecretAuditEvent.properties)` in `event-schema.mjs` and apply an allowlist projection step in `sanitize()` after `stripForbidden` — drop any top-level key not in `ALLOWED_FIELDS`
- [x] 2.5 Update `hasForbiddenField` in `services/secret-audit-handler/src/event-schema.mjs` to return `true` when any string value matches `SECRET_VALUE_PATTERN`

## 3. Verify

- [x] 3.1 Confirm `bbx-secret-sanitize-value` test now passes (green)
- [x] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

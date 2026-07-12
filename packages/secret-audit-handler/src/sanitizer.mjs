import { FORBIDDEN_FIELDS, hasForbiddenField, SecretAuditEvent, SECRET_VALUE_PATTERNS } from './event-schema.mjs';

const forbiddenMatcher = new RegExp(`^(${FORBIDDEN_FIELDS.join('|')})$`, 'i');

/**
 * Top-level allowlist: only keys declared in SecretAuditEvent.properties are kept.
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set(Object.keys(SecretAuditEvent.properties));

/**
 * Allowed sub-keys for requestorIdentity (the only declared nested object).
 */
const ALLOWED_REQUESTOR_IDENTITY_KEYS = new Set(
  Object.keys(SecretAuditEvent.properties.requestorIdentity.properties)
);

/**
 * Free-text fields whose string values are subject to value-pattern redaction.
 * Opaque id/enum/timestamp fields are excluded to prevent false positives.
 */
const VALUE_REDACT_TOP_LEVEL_FIELDS = new Set([
  'secretPath',
  'secretName',
  'denialReason',
  'tenantId'
]);

/**
 * requestorIdentity sub-fields subject to value-pattern redaction.
 * 'type' is an enum — treated as opaque.
 */
const VALUE_REDACT_REQUESTOR_IDENTITY_FIELDS = new Set([
  'name',
  'namespace',
  'serviceAccount'
]);

export function sanitize(rawVaultLogEntry) {
  // Step 1: Strip forbidden keys (deny-list) recursively — preserve existing behaviour.
  let cleaned = stripForbidden(rawVaultLogEntry);

  // Step 2: Allowlist projection — drop any top-level key not declared in the schema.
  cleaned = projectTopLevel(cleaned);

  // Step 3: Value-pattern redaction — replace secret material substrings with [REDACTED]
  //         only in free-text fields; opaque id/enum/timestamp fields are left untouched.
  cleaned = redactEventValues(cleaned);

  // Step 4: Guard — if anything still has forbidden material, fail closed.
  if (hasForbiddenField(cleaned)) {
    throw new Error('Forbidden field survived sanitization');
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Step 1: deny-list key strip (existing behaviour, unchanged)
// ---------------------------------------------------------------------------
function stripForbidden(value) {
  if (Array.isArray(value)) {
    return value.map(stripForbidden);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !forbiddenMatcher.test(key))
        .map(([key, nested]) => [key, stripForbidden(nested)])
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Step 2: allowlist projection
// ---------------------------------------------------------------------------
function projectTopLevel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const projected = {};
  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    if (key in obj) {
      if (key === 'requestorIdentity' && obj[key] && typeof obj[key] === 'object') {
        projected[key] = projectRequestorIdentity(obj[key]);
      } else {
        projected[key] = obj[key];
      }
    }
  }
  return projected;
}

function projectRequestorIdentity(identity) {
  if (!identity || typeof identity !== 'object') return identity;
  const projected = {};
  for (const key of ALLOWED_REQUESTOR_IDENTITY_KEYS) {
    if (key in identity) {
      projected[key] = identity[key];
    }
  }
  return projected;
}

// ---------------------------------------------------------------------------
// Step 3: value-pattern redaction (only on free-text fields)
// ---------------------------------------------------------------------------
function redactEventValues(event) {
  if (!event || typeof event !== 'object') return event;
  const result = { ...event };

  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    if (!(key in result)) continue;

    if (key === 'requestorIdentity' && result[key] && typeof result[key] === 'object') {
      const identity = { ...result[key] };
      for (const subKey of VALUE_REDACT_REQUESTOR_IDENTITY_FIELDS) {
        if (subKey in identity && typeof identity[subKey] === 'string') {
          identity[subKey] = redactString(identity[subKey]);
        }
      }
      result[key] = identity;
    } else if (VALUE_REDACT_TOP_LEVEL_FIELDS.has(key) && typeof result[key] === 'string') {
      result[key] = redactString(result[key]);
    }
    // else: opaque field (eventId, timestamp, operation, domain, result, vaultRequestId)
    //       — leave untouched to avoid false positives on UUIDs/enums/timestamps.
  }

  return result;
}

/**
 * Replace every secret-material substring within a string with [REDACTED].
 * Multiple patterns may apply; each is applied in sequence.
 * After redaction the sentinel [REDACTED] itself never re-triggers patterns.
 */
function redactString(str) {
  if (typeof str !== 'string') return str;
  let result = str;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    // Clone the pattern so we can use it safely (reset lastIndex)
    const re = new RegExp(pattern.source, pattern.flags);
    // For inline-assignment patterns we want to redact only the value part,
    // not the keyword itself. The capture group is group 1 (keyword).
    // For all other patterns, redact the entire match.
    if (pattern.source.includes('(value|secret|password')) {
      // Inline credential pattern: keep keyword, redact value after = or :
      result = result.replace(re, (match, keyword) => {
        const separatorIdx = match.indexOf(keyword) + keyword.length;
        const rest = match.slice(separatorIdx); // e.g. '=AKIAIOSFODNN7EXAMPLEKEY'
        const sep = rest.match(/^\s*[=:]\s*/)?.[0] ?? '';
        return keyword + sep + '[REDACTED]';
      });
    } else {
      result = result.replace(re, '[REDACTED]');
    }
  }
  return result;
}

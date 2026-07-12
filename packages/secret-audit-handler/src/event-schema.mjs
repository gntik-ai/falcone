export const FORBIDDEN_FIELDS = ['value', 'data', 'secret', 'password', 'token', 'key'];

export const SecretAuditEvent = {
  type: 'object',
  required: ['eventId', 'timestamp', 'operation', 'domain', 'secretPath', 'secretName', 'requestorIdentity', 'result', 'vaultRequestId'],
  properties: {
    eventId: { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    operation: { enum: ['read', 'write', 'delete', 'denied'] },
    domain: { enum: ['platform', 'tenant', 'functions', 'gateway', 'iam'] },
    secretPath: { type: 'string' },
    secretName: { type: 'string' },
    requestorIdentity: {
      type: 'object',
      required: ['type', 'name', 'namespace', 'serviceAccount'],
      properties: {
        type: { enum: ['service', 'user'] },
        name: { type: 'string' },
        namespace: { type: 'string' },
        serviceAccount: { type: 'string' }
      }
    },
    tenantId: { type: ['string', 'null'] },
    result: { enum: ['success', 'denied', 'error'] },
    denialReason: { type: ['string', 'null'] },
    vaultRequestId: { type: 'string' }
  },
  additionalProperties: false
};

/**
 * Conservative patterns that match known secret material substrings.
 * Applied only to free-text fields; opaque id/enum/timestamp fields are excluded.
 *
 * Order matters: PEM is checked first (broadest match for blocks), then
 * inline assignments, then raw blobs.
 */
export const SECRET_VALUE_PATTERNS = [
  // PEM blocks — any -----BEGIN ... -----  ...  -----END ... -----
  /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|PUBLIC KEY|EC PRIVATE KEY)[A-Z ]*-----[\s\S]*?-----END [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|PUBLIC KEY|EC PRIVATE KEY)[A-Z ]*-----/g,
  // Generic PEM begin marker (catches unrecognised types)
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  // Inline credential assignments: word=value or word:value (high-confidence keywords)
  /\b(value|secret|password|passwd|token|api[_\-]?key|key)\b\s*[=:]\s*\S+/gi,
  // Long contiguous base64 blobs (>= 40 chars, chars: A-Za-z0-9+/=)
  // Excluding paths: real paths have / which resets contiguity (base64 = and + not in paths)
  /[A-Za-z0-9+/]{40,}={0,2}/g,
  // Long contiguous hex blobs (>= 32 chars, word boundary to avoid UUID fragments)
  /\b[0-9a-fA-F]{32,}\b/g
];

/**
 * Returns true if a string value contains secret material that matches any
 * SECRET_VALUE_PATTERN.  Used by hasForbiddenField to catch unredacted secrets.
 * A correctly-redacted event (containing only [REDACTED]) must NOT match.
 */
export function containsSecretMaterial(str) {
  if (typeof str !== 'string') return false;
  // [REDACTED] sentinel is safe — do not flag it
  // Strip sentinels before testing so partially-redacted strings don't re-trigger
  const stripped = str.replace(/\[REDACTED\]/g, '');
  return SECRET_VALUE_PATTERNS.some((re) => {
    // Reset lastIndex for stateful global regexes
    re.lastIndex = 0;
    return re.test(stripped);
  });
}

export function hasForbiddenField(input) {
  if (!input || typeof input !== 'object') return false;
  return Object.entries(input).some(([key, value]) => {
    const normalized = key.toLowerCase();
    const forbidden = FORBIDDEN_FIELDS.some((field) => normalized === field || normalized.endsWith(`.${field}`));
    if (forbidden) return true;
    // Check string values for secret material patterns
    if (typeof value === 'string' && containsSecretMaterial(value)) return true;
    // Recurse into nested objects/arrays
    if (value && typeof value === 'object') return hasForbiddenField(value);
    return false;
  });
}

export function validateAuditEvent(event) {
  if (hasForbiddenField(event)) {
    throw new Error('Forbidden secret material detected in audit event');
  }
  for (const field of SecretAuditEvent.required) {
    if (!(field in event)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  return true;
}

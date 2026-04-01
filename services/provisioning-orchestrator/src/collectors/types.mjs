/**
 * Shared types and helpers for functional config export collectors.
 * @module collectors/types
 */

/**
 * @typedef {'ok' | 'empty' | 'error' | 'not_available' | 'not_requested'} DomainStatus
 */

/**
 * @typedef {Object} CollectorResult
 * @property {string} domain_key
 * @property {DomainStatus} status
 * @property {string} exported_at  - ISO 8601 UTC
 * @property {number} [items_count]
 * @property {Record<string, unknown> | null} [data]
 * @property {string} [error]   - only when status === 'error'
 * @property {string} [reason]  - only when status === 'not_available' | 'not_requested'
 */

/**
 * @typedef {Object} ExportArtifact
 * @property {string} export_timestamp
 * @property {string} tenant_id
 * @property {string} format_version
 * @property {string} deployment_profile
 * @property {string} correlation_id
 * @property {CollectorResult[]} domains
 */

/**
 * @typedef {Object} DomainAvailability
 * @property {string} domain_key
 * @property {'available' | 'not_available' | 'degraded'} availability
 * @property {string} description
 * @property {string} [reason]
 */

/**
 * @typedef {Object} ExportDomainsResponse
 * @property {string} tenant_id
 * @property {string} deployment_profile
 * @property {string} queried_at
 * @property {DomainAvailability[]} domains
 */

/** Valid domain status values. */
export const DOMAIN_STATUSES = /** @type {const} */ (['ok', 'empty', 'error', 'not_available', 'not_requested']);

// --- Redaction ---

const SENSITIVE_KEY_PATTERN = /^(secret|password|passwd|token|credential|private|auth)$/i;
const SENSITIVE_KEY_CONTAINS = /(?:secret|password|passwd|token|credential|private_key|auth_token|access_key|api_key)/i;

const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;
const AWS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/;
const PEM_PATTERN = /-----BEGIN (?:RSA |EC )?(?:PRIVATE|PUBLIC) KEY-----/;

const REDACTED = '***REDACTED***';

/**
 * Dual-layer redaction: explicit key list + value pattern heuristic.
 * Returns a deep clone with sensitive values replaced by `"***REDACTED***"`.
 *
 * @param {unknown} obj
 * @param {string[]} [extraKeys] - additional key names to treat as sensitive
 * @returns {unknown}
 */
export function redactSensitiveFields(obj, extraKeys = []) {
  const extraSet = new Set(extraKeys.map(k => k.toLowerCase()));
  return _redact(obj, extraSet, 0);
}

function _isKeyMatch(key, extraSet) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(lower) ||
    SENSITIVE_KEY_CONTAINS.test(lower) ||
    extraSet.has(lower);
}

function _isValueSensitive(val) {
  if (typeof val !== 'string') return false;
  return JWT_PATTERN.test(val) || AWS_KEY_PATTERN.test(val) || PEM_PATTERN.test(val);
}

function _redact(node, extraSet, depth) {
  if (depth > 50) return node; // guard against circular-like deep nesting
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(item => _redact(item, extraSet, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(node)) {
    if (_isKeyMatch(key, extraSet)) {
      out[key] = (val !== null && val !== undefined) ? REDACTED : val;
    } else if (typeof val === 'string' && _isValueSensitive(val)) {
      out[key] = REDACTED;
    } else if (typeof val === 'object' && val !== null) {
      out[key] = _redact(val, extraSet, depth + 1);
    } else {
      out[key] = val;
    }
  }
  return out;
}

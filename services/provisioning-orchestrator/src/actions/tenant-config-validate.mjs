/**
 * OpenWhisk action: Validate a tenant config export artifact against its declared schema.
 * POST /v1/admin/tenants/{tenant_id}/config/validate
 * @module actions/tenant-config-validate
 */

import { randomUUID } from 'node:crypto';
import {
  getCurrentVersion,
  getSchemaFor,
  getChecksum,
  isSameMajor,
  isFutureVersion,
} from '../schemas/index.mjs';
import { validate } from '../schemas/schema-validator.mjs';
import { publishValidationEvent } from '../events/config-schema-events.mjs';

const DEFAULT_MAX_INPUT_BYTES = 10_485_760; // 10 MB

/**
 * Extract and validate JWT claims from OpenWhisk params.
 */
function extractAuth(params) {
  const authHeader = params?.__ow_headers?.authorization ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    const roles = payload.realm_access?.roles ?? [];
    const scopes = (payload.scope ?? '').split(' ').filter(Boolean);
    let actor_type = null;
    if (roles.includes('superadmin')) actor_type = 'superadmin';
    else if (roles.includes('sre')) actor_type = 'sre';
    else if (payload.azp && !roles.includes('tenant_owner') && scopes.includes('platform:admin:config:export')) actor_type = 'service_account';

    return actor_type ? { actor_id: payload.sub ?? payload.preferred_username ?? 'unknown', actor_type, scopes } : null;
  } catch {
    return null;
  }
}

/**
 * @param {Object} params - OpenWhisk action params (body is the artifact)
 * @param {Object} [overrides] - DI overrides for testing
 * @returns {Promise<{statusCode: number, headers?: object, body: object}>}
 */
export async function main(params = {}, overrides = {}) {
  const log = overrides.log ?? console;
  const kafkaProducer = overrides.kafkaProducer ?? params.kafkaProducer ?? null;
  const publishFn = overrides.publishValidationEvent ?? publishValidationEvent;
  const maxInputBytes = Number(process.env.CONFIG_SCHEMA_MAX_INPUT_BYTES) || DEFAULT_MAX_INPUT_BYTES;

  const correlationId = `req-${randomUUID().slice(0, 12)}`;

  // --- Auth ---
  const auth = overrides.auth ?? extractAuth(params);
  if (!auth) {
    return { statusCode: 403, body: { error: 'Forbidden: insufficient role or missing scope platform:admin:config:export' } };
  }
  if (!auth.scopes?.includes('platform:admin:config:export') && !overrides.auth) {
    return { statusCode: 403, body: { error: 'Forbidden: missing scope platform:admin:config:export' } };
  }

  // --- Extract tenant_id (from route) ---
  const tenantId = params.tenant_id ?? params.__ow_path?.split('/').find((_, i, arr) => arr[i - 1] === 'tenants') ?? 'unknown';

  // --- Body ---
  const artifact = overrides.artifact ?? params.artifact ?? params;
  if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) {
    return { statusCode: 400, body: { error: 'Request body must be a JSON object' } };
  }

  // --- Size check ---
  const artifactJson = JSON.stringify(artifact);
  if (Buffer.byteLength(artifactJson, 'utf-8') > maxInputBytes) {
    return { statusCode: 413, body: { error: 'Artifact too large', max_bytes: maxInputBytes } };
  }

  // --- format_version check ---
  const formatVersion = artifact.format_version;
  if (!formatVersion || typeof formatVersion !== 'string') {
    return { statusCode: 400, body: { error: 'format_version is required' } };
  }

  const getFn = overrides.getCurrentVersion ?? getCurrentVersion;
  const currentVersion = getFn();

  // Future version
  if ((overrides.isFutureVersion ?? isFutureVersion)(formatVersion)) {
    return { statusCode: 422, body: { error: `format_version ${formatVersion} is not recognized by this platform version` } };
  }

  // Unknown version
  const schema = (overrides.getSchemaFor ?? getSchemaFor)(formatVersion);
  if (!schema) {
    return { statusCode: 422, body: { error: `format_version ${formatVersion} is not recognized by this platform version` } };
  }

  // --- Validate ---
  const validateFn = overrides.validate ?? validate;
  const { errors, warnings } = validateFn(artifact, schema);

  // schema_checksum_match
  const expectedChecksum = (overrides.getChecksum ?? getChecksum)(formatVersion);
  let schemaChecksumMatch = null;
  if (artifact.schema_checksum && expectedChecksum) {
    schemaChecksumMatch = artifact.schema_checksum === expectedChecksum;
  }

  // migration_required
  const sameMajorFn = overrides.isSameMajor ?? isSameMajor;
  const migrationRequired = !sameMajorFn(formatVersion, currentVersion);

  const result = errors.length > 0
    ? 'invalid'
    : warnings.length > 0
      ? 'valid_with_warnings'
      : 'valid';

  const responseBody = {
    result,
    format_version: formatVersion,
    errors,
    warnings,
    schema_checksum_match: schemaChecksumMatch,
    migration_required: migrationRequired,
  };

  // --- Kafka audit event (fire-and-forget) ---
  try {
    await publishFn(kafkaProducer, {
      correlation_id: correlationId,
      tenant_id: tenantId,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      format_version_validated: formatVersion,
      result,
      error_count: errors.length,
      warning_count: warnings.length,
      schema_checksum_match: schemaChecksumMatch,
      migration_required: migrationRequired,
    }, log);
  } catch (err) {
    log.error?.({ event: 'config_validate_kafka_error', correlation_id: correlationId, error: err.message });
  }

  const statusCode = result === 'invalid' ? 422 : 200;

  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: responseBody,
  };
}

/**
 * OpenWhisk action: Migrate a tenant config export artifact from an older format version to current.
 * POST /v1/admin/tenants/{tenant_id}/config/migrate
 * @module actions/tenant-config-migrate
 */

import { randomUUID } from 'node:crypto';
import {
  getCurrentVersion,
  getSchemaFor,
  isSameMajor,
  isFutureVersion,
  buildMigrationChain,
} from '../schemas/index.mjs';
import { validate } from '../schemas/schema-validator.mjs';
import { publishMigrationEvent } from '../events/config-schema-events.mjs';

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
  const publishFn = overrides.publishMigrationEvent ?? publishMigrationEvent;
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

  // Future version — no downgrade supported (RN-T02-08)
  if ((overrides.isFutureVersion ?? isFutureVersion)(formatVersion)) {
    return { statusCode: 422, body: { error: `format_version ${formatVersion} is not recognized by this platform version. Downgrade is not supported.` } };
  }

  // Unknown version
  const schema = (overrides.getSchemaFor ?? getSchemaFor)(formatVersion);
  if (!schema) {
    return { statusCode: 422, body: { error: `format_version ${formatVersion} is not recognized by this platform version` } };
  }

  // --- Same major → no migration needed ---
  const sameMajorFn = overrides.isSameMajor ?? isSameMajor;
  if (sameMajorFn(formatVersion, currentVersion)) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        migration_required: false,
        artifact,
      },
    };
  }

  // --- Build and execute migration chain ---
  const buildChainFn = overrides.buildMigrationChain ?? buildMigrationChain;
  let chainResult;
  try {
    chainResult = buildChainFn(formatVersion, currentVersion);
  } catch (err) {
    return {
      statusCode: 422,
      body: {
        error: `Cannot build migration chain: ${err.message}`,
        migrated_from: formatVersion,
        migrated_to: currentVersion,
      },
    };
  }

  const { chain, fns } = chainResult;

  if (fns.length === 0) {
    // Same major caught above; this is a safety fallback.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { migration_required: false, artifact },
    };
  }

  // Execute migrations sequentially
  let migrated = structuredClone(artifact);
  const allWarnings = [];

  for (let i = 0; i < fns.length; i++) {
    try {
      const result = fns[i](migrated);
      migrated = result.artifact ?? result;
      if (result.warnings) {
        allWarnings.push(...result.warnings);
      }
    } catch (err) {
      return {
        statusCode: 422,
        body: {
          error: `Migration failed at step ${chain[i]}: ${err.message}`,
          failed_at_step: i,
          steps_completed: chain.slice(0, i),
          steps_remaining: chain.slice(i),
        },
      };
    }
  }

  // Update format_version on migrated artifact
  migrated.format_version = currentVersion;

  // Add migration metadata
  migrated._migration_metadata = {
    migrated_from: formatVersion,
    migrated_to: currentVersion,
    migration_chain: chain,
    migrated_at: new Date().toISOString(),
  };

  if (allWarnings.length > 0) {
    migrated._migration_warnings = allWarnings;
  }

  // --- Validate migrated artifact against current schema ---
  const currentSchema = (overrides.getSchemaFor ?? getSchemaFor)(currentVersion);
  if (currentSchema) {
    const validateFn = overrides.validate ?? validate;
    const { errors } = validateFn(migrated, currentSchema);
    if (errors.length > 0) {
      log.error?.({
        event: 'config_migrate_post_validation_failed',
        correlation_id: correlationId,
        errors,
      });
      return {
        statusCode: 500,
        body: {
          error: 'Migrated artifact failed validation against current schema (bug in migration)',
          validation_errors: errors,
        },
      };
    }
  }

  // --- Kafka audit event (fire-and-forget) ---
  try {
    await publishFn(kafkaProducer, {
      correlation_id: correlationId,
      tenant_id: tenantId,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      migrated_from: formatVersion,
      migrated_to: currentVersion,
      migration_chain: chain,
      has_migration_warnings: allWarnings.length > 0,
    }, log);
  } catch (err) {
    log.error?.({ event: 'config_migrate_kafka_error', correlation_id: correlationId, error: err.message });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      migration_required: true,
      artifact: migrated,
      _migration_metadata: migrated._migration_metadata,
      _migration_warnings: migrated._migration_warnings ?? [],
    },
  };
}

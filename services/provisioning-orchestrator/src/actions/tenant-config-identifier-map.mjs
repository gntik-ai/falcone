/**
 * OpenWhisk action: Generate proposed identifier map for reprovision.
 * POST /v1/admin/tenants/{tenant_id}/config/reprovision/identifier-map
 * @module actions/tenant-config-identifier-map
 */

import { randomUUID } from 'node:crypto';
import { buildProposedIdentifierMap } from '../reprovision/identifier-map.mjs';
import { insertReprovisionAuditLog } from '../repositories/config-reprovision-audit-repository.mjs';
import { publishIdentifierMapGenerated } from '../events/config-reprovision-events.mjs';

/**
 * Extract and validate JWT claims.
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
    else if (payload.azp && !roles.includes('tenant_owner') && scopes.includes('platform:admin:config:reprovision')) actor_type = 'service_account';
    return actor_type ? { actor_id: payload.sub ?? payload.preferred_username ?? 'unknown', actor_type, scopes } : null;
  } catch {
    return null;
  }
}

/**
 * @param {Object} params - OpenWhisk action params
 * @param {Object} [overrides] - DI overrides for testing
 * @returns {Promise<{statusCode: number, headers?: object, body: object}>}
 */
export async function main(params = {}, overrides = {}) {
  const log = overrides.log ?? console;
  const db = overrides.db ?? params.db;
  const kafkaProducer = overrides.kafkaProducer ?? params.kafkaProducer ?? null;
  const auditFn = overrides.insertReprovisionAuditLog ?? insertReprovisionAuditLog;
  const publishFn = overrides.publishIdentifierMapGenerated ?? publishIdentifierMapGenerated;
  const tenantExistsFn = overrides.tenantExists ?? (async () => true);

  const startedAt = new Date().toISOString();
  const correlationId = `req-${randomUUID().slice(0, 12)}`;

  // --- Auth ---
  const auth = overrides.auth ?? extractAuth(params);
  if (!auth) {
    return { statusCode: 403, body: { error: 'Forbidden: insufficient role or missing scope platform:admin:config:reprovision' } };
  }
  if (!auth.scopes?.includes('platform:admin:config:reprovision') && !overrides.auth) {
    return { statusCode: 403, body: { error: 'Forbidden: missing scope platform:admin:config:reprovision' } };
  }

  // --- Tenant ---
  const tenantId = params.tenant_id ?? params.__ow_path?.split('/').find((_, i, arr) => arr[i - 1] === 'tenants');
  if (!tenantId) {
    return { statusCode: 400, body: { error: 'tenant_id is required' } };
  }

  const exists = await tenantExistsFn(tenantId);
  if (!exists) {
    return { statusCode: 404, body: { error: `Tenant '${tenantId}' not found` } };
  }

  // --- Parse body ---
  const artifact = params.artifact;
  if (!artifact) {
    return { statusCode: 400, body: { error: 'artifact is required in the request body' } };
  }

  if (!artifact.tenant_id) {
    return { statusCode: 400, body: { error: 'artifact must contain a tenant_id field' } };
  }

  // --- Build proposal ---
  const proposal = buildProposedIdentifierMap(artifact, tenantId);

  const endedAt = new Date().toISOString();

  // --- Audit ---
  try {
    if (db) {
      await auditFn(db, {
        tenant_id: tenantId,
        source_tenant_id: artifact.tenant_id,
        actor_id: auth.actor_id,
        actor_type: auth.actor_type,
        dry_run: true,
        requested_domains: [],
        effective_domains: [],
        format_version: artifact.format_version ?? 'unknown',
        result_status: 'dry_run',
        correlation_id: correlationId,
        started_at: startedAt,
        ended_at: endedAt,
      });
    }
  } catch (auditErr) {
    log.error?.({ event: 'config_identifier_map_audit_error', correlation_id: correlationId, error: auditErr.message });
  }

  // --- Kafka event ---
  try {
    await publishFn(kafkaProducer, {
      correlation_id: correlationId,
      tenant_id: tenantId,
      source_tenant_id: artifact.tenant_id,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      entries_count: proposal.entries.length,
      warnings: proposal.warnings,
    }, log);
  } catch (kafkaErr) {
    log.error?.({ event: 'config_identifier_map_kafka_error', correlation_id: correlationId, error: kafkaErr.message });
  }

  // --- Response ---
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      source_tenant_id: proposal.source_tenant_id,
      target_tenant_id: proposal.target_tenant_id,
      proposal,
      warnings: proposal.warnings,
      correlation_id: correlationId,
    },
  };
}

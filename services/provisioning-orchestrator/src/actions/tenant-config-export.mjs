/**
 * OpenWhisk action: Tenant functional configuration export orchestrator.
 * POST /v1/admin/tenants/{tenant_id}/config/export
 * @module actions/tenant-config-export
 */

import { randomUUID } from 'node:crypto';
import { getRegistry, KNOWN_DOMAINS } from '../collectors/registry.mjs';
import { insertExportAuditLog } from '../repositories/config-export-audit-repository.mjs';
import { publishExportCompleted } from '../events/config-export-events.mjs';

const FORMAT_VERSION = '1.0';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ARTIFACT_BYTES = 10_485_760; // 10 MB

/**
 * Extract and validate JWT claims from OpenWhisk params.
 * @returns {{ actor_id: string, actor_type: string, scopes: string[] } | null}
 */
function extractAuth(params) {
  // In OpenWhisk, JWT claims are typically decoded by the gateway and forwarded.
  // For this action, we trust the gateway-validated claims in params.
  const authHeader = params?.__ow_headers?.authorization ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  try {
    // Decode JWT payload (base64url); we do NOT verify signature here — APISIX does that.
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
 * Race a promise against a timeout.
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Collector '${label}' timed out after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
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
  const registryFn = overrides.getRegistry ?? getRegistry;
  const auditFn = overrides.insertExportAuditLog ?? insertExportAuditLog;
  const publishFn = overrides.publishExportCompleted ?? publishExportCompleted;
  const tenantExistsFn = overrides.tenantExists ?? (async () => true);

  const exportStartedAt = new Date().toISOString();
  const correlationId = `req-${randomUUID().slice(0, 12)}`;

  // --- Auth ---
  const auth = overrides.auth ?? extractAuth(params);
  if (!auth) {
    return { statusCode: 403, body: { error: 'Forbidden: insufficient role or missing scope platform:admin:config:export' } };
  }
  if (!auth.scopes?.includes('platform:admin:config:export') && !overrides.auth) {
    return { statusCode: 403, body: { error: 'Forbidden: missing scope platform:admin:config:export' } };
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

  // --- Domains filter ---
  const requestedDomains = params.domains ?? null;
  if (requestedDomains) {
    if (!Array.isArray(requestedDomains)) {
      return { statusCode: 400, body: { error: 'domains must be an array' } };
    }
    const unknown = requestedDomains.filter(d => !KNOWN_DOMAINS.includes(d));
    if (unknown.length > 0) {
      return { statusCode: 400, body: { error: `Unknown domains: ${unknown.join(', ')}. Known: ${KNOWN_DOMAINS.join(', ')}` } };
    }
  }

  // --- Build collector invocations ---
  const deploymentProfile = process.env.CONFIG_EXPORT_DEPLOYMENT_PROFILE ?? 'standard';
  const timeoutMs = Number(process.env.CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const maxArtifactBytes = Number(process.env.CONFIG_EXPORT_MAX_ARTIFACT_BYTES) || DEFAULT_MAX_ARTIFACT_BYTES;

  const registry = registryFn(deploymentProfile);
  const domainsToExport = requestedDomains ?? [...registry.keys()];

  const collectorPromises = domainsToExport.map(domainKey => {
    const collectorFn = registry.get(domainKey);
    if (!collectorFn) {
      return Promise.resolve(/** @type {import('../collectors/types.mjs').CollectorResult} */ ({
        domain_key: domainKey,
        status: 'not_available',
        exported_at: new Date().toISOString(),
        reason: `No collector registered for domain '${domainKey}'`,
        data: null,
      }));
    }
    return withTimeout(collectorFn(tenantId, { deploymentProfile }), timeoutMs, domainKey);
  });

  const settled = await Promise.allSettled(collectorPromises);

  /** @type {import('../collectors/types.mjs').CollectorResult[]} */
  const domainResults = settled.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    return {
      domain_key: domainsToExport[idx],
      status: 'error',
      exported_at: new Date().toISOString(),
      error: outcome.reason?.message ?? String(outcome.reason),
      data: null,
    };
  });

  // --- Build artifact ---
  const artifact = {
    export_timestamp: exportStartedAt,
    tenant_id: tenantId,
    format_version: FORMAT_VERSION,
    deployment_profile: deploymentProfile,
    correlation_id: correlationId,
    domains: domainResults,
  };

  // --- Size check ---
  const artifactJson = JSON.stringify(artifact);
  const artifactBytes = Buffer.byteLength(artifactJson, 'utf-8');
  if (artifactBytes > maxArtifactBytes) {
    return {
      statusCode: 422,
      body: {
        error: 'Export artifact too large',
        artifact_bytes: artifactBytes,
        max_bytes: maxArtifactBytes,
        hint: 'Use the domains filter to export a subset of domains.',
      },
    };
  }

  // --- Determine HTTP status ---
  const hasError = domainResults.some(d => d.status === 'error');
  const allFailed = domainResults.every(d => d.status === 'error' || d.status === 'not_available');
  const exportEndedAt = new Date().toISOString();

  const domainsExported = domainResults.filter(d => d.status === 'ok' || d.status === 'empty').map(d => d.domain_key);
  const domainsFailed = domainResults.filter(d => d.status === 'error').map(d => d.domain_key);
  const domainsNotAvailable = domainResults.filter(d => d.status === 'not_available').map(d => d.domain_key);

  const resultStatus = allFailed ? 'failed' : hasError ? 'partial' : 'ok';

  // --- Audit log (PostgreSQL) ---
  try {
    if (db) {
      await auditFn(db, {
        tenant_id: tenantId,
        actor_id: auth.actor_id,
        actor_type: auth.actor_type,
        domains_requested: domainsToExport,
        domains_exported: domainsExported,
        domains_failed: domainsFailed,
        domains_not_available: domainsNotAvailable,
        result_status: resultStatus,
        artifact_bytes: artifactBytes,
        format_version: FORMAT_VERSION,
        correlation_id: correlationId,
        export_started_at: exportStartedAt,
        export_ended_at: exportEndedAt,
      });
    }
  } catch (auditErr) {
    log.error?.({ event: 'config_export_audit_error', correlation_id: correlationId, error: auditErr.message });
  }

  // --- Kafka event (fire-and-forget) ---
  try {
    await publishFn(kafkaProducer, {
      correlation_id: correlationId,
      tenant_id: tenantId,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      domains_requested: domainsToExport,
      domains_exported: domainsExported,
      domains_failed: domainsFailed,
      domains_not_available: domainsNotAvailable,
      result_status: resultStatus,
      artifact_bytes: artifactBytes,
      format_version: FORMAT_VERSION,
      export_started_at: exportStartedAt,
      export_ended_at: exportEndedAt,
    }, log);
  } catch (kafkaErr) {
    log.error?.({ event: 'config_export_kafka_publish_error', correlation_id: correlationId, error: kafkaErr.message });
  }

  const statusCode = hasError ? 207 : 200;
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: artifact,
  };
}

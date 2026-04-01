/**
 * OpenWhisk action: Tenant functional configuration reprovision orchestrator.
 * POST /v1/admin/tenants/{tenant_id}/config/reprovision
 * @module actions/tenant-config-reprovision
 */

import { randomUUID } from 'node:crypto';
import { KNOWN_DOMAINS, SKIPPABLE_STATUSES, buildSummary } from '../reprovision/types.mjs';
import { buildProposedIdentifierMap, validateIdentifierMap, applyIdentifierMap } from '../reprovision/identifier-map.mjs';
import { getApplierRegistry, APPLIER_ORDER } from '../reprovision/registry.mjs';
import { acquireLock, releaseLock, failLock } from '../repositories/config-reprovision-lock-repository.mjs';
import { insertReprovisionAuditLog } from '../repositories/config-reprovision-audit-repository.mjs';
import { publishReprovisionCompleted } from '../events/config-reprovision-events.mjs';
import { isSameMajor } from '../schemas/index.mjs';

const SUPPORTED_FORMAT_MAJOR = process.env.CONFIG_IMPORT_SUPPORTED_FORMAT_MAJOR ?? '1';
const DEFAULT_APPLIER_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_TTL_MS = 120_000;

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
 * Race a promise against a timeout.
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Applier '${label}' timed out after ${ms}ms`)), ms);
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
  const registryFn = overrides.getApplierRegistry ?? getApplierRegistry;
  const auditFn = overrides.insertReprovisionAuditLog ?? insertReprovisionAuditLog;
  const publishFn = overrides.publishReprovisionCompleted ?? publishReprovisionCompleted;
  const tenantExistsFn = overrides.tenantExists ?? (async () => true);
  const acquireLockFn = overrides.acquireLock ?? acquireLock;
  const releaseLockFn = overrides.releaseLock ?? releaseLock;
  const failLockFn = overrides.failLock ?? failLock;
  const isSameMajorFn = overrides.isSameMajor ?? isSameMajor;

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

  const dryRun = params.dry_run ?? false;
  const requestedDomains = params.domains ?? null;
  let identifierMap = params.identifier_map ?? null;

  // --- Validate format_version ---
  const artifactVersion = artifact.format_version;
  if (!artifactVersion) {
    return { statusCode: 422, body: { error: 'artifact.format_version is required' } };
  }

  const artifactMajor = String(artifactVersion).split('.')[0];
  if (artifactMajor !== SUPPORTED_FORMAT_MAJOR && !(isSameMajorFn(artifactVersion, `${SUPPORTED_FORMAT_MAJOR}.0.0`))) {
    return { statusCode: 422, body: { error: `Incompatible format_version '${artifactVersion}'. Server supports major version ${SUPPORTED_FORMAT_MAJOR}. Migrate the artifact first.` } };
  }

  // --- Validate domains filter ---
  if (requestedDomains) {
    if (!Array.isArray(requestedDomains)) {
      return { statusCode: 400, body: { error: 'domains must be an array' } };
    }
    const unknown = requestedDomains.filter(d => !KNOWN_DOMAINS.includes(d));
    if (unknown.length > 0) {
      return { statusCode: 400, body: { error: `Unknown domains: ${unknown.join(', ')}. Known: ${KNOWN_DOMAINS.join(', ')}` } };
    }
  }

  // --- Identifier map handling ---
  const sourceTenantId = artifact.tenant_id ?? 'unknown';

  if (sourceTenantId !== tenantId) {
    // Different tenants — identifier map is required
    if (!identifierMap) {
      // Generate proposal and return it without executing
      const proposal = buildProposedIdentifierMap(artifact, tenantId);
      return {
        statusCode: 200,
        body: {
          needs_confirmation: true,
          proposal,
          correlation_id: correlationId,
          message: 'Source and destination tenants differ. Review and confirm the identifier map, then re-submit with identifier_map in the request.',
        },
      };
    }

    // Validate the provided map
    try {
      validateIdentifierMap(identifierMap);
    } catch (err) {
      return { statusCode: 400, body: { error: err.message, details: err.details ?? [] } };
    }
  }

  // --- Apply identifier map ---
  let transformedArtifact = artifact;
  if (identifierMap && identifierMap.entries && identifierMap.entries.length > 0) {
    transformedArtifact = applyIdentifierMap(artifact, identifierMap);
  }

  // --- Determine domains to process ---
  const domainMap = new Map();
  if (Array.isArray(transformedArtifact.domains)) {
    for (const d of transformedArtifact.domains) {
      domainMap.set(d.domain_key, d);
    }
  }

  const domainsToProcess = (requestedDomains ?? KNOWN_DOMAINS).filter(dk => {
    const domainEntry = domainMap.get(dk);
    if (!domainEntry) return false;
    if (SKIPPABLE_STATUSES.includes(domainEntry.status)) return false;
    return true;
  });

  // --- Acquire lock ---
  const timeoutMs = Number(process.env.CONFIG_IMPORT_APPLIER_TIMEOUT_MS) || DEFAULT_APPLIER_TIMEOUT_MS;
  const lockTtlMs = Number(process.env.CONFIG_IMPORT_LOCK_TTL_MS) || DEFAULT_LOCK_TTL_MS;

  let lockToken = null;
  try {
    if (db) {
      const lockResult = await acquireLockFn(db, {
        tenant_id: tenantId,
        actor_id: auth.actor_id,
        actor_type: auth.actor_type,
        source_tenant_id: sourceTenantId,
        dry_run: dryRun,
        correlation_id: correlationId,
        ttlMs: lockTtlMs,
      });
      lockToken = lockResult.lock_token;
    }
  } catch (err) {
    if (err.code === 'LOCK_HELD') {
      return { statusCode: 409, body: { error: err.message, code: 'LOCK_HELD' } };
    }
    throw err;
  }

  // --- Execute appliers ---
  const deploymentProfile = process.env.CONFIG_IMPORT_DEPLOYMENT_PROFILE ?? 'standard';
  const registry = registryFn(deploymentProfile);

  /** @type {import('../reprovision/types.mjs').DomainResult[]} */
  const domainResults = [];

  try {
    for (const domainKey of APPLIER_ORDER) {
      const domainEntry = domainMap.get(domainKey);

      // Skip domains not in the process list
      if (!domainsToProcess.includes(domainKey)) {
        if (domainEntry && SKIPPABLE_STATUSES.includes(domainEntry.status)) {
          domainResults.push({
            domain_key: domainKey,
            status: 'skipped_not_exportable',
            resource_results: [],
            counts: { created: 0, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
            message: `Domain status in artifact: ${domainEntry.status}`,
          });
        }
        continue;
      }

      const applierFn = registry.get(domainKey);
      if (!applierFn) {
        domainResults.push({
          domain_key: domainKey,
          status: 'skipped_no_applier',
          resource_results: [],
          counts: { created: 0, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
          message: `No applier registered for domain '${domainKey}'`,
        });
        continue;
      }

      try {
        const domainData = domainEntry?.data ?? null;
        const result = await withTimeout(
          applierFn(tenantId, domainData, { dryRun, credentials: overrides.credentials ?? {}, log }),
          timeoutMs,
          domainKey,
        );
        domainResults.push(result);
      } catch (err) {
        domainResults.push({
          domain_key: domainKey,
          status: 'error',
          resource_results: [],
          counts: { created: 0, skipped: 0, conflicts: 0, errors: 1, warnings: 0 },
          message: err.message,
        });
      }
    }
  } catch (fatalErr) {
    // Fatal error during applier execution
    if (db && lockToken) {
      try { await failLockFn(db, { tenant_id: tenantId, lock_token: lockToken, error_detail: fatalErr.message }); } catch { /* best effort */ }
    }
    throw fatalErr;
  }

  // --- Compute summary and status ---
  const summary = buildSummary(domainResults, domainsToProcess.length);
  const hasError = domainResults.some(d => d.status === 'error');
  const hasConflict = domainResults.some(d => d.status === 'conflict' || d.status === 'would_conflict');
  const allFailed = domainResults.filter(d => domainsToProcess.includes(d.domain_key)).every(d => d.status === 'error');

  let resultStatus;
  if (dryRun) resultStatus = 'dry_run';
  else if (allFailed && domainsToProcess.length > 0) resultStatus = 'failed';
  else if (hasError || hasConflict) resultStatus = 'partial';
  else resultStatus = 'success';

  const endedAt = new Date().toISOString();

  // --- Audit ---
  try {
    if (db) {
      await auditFn(db, {
        tenant_id: tenantId,
        source_tenant_id: sourceTenantId,
        actor_id: auth.actor_id,
        actor_type: auth.actor_type,
        dry_run: dryRun,
        requested_domains: domainsToProcess,
        effective_domains: domainResults.filter(d => d.status !== 'skipped_not_exportable' && d.status !== 'skipped_no_applier').map(d => d.domain_key),
        format_version: artifactVersion,
        result_status: resultStatus,
        domain_summary: domainResults.map(d => ({ domain_key: d.domain_key, status: d.status, counts: d.counts })),
        resource_summary: summary,
        correlation_id: correlationId,
        started_at: startedAt,
        ended_at: endedAt,
      });
    }
  } catch (auditErr) {
    log.error?.({ event: 'config_reprovision_audit_error', correlation_id: correlationId, error: auditErr.message });
  }

  // --- Kafka event ---
  try {
    await publishFn(kafkaProducer, {
      correlation_id: correlationId,
      tenant_id: tenantId,
      source_tenant_id: sourceTenantId,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      dry_run: dryRun,
      domains_requested: domainsToProcess,
      domains_applied: domainResults.filter(d => d.status === 'applied' || d.status === 'applied_with_warnings').map(d => d.domain_key),
      domains_failed: domainResults.filter(d => d.status === 'error').map(d => d.domain_key),
      domains_skipped: domainResults.filter(d => d.status === 'skipped' || d.status === 'skipped_not_exportable' || d.status === 'skipped_no_applier').map(d => d.domain_key),
      result_status: resultStatus,
      summary,
      format_version: artifactVersion,
      started_at: startedAt,
      ended_at: endedAt,
    }, log);
  } catch (kafkaErr) {
    log.error?.({ event: 'config_reprovision_kafka_error', correlation_id: correlationId, error: kafkaErr.message });
  }

  // --- Release lock ---
  if (db && lockToken) {
    try { await releaseLockFn(db, { tenant_id: tenantId, lock_token: lockToken }); } catch { /* best effort */ }
  }

  // --- Response ---
  const statusCode = hasError ? 207 : 200;
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: {
      tenant_id: tenantId,
      source_tenant_id: sourceTenantId,
      correlation_id: correlationId,
      dry_run: dryRun,
      result_status: resultStatus,
      format_version: artifactVersion,
      summary,
      domain_results: domainResults,
      started_at: startedAt,
      ended_at: endedAt,
    },
  };
}

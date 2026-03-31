import { recordDenial } from '../repositories/function-privilege-repository.mjs';

function normalize(message) {
  const payload = typeof message.value === 'string' ? JSON.parse(message.value) : (message.value ?? message);
  return {
    tenantId: payload.tenantId ?? payload.tenant_id,
    workspaceId: payload.workspaceId ?? payload.workspace_id ?? null,
    actorId: payload.actorId ?? payload.actor_id,
    actorType: payload.actorType ?? payload.actor_type ?? 'anonymous',
    attemptedOperation: payload.attemptedOperation ?? payload.attempted_operation,
    requiredSubdomain: payload.requiredSubdomain ?? payload.required_subdomain,
    presentedSubdomains: payload.presentedSubdomains ?? payload.presented_subdomains ?? [],
    topLevelDomain: payload.topLevelDomain ?? payload.top_level_domain ?? null,
    requestPath: payload.requestPath ?? payload.request_path,
    httpMethod: payload.httpMethod ?? payload.http_method,
    targetFunctionId: payload.targetFunctionId ?? payload.target_function_id ?? null,
    correlationId: payload.correlationId ?? payload.correlation_id,
    deniedReason: payload.deniedReason ?? payload.denied_reason ?? 'FUNCTION_PRIVILEGE_MISMATCH',
    sourceIp: payload.sourceIp ?? payload.source_ip ?? null,
    deniedAt: payload.deniedAt ?? payload.denied_at ?? new Date().toISOString()
  };
}

function valid(record) {
  return Boolean(record.tenantId && record.actorId && record.requiredSubdomain && record.attemptedOperation && record.requestPath && record.httpMethod && record.correlationId);
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const insert = overrides.recordDenial ?? recordDenial;
  const log = overrides.log ?? console;
  const messages = params.messages ?? params.records ?? [];
  let inserted = 0;
  let skipped = 0;
  for (const message of messages) {
    try {
      const record = normalize(message);
      if (!valid(record)) {
        skipped += 1;
        log.warn?.({ event: 'function_privilege_denial_skipped', reason: 'invalid_record' });
        continue;
      }
      const created = await insert(db, record);
      if (created) inserted += 1; else skipped += 1;
    } catch (error) {
      skipped += 1;
      log.warn?.({ event: 'function_privilege_denial_skipped', error: error.message });
    }
  }
  return { statusCode: 200, body: { inserted, skipped, commitOffsets: inserted } };
}

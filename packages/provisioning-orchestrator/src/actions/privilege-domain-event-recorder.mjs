import { insertDenial } from '../repositories/privilege-domain-repository.mjs';

function normalize(message) {
  const payload = typeof message.value === 'string' ? JSON.parse(message.value) : (message.value ?? message);
  return {
    tenantId: payload.tenantId ?? payload.tenant_id,
    workspaceId: payload.workspaceId ?? payload.workspace_id ?? null,
    actorId: payload.actorId ?? payload.actor_id,
    actorType: payload.actorType ?? payload.actor_type,
    credentialDomain: payload.credentialDomain ?? payload.credential_domain ?? null,
    requiredDomain: payload.requiredDomain ?? payload.required_domain,
    httpMethod: payload.httpMethod ?? payload.http_method,
    requestPath: payload.requestPath ?? payload.request_path,
    sourceIp: payload.sourceIp ?? payload.source_ip ?? null,
    correlationId: payload.correlationId ?? payload.correlation_id,
    deniedAt: payload.deniedAt ?? payload.denied_at ?? new Date().toISOString()
  };
}

function valid(record) {
  return Boolean(record.tenantId && record.actorId && record.requiredDomain && record.httpMethod && record.requestPath && record.correlationId);
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const log = overrides.log ?? console;
  const insert = overrides.insertDenial ?? insertDenial;
  const messages = params.messages ?? params.records ?? [];
  let inserted = 0;
  let skipped = 0;
  for (const message of messages) {
    try {
      const record = normalize(message);
      if (!valid(record)) {
        skipped += 1;
        log.warn?.({ event: 'privilege_domain_denial_skipped', reason: 'invalid_record' });
        continue;
      }
      const result = await insert(db, record);
      if (result) inserted += 1; else skipped += 1;
    } catch (error) {
      skipped += 1;
      log.warn?.({ event: 'privilege_domain_denial_skipped', error: error.message });
    }
  }
  return { statusCode: 200, body: { inserted, skipped, commitOffsets: inserted } };
}

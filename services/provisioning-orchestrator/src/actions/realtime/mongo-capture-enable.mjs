import { MongoCaptureConfigRepository } from '../../repositories/realtime/MongoCaptureConfigRepository.mjs';
import { MongoCaptureQuotaRepository } from '../../repositories/realtime/MongoCaptureQuotaRepository.mjs';
import { MongoCaptureAuditRepository } from '../../repositories/realtime/MongoCaptureAuditRepository.mjs';
import { MongoCaptureLifecyclePublisher } from '../../events/realtime/MongoCaptureLifecyclePublisher.mjs';
import { parseIdentity } from './parse-identity.mjs';

const unauthorized = () => ({ statusCode: 401, body: { code: 'UNAUTHORIZED' } });
const bodyOf = (params) => params.body ?? params;

const probeCollection = async (deps, { data_source_ref, database_name, collection_name }) => {
  if (typeof deps.collectionProbe === 'function') return deps.collectionProbe({ data_source_ref, database_name, collection_name });
  return { ok: true, replicaSet: true };
};

export async function main(params, deps = {}) {
  const identity = parseIdentity(params);
  if (!identity) return unauthorized();
  const body = bodyOf(params);
  if (!body.data_source_ref || !body.database_name || !body.collection_name) return { statusCode: 400, body: { code: 'INVALID_REQUEST' } };
  const workspaceId = identity.workspaceId;
  const tenantId = identity.tenantId;
  const actorIdentity = identity.actorId;
  const quotaRepo = deps.quotaRepo ?? new MongoCaptureQuotaRepository(deps.db);
  const configRepo = deps.configRepo ?? new MongoCaptureConfigRepository(deps.db);
  const auditRepo = deps.auditRepo ?? new MongoCaptureAuditRepository(deps.db);
  const publisher = deps.publisher ?? new MongoCaptureLifecyclePublisher(deps.producer);
  const workspaceQuota = (await quotaRepo.getQuota('workspace', workspaceId))?.max_collections ?? Number(process.env.MONGO_CAPTURE_DEFAULT_WORKSPACE_QUOTA ?? 10);
  const workspaceCount = await quotaRepo.countActive('workspace', workspaceId);
  if (workspaceCount >= workspaceQuota) return { statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: 'workspace' } };
  const tenantQuota = (await quotaRepo.getQuota('tenant', tenantId))?.max_collections ?? Number(process.env.MONGO_CAPTURE_DEFAULT_TENANT_QUOTA ?? 50);
  const tenantCount = await quotaRepo.countActive('tenant', tenantId);
  if (tenantCount >= tenantQuota) return { statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: 'tenant' } };
  const probe = await probeCollection(deps, body);
  if (!probe?.ok && probe?.code === 'COLLECTION_NOT_FOUND') return { statusCode: 404, body: { code: 'COLLECTION_NOT_FOUND' } };
  if (!probe?.replicaSet) return { statusCode: 400, body: { code: 'REPLICA_SET_REQUIRED' } };
  if (!probe?.ok) return { statusCode: 400, body: { code: 'DATA_SOURCE_NOT_ACCESSIBLE' } };
  try {
    const created = await configRepo.create({ tenant_id: tenantId, workspace_id: workspaceId, data_source_ref: body.data_source_ref, database_name: body.database_name, collection_name: body.collection_name, capture_mode: body.capture_mode ?? 'delta', actor_identity: actorIdentity });
    Promise.resolve(auditRepo.append({ capture_id: created.id, tenant_id: tenantId, workspace_id: workspaceId, actor_identity: actorIdentity, action: 'capture-enabled', before_state: null, after_state: created.toJSON(), request_id: params.requestId ?? null })).catch(() => {});
    Promise.resolve(publisher.publish('capture-enabled', { action: 'capture-enabled', capture_id: created.id, collection_name: created.collection_name, actor_identity: actorIdentity, tenantId, workspaceId, before_state: null, after_state: created.toJSON() })).catch(() => {});
    return { statusCode: 201, body: created.toJSON() };
  } catch (error) {
    if (error?.code === 'CAPTURE_ALREADY_ACTIVE') return { statusCode: 409, body: { code: 'CAPTURE_ALREADY_ACTIVE' } };
    if (error?.code === 'QUOTA_EXCEEDED') return { statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: error.scope } };
    throw error;
  }
}

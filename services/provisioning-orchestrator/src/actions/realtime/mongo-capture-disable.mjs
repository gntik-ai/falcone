import { MongoCaptureConfigRepository } from '../../repositories/realtime/MongoCaptureConfigRepository.mjs';
import { MongoCaptureAuditRepository } from '../../repositories/realtime/MongoCaptureAuditRepository.mjs';
import { MongoResumeTokenRepository } from '../../repositories/realtime/MongoResumeTokenRepository.mjs';
import { MongoCaptureLifecyclePublisher } from '../../events/realtime/MongoCaptureLifecyclePublisher.mjs';
import { parseIdentity } from './parse-identity.mjs';
export async function main(params, deps = {}) {
  const identity = parseIdentity(params);
  if (!identity) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new MongoCaptureConfigRepository(deps.db);
  const tokenRepo = deps.resumeTokenRepo ?? new MongoResumeTokenRepository(deps.db);
  const auditRepo = deps.auditRepo ?? new MongoCaptureAuditRepository(deps.db);
  const publisher = deps.publisher ?? new MongoCaptureLifecyclePublisher(deps.producer);
  const captureId = params.captureId ?? params.path?.captureId;
  const current = await repo.findById(identity.tenantId, identity.workspaceId, captureId);
  if (!current) return { statusCode: 404, body: { code: 'CAPTURE_NOT_FOUND' } };
  if (current.status === 'disabled') return { statusCode: 409, body: { code: 'CAPTURE_ALREADY_DISABLED' } };
  const actorIdentity = identity.actorId;
  const updated = await repo.disable(captureId, actorIdentity);
  await tokenRepo.delete(captureId);
  Promise.resolve(auditRepo.append({ capture_id: captureId, tenant_id: identity.tenantId, workspace_id: identity.workspaceId, actor_identity: actorIdentity, action: 'capture-disabled', before_state: current.toJSON(), after_state: updated.toJSON(), request_id: params.requestId ?? null })).catch(() => {});
  Promise.resolve(publisher.publish('capture-disabled', { action: 'capture-disabled', capture_id: captureId, collection_name: current.collection_name, actor_identity: actorIdentity, tenantId: identity.tenantId, workspaceId: identity.workspaceId, before_state: current.toJSON(), after_state: updated.toJSON() })).catch(() => {});
  return { statusCode: 204 };
}

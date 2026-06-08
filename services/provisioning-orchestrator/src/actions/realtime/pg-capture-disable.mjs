import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';
import { CaptureAuditRepository } from '../../repositories/realtime/CaptureAuditRepository.mjs';
import { PgCaptureLifecyclePublisher } from '../../events/realtime/PgCaptureLifecyclePublisher.mjs';
import { parseIdentity } from './parse-identity.mjs';
export async function main(params, deps = {}) {
  const identity = parseIdentity(params);
  if (!identity) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const auditRepo = deps.auditRepo ?? new CaptureAuditRepository(deps.db);
  const publisher = deps.publisher ?? new PgCaptureLifecyclePublisher(deps.producer);
  const captureId = params.captureId ?? params.path?.captureId;
  const current = await repo.findById(identity.tenantId, identity.workspaceId, captureId);
  if (!current) return { statusCode: 404, body: { code: 'CAPTURE_NOT_FOUND' } };
  if (current.status === 'disabled') return { statusCode: 409, body: { code: 'CAPTURE_ALREADY_DISABLED' } };
  const actorIdentity = identity.actorId;
  const updated = await repo.disable(captureId, actorIdentity);
  Promise.resolve(auditRepo.append({ captureId, tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorIdentity, action: 'capture-disabled', beforeState: current.toJSON(), afterState: updated.toJSON(), requestId: params.requestId ?? null })).catch(() => {});
  Promise.resolve(publisher.publish('capture-disabled', { action: 'capture-disabled', capture_id: captureId, table_name: current.table_name, actor_identity: actorIdentity, tenantId: identity.tenantId, workspaceId: identity.workspaceId, before_state: current.toJSON(), after_state: updated.toJSON() })).catch(() => {});
  return { statusCode: 204 };
}

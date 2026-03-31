import { queryEnforcementLog } from './quota-enforcement-repository.mjs';

function ensureStores(db) { db._planAuditEvents ??= []; db._quotaEnforcementLog ??= []; return db; }

export async function queryQuotaAudit(db, { tenantId = null, dimensionKey = null, actorId = null, from = null, to = null } = {}) {
  ensureStores(db);
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;
  const overrideEvents = db._planAuditEvents.filter((item) => item.action_type?.startsWith('quota.override.')).filter((item) => (!tenantId || item.tenant_id === tenantId) && (!actorId || item.actor_id === actorId)).filter((item) => {
    const ts = new Date(item.created_at).getTime();
    return (!fromMs || ts >= fromMs) && (!toMs || ts <= toMs);
  }).map((item) => ({ type: 'override', actionType: item.action_type, actorId: item.actor_id, tenantId: item.tenant_id, previousState: item.previous_state, newState: item.new_state, createdAt: item.created_at }));
  const enforcement = (await queryEnforcementLog(db, { tenantId, dimensionKey, actorId })).filter((item) => {
    const ts = new Date(item.createdAt).getTime();
    return (!fromMs || ts >= fromMs) && (!toMs || ts <= toMs);
  }).map((item) => ({ type: 'enforcement', ...item }));
  return [...overrideEvents, ...enforcement].sort((a, b) => new Date(a.createdAt ?? a.created_at) - new Date(b.createdAt ?? b.created_at));
}

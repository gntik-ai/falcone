import { queryQuotaAudit } from '../repositories/quota-audit-repository.mjs';

// tenant-owner may carry either the canonical hyphen form or the kind control-plane's underscore
// form (or the bare `tenant`) — accept all so the own-tenant guard fires regardless of the surface.
function isTenantOwner(type){ return type === 'tenant-owner' || type === 'tenant_owner' || type === 'tenant_admin' || type === 'tenant'; }

// Default-deny: superadmin/internal → any tenant; tenant-owner → own tenant only; everyone else →
// 403. The previous guard only restricted the hyphen `tenant-owner` form (and left other actor
// types unguarded), so a tenant operator read other tenants' quota audit.
function authorize(params){
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code:'FORBIDDEN', statusCode:403 });
  if (actor.type === 'superadmin' || actor.type === 'internal') return actor;
  if (isTenantOwner(actor.type)) return actor;
  throw Object.assign(new Error('Forbidden'), { code:'FORBIDDEN', statusCode:403 });
}

export async function main(params={}, overrides={}) {
  const db = overrides.db ?? params.db;
  const actor = authorize(params);
  const owner = isTenantOwner(actor.type);
  // A tenant-owner is always scoped to its own tenant; a cross-tenant request is rejected.
  if (owner && params.tenantId && params.tenantId !== actor.tenantId) throw Object.assign(new Error('Forbidden'), { code:'FORBIDDEN', statusCode:403 });
  const tenantId = owner ? actor.tenantId : (params.tenantId ?? null);
  const rows = await queryQuotaAudit(db,{ tenantId, dimensionKey:params.dimensionKey ?? null, actorId:params.actorId ?? null, from:params.from ?? null, to:params.to ?? null });
  return { statusCode:200, body:{ entries: rows, total: rows.length } };
}

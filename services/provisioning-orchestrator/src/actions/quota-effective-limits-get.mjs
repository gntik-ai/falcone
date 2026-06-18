import { resolveEffectiveLimitsForTenant } from '../repositories/quota-enforcement-repository.mjs';

// tenant-owner may carry either the canonical hyphen form or the kind control-plane's underscore
// form (or the bare `tenant`) — accept all so the own-tenant guard fires regardless of the surface.
function isTenantOwner(type){ return type === 'tenant-owner' || type === 'tenant_owner' || type === 'tenant_admin' || type === 'tenant'; }

// Default-deny (mirrors the sibling workspace-* actions): superadmin/internal → any tenant;
// tenant-owner → own tenant only; everyone else → 403. The previous guard only restricted the
// hyphen `tenant-owner` form, so a tenant operator (underscore form) read other tenants' quota.
function authorize(params, tenantId){
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code:'FORBIDDEN', statusCode:403 });
  if (actor.type === 'superadmin' || actor.type === 'internal') return actor;
  if (isTenantOwner(actor.type) && (actor.tenantId ?? tenantId) === tenantId) return actor;
  throw Object.assign(new Error('Forbidden'), { code:'FORBIDDEN', statusCode:403 });
}

export async function main(params={}, overrides={}) {
  const db = overrides.db ?? params.db;
  const tenantId = params.tenantId ?? params.callerContext?.actor?.tenantId;
  const actor = authorize(params, tenantId);
  const result = await resolveEffectiveLimitsForTenant(db, tenantId);
  if (isTenantOwner(actor.type)) result.effectiveLimits = result.effectiveLimits.map((item) => ({ ...item, overrideMetadata: undefined }));
  return { statusCode:200, body:result };
}

import { resolveTenantConsumption } from '../repositories/effective-entitlements-repository.mjs';
import { listSubQuotas } from '../repositories/workspace-sub-quota-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, TENANT_NOT_FOUND: 404 };
const SUB_QUOTA_PAGE_SIZE = 1000;

function resolveTenantId(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') {
    if (!params.tenantId) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
    return params.tenantId;
  }
  const actorTenantId = actor.tenantId ?? actor.tenant?.id ?? params.tenantId;
  const ownerTypes = new Set(['tenant_owner', 'tenant-owner', 'tenant']);
  if (!ownerTypes.has(actor.type) || !actorTenantId || (params.tenantId && params.tenantId !== actorTenantId)) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actorTenantId;
}

async function listAllSubQuotasForTenant(db, tenantId) {
  const items = [];
  let offset = 0;
  while (true) {
    const page = await listSubQuotas({ tenantId, limit: SUB_QUOTA_PAGE_SIZE, offset }, db);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length < SUB_QUOTA_PAGE_SIZE) break;
    offset += SUB_QUOTA_PAGE_SIZE;
  }
  return items;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const tenantId = resolveTenantId(params);
    const profile = await resolveTenantConsumption(db, tenantId);
    const subQuotas = await listAllSubQuotasForTenant(db, tenantId);
    return {
      statusCode: 200,
      body: {
        tenantId,
        dimensions: profile.quantitativeLimits.map((dimension) => {
          const workspaces = subQuotas
            .filter((item) => item.dimensionKey === dimension.dimensionKey)
            .map((item) => ({ workspaceId: item.workspaceId, allocatedValue: Number(item.allocatedValue) }));
          const totalAllocated = workspaces.reduce((sum, item) => sum + item.allocatedValue, 0);
          const unallocated = dimension.effectiveValue === -1 ? null : Math.max(dimension.effectiveValue - totalAllocated, 0);
          return {
            dimensionKey: dimension.dimensionKey,
            displayLabel: dimension.displayLabel,
            unit: dimension.unit,
            tenantEffectiveValue: dimension.effectiveValue,
            totalAllocated,
            unallocated,
            isFullyAllocated: unallocated === 0 && dimension.effectiveValue !== -1,
            workspaces
          };
        })
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

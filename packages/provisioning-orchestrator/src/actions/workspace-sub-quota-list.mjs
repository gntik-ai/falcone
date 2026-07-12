import { listSubQuotas } from '../repositories/workspace-sub-quota-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403 };

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') return { actor, workspaceId: params.workspaceId ?? null };
  if (actor.type === 'tenant_owner' || actor.type === 'tenant-owner' || actor.type === 'tenant') {
    if ((actor.tenantId ?? params.tenantId) !== params.tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
    return { actor, workspaceId: params.workspaceId ?? null };
  }
  if (actor.type === 'workspace_admin' || actor.type === 'workspace-admin') {
    if ((actor.tenantId ?? params.tenantId) !== params.tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
    return { actor, workspaceId: actor.workspaceId ?? actor.workspace?.id };
  }
  throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const auth = authorize(params);
    const limit = Number.isInteger(params.limit) ? params.limit : 50;
    const offset = Number.isInteger(params.offset) ? params.offset : 0;
    const result = await listSubQuotas({ tenantId: params.tenantId, workspaceId: auth.workspaceId, dimensionKey: params.dimensionKey ?? null, limit, offset }, db);
    return {
      statusCode: 200,
      body: {
        items: result.items.map((item) => ({ subQuotaId: item.id, tenantId: item.tenantId, workspaceId: item.workspaceId, dimensionKey: item.dimensionKey, allocatedValue: item.allocatedValue, createdBy: item.createdBy, updatedBy: item.updatedBy, createdAt: item.createdAt, updatedAt: item.updatedAt })),
        total: result.total,
        limit,
        offset
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

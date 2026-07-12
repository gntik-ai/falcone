import { resolveTenantConsumption, resolveWorkspaceConsumption } from '../repositories/effective-entitlements-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, TENANT_NOT_FOUND: 404, WORKSPACE_NOT_FOUND: 404 };

const TENANT_OWNER_TYPES = new Set(['tenant_owner', 'tenant-owner', 'tenant']);
const WORKSPACE_ADMIN_TYPES = new Set(['workspace_admin', 'workspace-admin']);

function resolveActorTenantId(params, actor) {
  return actor.tenantId ?? actor.tenant?.id ?? params.callerContext?.tenantId ?? null;
}

function resolveActorWorkspaceIds(params, actor) {
  const candidates = [
    actor.workspaceId,
    actor.workspace?.id,
    params.callerContext?.workspaceId,
    ...(Array.isArray(actor.workspaceIds) ? actor.workspaceIds : []),
    ...(Array.isArray(params.callerContext?.workspaceIds) ? params.callerContext.workspaceIds : [])
  ];
  return candidates.map((value) => value == null ? null : String(value)).filter(Boolean);
}

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (!params.workspaceId) throw Object.assign(new Error('Workspace not found'), { code: 'WORKSPACE_NOT_FOUND' });
  if (actor.type === 'superadmin' || actor.type === 'internal') {
    if (!params.tenantId) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
    return { tenantId: params.tenantId, workspaceId: params.workspaceId };
  }

  const actorTenantId = resolveActorTenantId(params, actor);
  if (!actorTenantId || (params.tenantId && params.tenantId !== actorTenantId)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  }
  if (TENANT_OWNER_TYPES.has(actor.type)) return { tenantId: actorTenantId, workspaceId: params.workspaceId };

  if (WORKSPACE_ADMIN_TYPES.has(actor.type)) {
    const actorWorkspaceIds = resolveActorWorkspaceIds(params, actor);
    if (actorWorkspaceIds.includes(String(params.workspaceId))) return { tenantId: actorTenantId, workspaceId: params.workspaceId };
  }

  throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const { tenantId, workspaceId } = authorize(params);
    const [workspace, tenantProfile] = await Promise.all([
      resolveWorkspaceConsumption(db, tenantId, workspaceId),
      resolveTenantConsumption(db, tenantId)
    ]);
    const capabilityMap = new Map(tenantProfile.capabilities.map((entry) => [entry.capabilityKey, entry]));
    return {
      statusCode: 200,
      body: {
        tenantId,
        workspaceId,
        snapshotAt: new Date().toISOString(),
        dimensions: workspace.quantitativeLimits.map((entry) => ({
          dimensionKey: entry.dimensionKey,
          displayLabel: entry.displayLabel,
          unit: entry.unit,
          tenantEffectiveValue: entry.tenantEffectiveValue,
          workspaceLimit: entry.workspaceLimit,
          workspaceSource: entry.workspaceSource,
          currentUsage: entry.currentUsage,
          usageStatus: entry.usageStatus,
          usageUnknownReason: entry.usageUnknownReason
        })),
        capabilities: tenantProfile.capabilities.map((entry) => ({ capabilityKey: entry.capabilityKey, displayLabel: entry.displayLabel, enabled: entry.effectiveState, source: capabilityMap.get(entry.capabilityKey)?.source ?? 'plan' }))
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

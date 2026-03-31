import { resolveUnifiedEntitlements, resolveWorkspaceLimits } from '../repositories/effective-entitlements-repository.mjs';
import { emitSubQuotaInconsistency } from '../events/workspace-sub-quota-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403 };
const dedup = new Map();
const WINDOW_MS = 5 * 60 * 1000;

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') return actor;
  if ((actor.type === 'tenant_owner' || actor.type === 'tenant-owner' || actor.type === 'tenant') && (actor.tenantId ?? params.tenantId) === params.tenantId) return actor;
  if ((actor.type === 'workspace_admin' || actor.type === 'workspace-admin') && (actor.tenantId ?? params.tenantId) === params.tenantId && (actor.workspaceId ?? actor.workspace?.id) === params.workspaceId) return actor;
  throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    authorize(params);
    const [workspaceEntries, profile] = await Promise.all([
      resolveWorkspaceLimits({ tenantId: params.tenantId, workspaceId: params.workspaceId }, db),
      resolveUnifiedEntitlements({ tenantId: params.tenantId }, db)
    ]);
    const dimensionMeta = new Map(profile.quantitativeLimits.map((entry) => [entry.dimensionKey, entry]));
    const dimensions = workspaceEntries.map((entry) => ({
      dimensionKey: entry.dimensionKey,
      displayLabel: dimensionMeta.get(entry.dimensionKey)?.displayLabel ?? entry.dimensionKey,
      unit: dimensionMeta.get(entry.dimensionKey)?.unit ?? 'count',
      tenantEffectiveValue: entry.tenantEffectiveValue,
      tenantSource: entry.tenantSource,
      quotaType: dimensionMeta.get(entry.dimensionKey)?.quotaType ?? 'hard',
      graceMargin: dimensionMeta.get(entry.dimensionKey)?.graceMargin ?? 0,
      workspaceLimit: entry.workspaceLimit,
      workspaceSource: entry.workspaceSource,
      isInconsistent: entry.isInconsistent
    }));
    const inconsistentDimensions = dimensions.filter((entry) => entry.isInconsistent).map((entry) => entry.dimensionKey);
    const now = Date.now();
    for (const entry of dimensions.filter((item) => item.isInconsistent)) {
      const key = `${params.tenantId}:${params.workspaceId}:${entry.dimensionKey}`;
      if ((dedup.get(key) ?? 0) + WINDOW_MS > now) continue;
      dedup.set(key, now);
      await emitSubQuotaInconsistency({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: entry.dimensionKey, subQuotaValue: entry.workspaceLimit, tenantEffectiveLimit: entry.tenantEffectiveValue, timestamp: new Date(now).toISOString() }, producer);
    }
    return { statusCode: 200, body: { tenantId: params.tenantId, workspaceId: params.workspaceId, dimensions, inconsistentDimensions } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

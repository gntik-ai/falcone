import { getWorkspace } from './tenant-store.mjs';
import { canManageTenant } from './tenant-scope.mjs';
import { recordQuotaEnforcement } from './audit-writer.mjs';

async function defaultLoad() {
  // The image flattens this app into /app and ships governance under /repo.
  const load = path => import(`/repo/packages/provisioning-orchestrator/src/${path}`).catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return import(new URL(`../../packages/provisioning-orchestrator/src/${path}`, import.meta.url));
  });
  const [repo, model, catalog] = await Promise.all([
    load('repositories/quota-enforcement-repository.mjs'),
    load('models/quota-enforcement.mjs'),
    load('repositories/quota-dimension-catalog-repository.mjs'),
  ]);
  return { resolveEffectiveLimit: repo.resolveEffectiveLimit, evaluateQuotaDecision: model.evaluateQuotaDecision,
    listAllDimensions: catalog.listAllDimensions };
}

// Product services own usage; this decision never reserves or increments counters.
export async function decideProductQuota(pool, { tenantId, dimensionKey, currentUsage, requested = 1 }, opts = {}) {
  const invalidKey = () => Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
  if (typeof dimensionKey !== 'string' || !dimensionKey.startsWith('codewiki_')) throw invalidKey();
  if (dimensionKey === 'codewiki_max_repository_bytes' && currentUsage !== 0) {
    throw Object.assign(new Error('Repository snapshots require currentUsage 0'), { code: 'VALIDATION_ERROR' });
  }
  let mods, catalog;
  try {
    mods = await (opts.load ?? defaultLoad)();
    catalog = await mods.listAllDimensions(pool);
    if (!Array.isArray(catalog)) return { unavailable: true };
  } catch {
    return { unavailable: true };
  }
  if (!catalog.some(row => row.dimensionKey === dimensionKey)) throw invalidKey();
  try {
    const eff = await mods.resolveEffectiveLimit(pool, tenantId, dimensionKey);
    if (!Number.isSafeInteger(eff?.effectiveLimit) || eff.effectiveLimit < -1) return { unavailable: true };
    const projectedUsage = currentUsage + requested;
    let decision = mods.evaluateQuotaDecision({ ...eff, currentUsage: projectedUsage - 1 });
    // Exact hard fills are allowed, but the product's soft grace ceiling is exclusive.
    if (eff.quotaType === 'soft' && eff.effectiveLimit !== -1 && projectedUsage >= decision.effectiveCeiling) {
      decision = mods.evaluateQuotaDecision({ ...eff, currentUsage: projectedUsage });
    }
    return { ...decision, dimensionKey, currentUsage, projectedUsage, source: eff.source ?? 'default' };
  } catch {
    return { unavailable: true };
  }
}

const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

async function productQuotaDecision(ctx) {
  const workspace = await getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!workspace) return err(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  const identity = ctx.identity;
  const bindings = [identity?.workspaceId, ...(identity?.workspaceIds ?? [])];
  if (!canManageTenant(identity, workspace.tenant_id)
    && !(identity?.tenantId === workspace.tenant_id && bindings.includes(workspace.id))) {
    return err(403, 'FORBIDDEN', 'Workspace access required');
  }
  const body = ctx.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['dimensionKey', 'currentUsage', 'requested', 'attemptedAction'].includes(key))
    || !Number.isSafeInteger(body.currentUsage) || body.currentUsage < 0
    || (body.requested !== undefined && (!Number.isSafeInteger(body.requested) || body.requested < 1))
    || !Number.isSafeInteger(body.currentUsage + (body.requested ?? 1))
    || (body.attemptedAction !== undefined && (typeof body.attemptedAction !== 'string'
      || body.attemptedAction.length > 64 || !/^[a-z0-9._-]+$/.test(body.attemptedAction)))) {
    return err(400, 'VALIDATION_ERROR', 'Invalid quota decision body');
  }
  const { dimensionKey, currentUsage, requested = 1, attemptedAction } = ctx.body;
  let result;
  try {
    result = await decideProductQuota(ctx.pool, { tenantId: workspace.tenant_id, dimensionKey, currentUsage, requested });
  } catch (error) {
    if (['INVALID_DIMENSION_KEY', 'VALIDATION_ERROR'].includes(error.code)) {
      return err(400, 'VALIDATION_ERROR', error.message);
    }
    return err(503, 'QUOTA_UNAVAILABLE', 'Quota decision unavailable');
  }
  if (result.unavailable) return err(503, 'QUOTA_UNAVAILABLE', 'Quota decision unavailable');
  if (!result.allowed) {
    await recordQuotaEnforcement(ctx.pool, { ...result, tenantId: workspace.tenant_id, workspaceId: workspace.id,
      attemptedAction, actorId: identity?.sub ?? null, correlationId: ctx.callerContext?.correlationId ?? null });
  }
  const { allowed, decision, quotaType, effectiveLimit, effectiveCeiling, projectedUsage, source, warning } = result;
  return { statusCode: 200, body: { allowed, decision, dimensionKey, quotaType, effectiveLimit, effectiveCeiling,
    currentUsage, projectedUsage, source, ...(warning === undefined ? {} : { warning }) } };
}

export const PRODUCT_QUOTA_HANDLERS = { productQuotaDecision };

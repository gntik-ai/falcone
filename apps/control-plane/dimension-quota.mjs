import { recordQuotaEnforcement } from './audit-writer.mjs';

// Live admission points in this runtime. Keep posture reports tied to these gates.
export const ENFORCED_DIMENSION_KEYS = new Set([
  'max_workspaces', 'max_kafka_topics', 'max_mongo_databases', 'max_functions', 'max_storage_bytes',
]);

async function defaultLoad() {
  const [repo, model] = await Promise.all([
    import('/repo/packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs'),
    import('/repo/packages/provisioning-orchestrator/src/models/quota-enforcement.mjs'),
  ]);
  return { resolveEffectiveLimit: repo.resolveEffectiveLimit, evaluateQuotaDecision: model.evaluateQuotaDecision };
}

// Usage can be a lazy meter so unavailable governance does not trigger external reads.
// Byte admission compares projected integer bytes to the ceiling, allowing exact fills.
// Loader, resolver and metering failures remain fail-open governance decisions.
export async function checkDimensionQuota(pool, tenantId, dimensionKey, currentUsage, opts = {}) {
  try {
    const mods = await (opts.load ?? defaultLoad)();
    const eff = await mods.resolveEffectiveLimit(pool, tenantId, dimensionKey);
    if (opts.skipUnlimitedMeter && eff.effectiveLimit === -1) {
      return { ...mods.evaluateQuotaDecision({ ...eff, currentUsage: 0 }), source: eff.source ?? 'default', dimensionKey };
    }
    const usage = await (typeof currentUsage === 'function' ? currentUsage() : currentUsage);
    const incoming = opts.incomingBytes === undefined ? undefined
      : await (typeof opts.incomingBytes === 'function' ? opts.incomingBytes() : opts.incomingBytes);
    if (usage == null || !Number.isFinite(Number(usage)) || (incoming !== undefined && (incoming == null || !Number.isFinite(Number(incoming))))) {
      return { allowed: true, decision: 'quota_unavailable', dimensionKey, ...eff };
    }
    const decision = mods.evaluateQuotaDecision({
      effectiveLimit: eff.effectiveLimit, quotaType: eff.quotaType, graceMargin: eff.graceMargin,
      currentUsage: incoming === undefined ? Number(usage) : Number(usage) + Number(incoming) - 1,
    });
    return { ...decision, currentUsage: Number(usage),
      ...(incoming === undefined ? {} : { projectedUsage: Number(usage) + Number(incoming) }),
      source: eff.source ?? 'default', dimensionKey };
  } catch {
    return { allowed: true, decision: 'quota_unavailable', dimensionKey };
  }
}

// Call only after authorization/ownership, before writes. Logging never changes admission.
export async function quotaDenial(ctx, workspace, decision, attemptedAction) {
  if (decision.allowed) return null;
  try {
    await (ctx.recordQuotaEnforcement ?? recordQuotaEnforcement)(ctx.pool, {
      ...decision, tenantId: workspace.tenant_id, workspaceId: workspace.id,
      attemptedAction, actorId: ctx.identity?.sub ?? null,
      correlationId: ctx.callerContext?.correlationId ?? null,
    });
  } catch { /* best-effort, including injected writers */ }
  return { statusCode: 402, body: {
    code: 'QUOTA_EXCEEDED',
    message: `quota reached (${decision.dimensionKey}): ${decision.projectedUsage ?? decision.currentUsage}/${decision.effectiveLimit}`,
  } };
}

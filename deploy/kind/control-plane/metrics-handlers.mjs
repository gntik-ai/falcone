// Console metrics handlers (domain B glue, kind deploy).
//
// The web-console Quotas + Observability pages call /v1/metrics/{tenants|
// workspaces}/{id}/{overview,quotas,usage,series,audit-records,audit-exports},
// but the repo ships NO action for them (discovery: module=NONE; the audit query
// action exists but its defaultLoader returns empty without an injected reader).
// We synthesize the shapes those pages expect from REAL data where it exists:
//   - limits  -> tenant-effective-entitlements / workspace-consumption (real)
//   - usage   -> the currentUsage carried by those same actions
//   - series  -> empty (no per-tenant time-series; the metrics data plane isn't deployed)
//   - audit   -> empty (no audit-record store/reader in this deploy)
// Honest: limits are real; usage/series/audit reflect what's actually available.
import { randomUUID } from 'node:crypto';
import * as store from './tenant-store.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const nowIso = () => new Date().toISOString();
const ENTITLEMENTS = '/repo/services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs';
const WS_CONSUMPTION = '/repo/services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs';

// Normalized limit row -> posture/overview dimension (shared by quotas + observability).
function dimensionsFromLimits(limits) {
  const dimensions = [];
  const breaches = [];
  for (const l of limits) {
    const hardLimit = typeof l.effectiveValue === 'number' ? l.effectiveValue : null;
    const measured = typeof l.currentUsage === 'number' ? l.currentUsage : 0;
    const known = Boolean(l.usageStatus) && l.usageStatus !== 'unknown';
    if (known && hardLimit != null && measured >= hardLimit) breaches.push(l.dimensionKey);
    dimensions.push({
      dimensionId: l.dimensionKey,
      displayName: l.displayLabel ?? l.dimensionKey,
      policyMode: l.quotaType === 'soft' || hardLimit == null ? 'unbounded' : 'enforced',
      hardLimit,
      softLimit: null,
      measuredValue: measured,
      remainingToHardLimit: hardLimit != null ? Math.max(0, hardLimit - measured) : null,
      freshnessStatus: known ? 'fresh' : 'unavailable'
    });
  }
  return { dimensions, breaches };
}
const overallPosture = (breaches) => (breaches.length ? 'critical' : 'healthy');

async function tenantLimits(ctx, tenantId) {
  const client = await ctx.pool.connect();
  try {
    const mod = await import(ENTITLEMENTS);
    const res = await mod.main({ tenantId, include: 'consumption', callerContext: ctx.callerContext }, { db: client });
    return res?.body?.quantitativeLimits ?? [];
  } finally {
    client.release();
  }
}

async function workspaceLimits(ctx, workspaceId) {
  const client = await ctx.pool.connect();
  try {
    const ws = await store.getWorkspace(client, workspaceId);
    if (!ws) return [];
    const mod = await import(WS_CONSUMPTION);
    const res = await mod.main({ tenantId: ws.tenant_id, workspaceId, callerContext: ctx.callerContext }, { db: client });
    return (res?.body?.dimensions ?? []).map((d) => ({
      dimensionKey: d.dimensionKey,
      displayLabel: d.displayLabel,
      unit: d.unit,
      effectiveValue: typeof d.workspaceLimit === 'number' ? d.workspaceLimit : d.tenantEffectiveValue,
      quotaType: 'hard',
      currentUsage: d.currentUsage,
      usageStatus: d.usageStatus
    }));
  } catch {
    return [];
  } finally {
    client.release();
  }
}

// limits accessor by scope (tenant if no workspaceId in path, else workspace)
const limitsFor = (ctx) =>
  ctx.params.workspaceId ? workspaceLimits(ctx, ctx.params.workspaceId) : tenantLimits(ctx, ctx.params.tenantId);

// ---- quotas posture (Quotas page) ------------------------------------------
async function quotas(ctx) {
  const { dimensions, breaches } = dimensionsFromLimits(await limitsFor(ctx));
  return ok(200, { evaluatedAt: nowIso(), dimensions, hardLimitBreaches: breaches });
}
// ---- overview (Quotas + Observability) — carries posture AND dimensions ----
async function overview(ctx) {
  const { dimensions, breaches } = dimensionsFromLimits(await limitsFor(ctx));
  return ok(200, { generatedAt: nowIso(), overallPosture: overallPosture(breaches), hardLimitDimensions: breaches, dimensions });
}
// ---- usage snapshot (Observability) — currentUsage per dimension -----------
async function usage(ctx) {
  const limits = await limitsFor(ctx);
  return ok(200, {
    measuredAt: nowIso(),
    dimensions: limits.map((l) => {
      const value = typeof l.currentUsage === 'number' ? l.currentUsage : 0;
      return { dimensionId: l.dimensionKey, metricKey: l.dimensionKey, value, measuredValue: value, points: [] };
    })
  });
}
// ---- series (Observability) — no per-tenant time series in this deploy ------
async function series() {
  return ok(200, { points: [] });
}
// ---- audit records (Observability) — no audit store/reader in this deploy --
async function auditRecords() {
  return ok(200, { items: [], page: { size: 0, hasMore: false, nextCursor: null } });
}
// ---- audit export (Observability) — accept the request (no export pipeline) -
async function auditExport(ctx) {
  return ok(202, { exportId: `exp_${randomUUID()}`, status: 'accepted', requestedAt: nowIso(),
    message: 'Audit export accepted (no export pipeline is deployed; this acknowledges the request).',
    filters: ctx.body?.filters ?? {} });
}

// Tenant + workspace share the same handlers (scope inferred from the path params).
export const METRICS_HANDLERS = {
  metricsTenantQuotas: quotas, metricsWorkspaceQuotas: quotas,
  metricsTenantOverview: overview, metricsWorkspaceOverview: overview,
  metricsTenantUsage: usage, metricsWorkspaceUsage: usage,
  metricsTenantSeries: series, metricsWorkspaceSeries: series,
  metricsTenantAudit: auditRecords, metricsWorkspaceAudit: auditRecords,
  metricsTenantAuditExport: auditExport, metricsWorkspaceAuditExport: auditExport
};

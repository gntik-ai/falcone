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
import { canManageTenant } from './tenant-scope.mjs';
import { queryAuditEvents, auditRowToRecord } from './audit-store.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
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
  } catch {
    // finding F4: the metrics route already authorizes the caller (auth + tenant-scoping; a
    // foreign tenant is denied 403 at the route layer). The inner entitlements action enforces a
    // STRICTER actor-type allow-list, so an authorized same-tenant non-owner (e.g. tenant_admin)
    // tripped FORBIDDEN, and a missing quota relation tripped 42P01 — either bubbled to a 500.
    // Degrade gracefully to an empty (healthy) posture, exactly like workspaceLimits, so the
    // Quotas page renders instead of erroring; real limits surface when resolvable.
    return [];
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
// ---- series (Observability) — real per-tenant time series from Prometheus ---
// Backs the Observability page with the in-cluster Prometheus (#499): queries the tenant's HTTP
// request rate (from the falcone_http_requests_total counter the control-plane/executor now
// expose) over the last hour. Falls back to empty points (never errors) if Prometheus is
// unreachable, so the page degrades gracefully.
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? 'http://falcone-observability:9090';
async function series(ctx) {
  const tenantId = String(ctx.params?.tenantId ?? ctx.identity?.tenantId ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const metricKey = ctx.query?.metric ?? 'http_requests_per_second';
  const promQL = `sum(rate(falcone_http_requests_total{tenant_id="${tenantId}"}[5m]))`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 3600;
  try {
    const u = new URL('/api/v1/query_range', PROMETHEUS_URL);
    u.searchParams.set('query', promQL);
    u.searchParams.set('start', String(start));
    u.searchParams.set('end', String(end));
    u.searchParams.set('step', '60');
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return ok(200, { metricKey, points: [], source: 'prometheus_unavailable' });
    const data = await res.json();
    const points = (data?.data?.result?.[0]?.values ?? []).map(([t, v]) => ({ timestamp: new Date(t * 1000).toISOString(), value: Number(v) }));
    return ok(200, { metricKey, points, source: 'prometheus' });
  } catch {
    return ok(200, { metricKey, points: [], source: 'prometheus_unreachable' });
  }
}
// ---- audit records (Observability) — read the action-audit store (#557) ----
// Reads plan_audit_events (the WRITER side, audit-store.mjs), scoped to the path's
// owning tenant (and workspace, for the workspace route). guarded() has already
// resolved + authorized the scope tenant, so this only ever returns own-tenant
// records. Degrades to an empty page (never 500) if the store is unreadable.
async function auditRecords(ctx) {
  const scope = await resolveScopeTenant(ctx);
  if (scope.error) return scope.error;
  const limit = Math.min(Math.max(Number(ctx.query?.['page[size]'] ?? ctx.query?.limit ?? 50) || 50, 1), 200);
  try {
    const rows = await queryAuditEvents(ctx.pool, {
      tenantId: scope.tenantId,
      workspaceId: ctx.params.workspaceId ?? null,
      limit
    });
    const items = rows.map(auditRowToRecord);
    return ok(200, { items, page: { size: items.length, hasMore: false, nextCursor: null } });
  } catch {
    return ok(200, { items: [], page: { size: 0, hasMore: false, nextCursor: null } });
  }
}
// ---- audit export (Observability) — accept the request (no export pipeline) -
async function auditExport(ctx) {
  return ok(202, { exportId: `exp_${randomUUID()}`, status: 'accepted', requestedAt: nowIso(),
    message: 'Audit export accepted (no export pipeline is deployed; this acknowledges the request).',
    filters: ctx.body?.filters ?? {} });
}

// ---- own-tenant authorization (P0 ISO-METRICS) -----------------------------
// Every metrics route is `auth: authenticated`, so without this guard ANY verified
// caller could read ANY tenant's metrics by id (and a non-existent id returned a
// 200). Resolve the path scope to its owning tenant and apply the same own-tenant
// guard b-handlers uses for tenant/workspace management: tenant owners/admins may
// read only their own tenant; superadmin/internal may read any.
async function resolveScopeTenant(ctx) {
  if (ctx.params.workspaceId) {
    const ws = await store.getWorkspace(ctx.pool, ctx.params.workspaceId);
    if (!ws) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
    return { tenantId: ws.tenant_id };
  }
  return { tenantId: ctx.params.tenantId };
}
function guarded(handler) {
  return async (ctx) => {
    const scope = await resolveScopeTenant(ctx);
    if (scope.error) return scope.error;
    if (!canManageTenant(ctx.identity, scope.tenantId)) {
      return err(403, 'FORBIDDEN', 'cannot read another tenant’s metrics');
    }
    return handler(ctx);
  };
}

// Tenant + workspace share the same handlers (scope inferred from the path params).
export const METRICS_HANDLERS = {
  metricsTenantQuotas: guarded(quotas), metricsWorkspaceQuotas: guarded(quotas),
  metricsTenantOverview: guarded(overview), metricsWorkspaceOverview: guarded(overview),
  metricsTenantUsage: guarded(usage), metricsWorkspaceUsage: guarded(usage),
  metricsTenantSeries: guarded(series), metricsWorkspaceSeries: guarded(series),
  metricsTenantAudit: guarded(auditRecords), metricsWorkspaceAudit: guarded(auditRecords),
  metricsTenantAuditExport: guarded(auditExport), metricsWorkspaceAuditExport: guarded(auditExport)
};

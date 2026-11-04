import type { PageEndpoint, ParityManifest } from '../manifest'

const tenant = '/v1/metrics/tenants/synthetic-tenant'
const workspace = '/v1/metrics/workspaces/synthetic-workspace'
const ok = (body: unknown) => ({ status: 200, body })
const error = (status: number) => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error', requestId: `req_synthetic_observability_${status}` } })

export const overviewMixed = {
  generatedAt: '2026-06-01T12:00:00Z', overallPosture: 'hard_limit_breached',
  dimensions: [
    { dimensionId: 'max_api_keys', displayName: 'Synthetic API Keys', measuredValue: 8, hardLimit: 10, policyMode: 'enforced', freshnessStatus: 'fresh', unit: 'count' },
    { dimensionId: 'max_requests', displayName: 'Synthetic Requests', measuredValue: 110, hardLimit: 100, policyMode: 'enforced', freshnessStatus: 'fresh', unit: 'count' },
    { dimensionId: 'max_storage_bytes', displayName: 'Synthetic Storage', measuredValue: 2048, hardLimit: 8192, policyMode: 'enforced', freshnessStatus: 'fresh', unit: 'bytes' },
    { dimensionId: 'events', displayName: 'Synthetic Events', measuredValue: 1200, hardLimit: null, policyMode: 'unbounded', freshnessStatus: 'fresh', unit: 'count' },
    { dimensionId: 'functions', displayName: 'Synthetic Functions', measuredValue: 0, hardLimit: 20, policyMode: 'not_enforced', freshnessStatus: 'fresh', unit: 'count' },
  ],
}
const points = (count: number, step: number) => Array.from({ length: count }, (_, index) => ({ timestamp: new Date(Date.UTC(2026, 5, 1, 12) - (count - 1 - index) * step).toISOString(), value: 1000 + index * 125 }))
export const usageSnapshot = { measuredAt: '2026-06-01T12:00:00Z', dimensions: [{ dimensionId: 'max_requests', value: 110 }] }
export const usageWithPoints = { measuredAt: '2026-06-01T12:00:00Z', dimensions: [{ dimensionId: 'max_requests', value: 110, points: points(4, 3_600_000) }] }
export const series24h = { points: points(8, 3_600_000) }
export const series7d = { points: points(7, 86_400_000) }

const category = ['iam_access', 'quota_change', 'secret_rotation']
export function auditRecord(index: number) {
  const id = `evt-${String(index).padStart(3, '0')}`
  return {
    eventId: id, eventTimestamp: new Date(Date.UTC(2026, 5, 1, 11) - index * 60_000).toISOString(), correlationId: `corr-${id}`,
    actor: { actorId: 'synthetic-actor', actorType: 'user', displayName: 'Synthetic Actor' },
    action: { actionId: 'synthetic.action', category: category[index % category.length] },
    resource: { resourceId: `res-${id}`, resourceType: 'quota', workspaceId: 'synthetic-workspace' },
    result: { outcome: index % 5 === 0 ? 'failed' : 'succeeded' }, origin: { originSurface: 'console', ipAddress: '203.0.113.7' },
    scope: { tenantId: 'synthetic-tenant' }, metadata: { reason: `synthetic-${id}` },
  }
}
const records = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => auditRecord(from + index))
export const firstPage = { items: records(1, 50), page: { hasMore: true, nextCursor: 'synthetic-cursor-2' } }
export const lastPage = { items: records(51, 60), page: { hasMore: false, nextCursor: null } }
export const filteredPage = { items: [auditRecord(900)], page: { hasMore: false, nextCursor: null } }
export const manifestBody = { exportId: 'exp-synthetic-1', status: 'completed', itemCount: 3, maskedItemCount: 1, items: [{ eventId: 'evt-001' }, { eventId: 'evt-002' }, { eventId: 'evt-003' }] }
const acceptedBody = { exportId: 'exp-accepted-1', status: 'accepted', message: 'synthetic-queued' }

function metricEndpoints(prefix: string, root: string, scope: 'tenant' | 'workspace'): Record<string, PageEndpoint> {
  const overviewFixtures = {
    success: ok(overviewMixed), 'mixed-posture': ok(overviewMixed), empty: ok({ ...overviewMixed, dimensions: [] }), 'empty-dimensions': ok({ ...overviewMixed, dimensions: [] }),
    '401': error(401), '403': error(403), '404': error(404), '500': error(500), network: { network: true },
    '500-then-success': [error(500), ok(overviewMixed)], delayed: { ...ok(overviewMixed), delayMs: 1500 },
  }
  return {
    [`${prefix}.overview`]: { method: 'GET', path: `${root}/overview`, fixtures: overviewFixtures },
    [`${prefix}.usage`]: { method: 'GET', path: `${root}/usage`, fixtures: { success: ok(usageSnapshot), 'with-points': ok(usageWithPoints), '500': error(500), network: { network: true } } },
    ...(scope === 'workspace' ? { [`${prefix}.series`]: { method: 'GET', path: `${root}/series`, fixtures: { success: ok(series24h), '24h': ok(series24h), '7d': ok(series7d), empty: ok({ points: [] }), '500': error(500) } } } : {}),
    [`${prefix}.records`]: { method: 'GET', path: `${root}/audit-records`, fixtures: {
      success: ok(firstPage), 'first-page-has-more': [ok(firstPage), ok(lastPage)], 'last-page': ok(lastPage), filtered: [ok(firstPage), ok(filteredPage)], empty: ok({ items: [], page: { hasMore: false, nextCursor: null } }),
      '401': error(401), '403': error(403), '404': error(404), '500': error(500), network: { network: true },
      'next-page-500': [ok(firstPage), error(500), ok(lastPage)], 'next-page-network': [ok(firstPage), { network: true }, ok(lastPage)], '500-then-success': [error(500), ok(firstPage)],
      delayed: { ...ok(firstPage), delayMs: 1500 },
    } },
    [`${prefix}.exports`]: { method: 'POST', path: `${root}/audit-exports`, fixtures: {
      success: ok(manifestBody), manifest: ok(manifestBody), 'accepted-no-manifest': ok(acceptedBody), 'no-status': ok({}), '500': error(500), '403': error(403), network: { network: true },
      '500-then-success': [error(500), ok(manifestBody)], 'network-then-success': [{ network: true }, ok(manifestBody)], slow: { ...ok(manifestBody), delayMs: 1500 },
    } },
  }
}
export const observabilityEndpoints: Record<string, PageEndpoint> = { ...metricEndpoints('metrics.tenant', tenant, 'tenant'), ...metricEndpoints('metrics.workspace', workspace, 'workspace') }
// Tenant-scope names reuse the audit keys so the spec reads the same in both scopes.
export const intendedDifferences = [
  'D1 Cargar mas with a loaded count replaces the 50-record cap note', 'D2 Export failure shows an error-panel with request id and Reintentar', 'D3 Event detail opens in a drawer',
  'D4 The api_requests series renders in a chart card', 'D5 Locale formatted timestamps', 'D6 Kit tones replace emerald, amber and red classes', 'D7 In-page 403 and 404 states',
  'D8 Window reason in a tooltip linked by aria-describedby', 'D9 Kit tabs', 'D10 Two date pickers with catalog labels (Desde and Hasta are independent)', 'D11 Clear filters in the empty audit state',
  'D12 Primary export button', 'D13 Client-side dimension search',
]
const manifest: ParityManifest & { intendedDifferences: string[] } = {
  route: '/console/observability', roles: ['tenant_viewer', 'superadmin'], endpoints: observabilityEndpoints, intendedDifferences,
  fixtures: ['tenants', 'tenant', 'workspaces', 'refresh', ...Object.keys(observabilityEndpoints)],
  sources: ['src/pages/consoleObservability.tsx', 'src/pages/consoleObservability'],
  data: [{ name: 'dimension list', locator: '.console-observability ul[data-dimensions], .console-observability li[data-dimension]' }],
  actions: [],
  states: [
    { fixture: 'metrics.workspace.overview', variant: 'empty', locator: { es: 'h3:text-is("Sin métricas en este periodo")', en: 'h3:text-is("No metrics in this period")' } },
    { fixture: 'metrics.workspace.overview', variant: '403', locator: { es: 'h2:text-is("Acceso denegado a las métricas")', en: 'h2:text-is("Access denied to metrics")' } },
    { fixture: 'metrics.workspace.overview', variant: '404', locator: { es: 'h2:text-is("Métricas no encontradas")', en: 'h2:text-is("Metrics not found")' } },
    { fixture: 'metrics.workspace.overview', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar las métricas")', en: 'h2:text-is("Metrics could not be loaded")' } },
    { fixture: 'metrics.workspace.overview', variant: 'network', locator: { es: 'h2:text-is("No se pudieron cargar las métricas")', en: 'h2:text-is("Metrics could not be loaded")' } },
  ],
}
export default manifest

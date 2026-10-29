import type { PageEndpoint, ParityManifest } from '../manifest'
import type { QuotaPostureResponse } from '@in-falcone/console-api/clients'

export const quotasTenant: QuotaPostureResponse = {
  evaluatedAt: '2026-06-01T12:00:00Z', hardLimitBreaches: ['max_requests'],
  dimensions: [
    { dimensionId: 'max_workspaces', displayName: 'Maximum Workspaces', hardLimit: 5, measuredValue: 3, unit: 'count', policyMode: 'enforced', freshnessStatus: 'fresh' },
    { dimensionId: 'max_api_keys', displayName: 'Synthetic API Keys', hardLimit: 10, measuredValue: 8, unit: 'count', policyMode: 'enforced', freshnessStatus: 'degraded' },
    { dimensionId: 'max_requests', displayName: 'Synthetic Requests', hardLimit: 100, measuredValue: 110, unit: 'count', policyMode: 'enforced', freshnessStatus: 'fresh' },
    { dimensionId: 'max_storage_bytes', displayName: 'Synthetic Storage', hardLimit: 8192, measuredValue: 2048, unit: 'bytes', policyMode: 'enforced', freshnessStatus: 'fresh' },
    { dimensionId: 'events', displayName: 'Synthetic Events', hardLimit: null, measuredValue: 1200, policyMode: 'unbounded', freshnessStatus: 'unavailable' },
    { dimensionId: 'functions', displayName: 'Synthetic Functions', hardLimit: 20, measuredValue: 0, policyMode: 'not_enforced', freshnessStatus: 'fresh' },
  ],
}
export const quotasWorkspace: QuotaPostureResponse = { ...quotasTenant, hardLimitBreaches: [], dimensions: quotasTenant.dimensions!.filter((_, index) => [0, 3, 4].includes(index)) }
export const overviewTenant = { generatedAt: '2026-06-01T12:00:00Z', overallPosture: 'critical', hardLimitDimensions: ['max_requests'] }
export const overviewWorkspace = { ...overviewTenant, overallPosture: 'healthy', hardLimitDimensions: [] }
export const tenantPlanReady = { assignment: { planId: 'synthetic-plan' }, plan: { id: 'synthetic-plan', displayName: 'Synthetic Shared Plan', status: 'active' } }
const ok = (body: unknown) => ({ status: 200, body })
const error = (status: number, code = `HTTP_${status}`) => ({ status, body: { code, message: 'synthetic-error', requestId: `req_synthetic_quotas_${status}` } })
const tenantOk = ok(quotasTenant)
export const quotaEndpoints: Record<string, PageEndpoint> = {
  'quotas.tenant': { method: 'GET', path: '/v1/metrics/tenants/synthetic-tenant/quotas', fixtures: {
    success: tenantOk, 'quotas-tenant': tenantOk, empty: ok({ dimensions: [] }), 'quotas-empty': ok({ dimensions: [] }),
    'quotas-delayed': { ...tenantOk, delayMs: 1500 },
    'quotas-tenant-after-unlimited': ok({ ...quotasTenant, dimensions: quotasTenant.dimensions!.map((row, index) => index ? row : { ...row, hardLimit: null, policyMode: 'unbounded' }) }),
    '401': error(401), '403': error(403), '404': error(404), '500': error(500), network: { network: true },
    'quotas-401': error(401), 'quotas-403': error(403), 'quotas-404': error(404), 'quotas-500': error(500), 'quotas-network': { network: true },
    'quotas-500-then-ok': [error(500), tenantOk],
  } },
  'quotas.tenantOverview': { method: 'GET', path: '/v1/metrics/tenants/synthetic-tenant/overview', fixtures: {
    success: ok(overviewTenant), 'overview-tenant': ok(overviewTenant),
    ...Object.fromEntries(['healthy', 'hard_limit_reached', 'soft_limit_exceeded', 'evidence_degraded', 'evidence_unavailable', 'unbounded'].map((overallPosture) => [overallPosture, ok({ ...overviewTenant, overallPosture })])),
  } },
  'quotas.workspace': { method: 'GET', path: '/v1/metrics/workspaces/synthetic-workspace/quotas', fixtures: { success: ok(quotasWorkspace), 'quotas-workspace': ok(quotasWorkspace), empty: ok({ dimensions: [] }), '404': error(404), '500': error(500) } },
  'quotas.workspaceOverview': { method: 'GET', path: '/v1/metrics/workspaces/synthetic-workspace/overview', fixtures: { success: ok(overviewWorkspace), 'overview-workspace': ok(overviewWorkspace) } },
  'quotas.plan': { method: 'GET', path: '/v1/tenants/synthetic-tenant/plan', fixtures: {
    success: ok(tenantPlanReady), 'tenant-plan-ready': ok(tenantPlanReady),
    'tenant-plan-draft': ok({ ...tenantPlanReady, plan: { ...tenantPlanReady.plan, status: 'draft' } }),
    ...Object.fromEntries(['deprecated', 'archived', 'frozen'].map((state) => [`tenant-plan-${state}`, ok({ ...tenantPlanReady, plan: { ...tenantPlanReady.plan, status: state === 'frozen' ? 'deprecated' : state } })])),
    'tenant-plan-none': ok({ noAssignment: true }), 'tenant-plan-missing': ok({ assignment: { planId: 'synthetic-plan' } }),
    'tenant-plan-500': error(500), 'tenant-plan-500-then-ready': [error(500), ok(tenantPlanReady)],
    'tenant-plan-delayed': { ...ok(tenantPlanReady), delayMs: 1500 }, 'tenant-plan-delayed-then-500': { ...error(500), delayMs: 1500 },
  } },
  'quotas.put': { method: 'PUT', path: '/v1/plans/synthetic-plan/limits/max_workspaces', fixtures: {
    success: (_role, body) => ok({ planId: 'synthetic-plan', dimensionKey: 'max_workspaces', newValue: (body as { value: number }).value, source: 'explicit' }),
    'plan-limit-put-ok': ok({ newValue: 500 }), 'plan-limit-put-unlimited-ok': ok({ newValue: -1 }),
    'plan-limit-put-slow': { ...ok({ newValue: 500 }), delayMs: 2000 }, 'plan-limit-put-slow-500': { ...error(500), delayMs: 2000 },
    'plan-limit-put-invalid': error(400, 'INVALID_LIMIT_VALUE'), 'plan-limit-put-frozen': error(409, 'PLAN_LIMITS_FROZEN'),
    'plan-limit-put-403': error(403), 'plan-limit-put-404': error(404),
  } },
}
export const intendedDifferences = [
  'Client-side dimension search', 'Plan-wide confirmation step', 'One toast and live announcement after saving alongside inline success',
  'Error-panel request ID', 'Posture 403 and 404 states', 'First-run empty state', 'Localized timestamp', 'Loading skeletons', 'Meter tones', 'English locale',
]
const manifest: ParityManifest & { intendedDifferences: string[] } = {
  route: '/console/quotas', roles: ['superadmin', 'tenant_viewer'], endpoints: quotaEndpoints,
  fixtures: ['tenants', 'tenant', 'workspaces', 'refresh', 'quotas.tenant', 'quotas.tenantOverview', 'quotas.workspace', 'quotas.workspaceOverview', 'quotas.plan', 'quotas.put'],
  sources: ['src/pages/consoleQuotas.tsx', 'src/pages/consoleQuotas'], intendedDifferences,
  data: [{ name: 'quota tables', locator: '.console-quotas table' }], actions: [],
  states: [
    { fixture: 'quotas.tenant', variant: 'empty', locator: { es: 'h2:text-is("Sin dimensiones de cuota")', en: 'h2:text-is("No quota dimensions")' } },
    { fixture: 'quotas.tenant', variant: '403', locator: { es: 'h2:text-is("Acceso denegado para consultar cuotas.")', en: 'h2:text-is("Access denied to quotas.")' } },
    { fixture: 'quotas.tenant', variant: '404', locator: { es: 'h2:text-is("Cuotas no encontradas")', en: 'h2:text-is("Quotas not found")' } },
    { fixture: 'quotas.tenant', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar las cuotas")', en: 'h2:text-is("Could not load quotas")' } },
    { fixture: 'quotas.tenant', variant: 'network', locator: { es: 'h2:text-is("No se pudieron cargar las cuotas")', en: 'h2:text-is("Could not load quotas")' } },
  ],
}
export default manifest

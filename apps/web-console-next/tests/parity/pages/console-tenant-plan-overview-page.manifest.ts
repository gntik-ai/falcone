import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { PlanOverview } from '../../../src/pages/consoleTenantPlanOverview/api'

export const overviewPath = '/v1/tenant/plan/effective-entitlements'
export const overviewSearch = '?include=consumption'
export const overviewUrl = `${overviewPath}${overviewSearch}`

export const entitlementsMixed: PlanOverview = {
  tenantId: 'synthetic-tenant', planSlug: 'synthetic-pro', planStatus: 'active',
  quantitativeLimits: [
    { dimensionKey: 'max_workspaces', displayLabel: 'Synthetic Workspaces', unit: 'count', effectiveValue: 10, source: 'plan', currentUsage: 4, usageStatus: 'within_limit' },
    { dimensionKey: 'max_requests', displayLabel: 'Synthetic Requests', unit: 'requests', effectiveValue: -1, source: 'plan', currentUsage: 1234, usageStatus: 'within_limit' },
    { dimensionKey: 'max_functions', displayLabel: 'Synthetic Functions', unit: 'count', effectiveValue: 5, source: 'plan', currentUsage: 4, usageStatus: 'approaching_limit' },
    { dimensionKey: 'max_buckets', displayLabel: 'Synthetic Buckets', unit: 'count', effectiveValue: 8, source: 'plan', currentUsage: 8, usageStatus: 'at_limit' },
    { dimensionKey: 'max_databases', displayLabel: 'Synthetic Databases', unit: 'count', effectiveValue: 2, source: 'plan', currentUsage: 3, usageStatus: 'over_limit' },
    { dimensionKey: 'max_topics', displayLabel: 'Synthetic Topics', unit: 'count', effectiveValue: 6, source: 'plan', currentUsage: null, usageStatus: 'unknown' },
  ],
  capabilities: [
    { capabilityKey: 'realtime', displayLabel: 'Synthetic Realtime', enabled: true },
    { capabilityKey: 'sso', displayLabel: 'Synthetic SSO', enabled: false },
  ],
}
export const entitlementsNoLimits: PlanOverview = { ...entitlementsMixed, quantitativeLimits: [] }
export const entitlementsNoCapabilities: PlanOverview = { ...entitlementsMixed, capabilities: [] }

const ok = (body: unknown, delayMs?: number): EndpointResponse => ({ status: 200, body, ...(delayMs ? { delayMs } : {}) })
const error = (status: number): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error', ...(status === 500 ? { requestId: 'req_synthetic_plan_500' } : {}) } })

export const overviewEndpoints: Record<string, PageEndpoint> = {
  planOverview: { method: 'GET', path: overviewPath, fixtures: {
    success: ok(entitlementsMixed), 'my-plan-entitlements-mixed': ok(entitlementsMixed),
    'my-plan-entitlements-no-limits': ok(entitlementsNoLimits), 'my-plan-entitlements-no-capabilities': ok(entitlementsNoCapabilities),
    'my-plan-entitlements-loading-delayed': ok(entitlementsMixed, 1500),
    '401': [error(401), ok(entitlementsMixed)], 'my-plan-entitlements-401': [error(401), ok(entitlementsMixed)],
    'my-plan-entitlements-401-refresh-rejected': error(401),
    '403': error(403), '404': error(404), '500': error(500), network: { network: true },
    'my-plan-entitlements-403': error(403), 'my-plan-entitlements-404': error(404), 'my-plan-entitlements-500': error(500), 'my-plan-entitlements-network': { network: true },
  } },
}

const manifest: ParityManifest = {
  route: '/console/my-plan', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'],
  fixtures: ['tenant', 'tenants', 'workspaces', 'refresh', 'status', 'planOverview'], endpoints: overviewEndpoints,
  sources: ['src/pages/consoleTenantPlanOverview.tsx', 'src/pages/consoleTenantPlanOverview'],
  data: [{ name: 'limits table', locator: '.console-tenant-plan-overview table' }, { name: 'plan slug', locator: '.console-tenant-plan-overview :text-is("synthetic-pro")' }],
  actions: [],
  states: [
    { fixture: 'planOverview', variant: '403', locator: { es: '.console-tenant-plan-overview h2:text-is("No tienes acceso al plan de la organización")', en: '.console-tenant-plan-overview h2:text-is("You don\'t have access to the organization\'s plan")' } },
    { fixture: 'planOverview', variant: '404', locator: { es: '.console-tenant-plan-overview h2:text-is("Plan no encontrado")', en: '.console-tenant-plan-overview h2:text-is("Plan not found")' } },
    { fixture: 'planOverview', variant: '500', locator: '.console-tenant-plan-overview [data-testid="plan-overview-error"]' },
    { fixture: 'planOverview', variant: 'network', locator: '.console-tenant-plan-overview [data-testid="plan-overview-error"]' },
  ],
}
export default manifest

import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { EffectiveEntitlements } from '../../../src/pages/consoleTenantPlanOverview/api'

export const entitlementsPath = '/v1/tenant/plan/effective-entitlements'
export const entitlementsSearch = '?include=consumption'

export const entitlementsMixed: EffectiveEntitlements = {
  tenantId: 'synthetic-tenant', planSlug: 'synthetic-pro', planStatus: 'active',
  quantitativeLimits: [
    { dimensionKey: 'max_workspaces', displayLabel: 'Synthetic Workspaces', unit: 'count', effectiveValue: 10, source: 'plan', currentUsage: 4, usageStatus: 'within_limit' },
    { dimensionKey: 'max_requests', displayLabel: 'Synthetic Requests', unit: 'requests', effectiveValue: -1, source: 'plan', currentUsage: 1234, usageStatus: 'within_limit' },
    { dimensionKey: 'max_storage', displayLabel: 'Synthetic Storage', unit: 'count', effectiveValue: 10, source: 'plan', currentUsage: 9, usageStatus: 'approaching_limit' },
    { dimensionKey: 'max_functions', displayLabel: 'Synthetic Functions', unit: 'count', effectiveValue: 5, source: 'plan', currentUsage: 5, usageStatus: 'at_limit' },
    { dimensionKey: 'max_databases', displayLabel: 'Synthetic Databases', unit: 'count', effectiveValue: 2, source: 'plan', currentUsage: 3, usageStatus: 'over_limit' },
    { dimensionKey: 'max_buckets', displayLabel: 'Synthetic Buckets', unit: 'count', effectiveValue: 8, source: 'plan', currentUsage: null, usageStatus: 'unknown' },
  ],
  capabilities: [
    { capabilityKey: 'sso', displayLabel: 'Synthetic SSO', enabled: true },
    { capabilityKey: 'audit_export', displayLabel: 'Synthetic Audit export', enabled: false },
  ],
}
export const entitlementsNoLimits: EffectiveEntitlements = { ...entitlementsMixed, quantitativeLimits: [] }
export const entitlementsNoCapabilities: EffectiveEntitlements = { ...entitlementsMixed, capabilities: [] }

const ok = (body: unknown, delayMs?: number): EndpointResponse => ({ status: 200, body, ...(delayMs ? { delayMs } : {}) })
const error = (status: number): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error', ...(status === 500 ? { requestId: 'req_synthetic_my_plan_500' } : {}) } })

export const myPlanEndpoints: Record<string, PageEndpoint> = {
  myPlanEntitlements: { method: 'GET', path: entitlementsPath, fixtures: {
    success: ok(entitlementsMixed), 'my-plan-entitlements-mixed': ok(entitlementsMixed),
    'my-plan-entitlements-no-limits': ok(entitlementsNoLimits), 'my-plan-entitlements-no-capabilities': ok(entitlementsNoCapabilities),
    'my-plan-entitlements-loading-delayed': ok(entitlementsMixed, 1500),
    'my-plan-entitlements-401-refresh-ok': [error(401), ok(entitlementsMixed)], 'my-plan-entitlements-401-refresh-rejected': error(401),
    'my-plan-entitlements-403': error(403), 'my-plan-entitlements-404': error(404), 'my-plan-entitlements-500': error(500), 'my-plan-entitlements-network': { network: true },
    '401': [error(401), ok(entitlementsMixed)], '403': error(403), '404': error(404), '500': error(500), network: { network: true },
  } },
}

// The CSP session and the other pages' journeys reach this page with the one exact query only.
export function isMyPlanQuery(method: string, url: URL) {
  return method === 'GET' && url.pathname === entitlementsPath && url.search === entitlementsSearch
}

const manifest: ParityManifest = {
  route: '/console/my-plan', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'], endpoints: myPlanEndpoints,
  fixtures: ['tenants', 'tenant', 'workspaces', 'refresh', 'status', 'myPlanEntitlements'],
  sources: ['src/pages/consoleTenantPlanOverview.tsx', 'src/pages/consoleTenantPlanOverview'],
  data: [
    { name: 'page title', locator: { es: 'main h1:text-is("Mi plan")', en: 'main h1:text-is("My plan")' } },
    { name: 'plan slug', locator: '.my-plan :text-is("synthetic-pro")' },
    { name: 'limits table', locator: '.my-plan-limits table' },
  ],
  actions: [],
  states: [
    { fixture: 'myPlanEntitlements', variant: '403', locator: { es: '.my-plan h2:text-is("Sin acceso al resumen del plan")', en: '.my-plan h2:text-is("No access to the plan summary")' } },
    { fixture: 'myPlanEntitlements', variant: '404', locator: { es: '.my-plan h2:text-is("Resumen del plan no encontrado")', en: '.my-plan h2:text-is("Plan summary not found")' } },
    { fixture: 'myPlanEntitlements', variant: '500', locator: '.my-plan [data-testid="my-plan-error"]' },
    { fixture: 'myPlanEntitlements', variant: 'network', locator: '.my-plan [data-testid="my-plan-error"]' },
  ],
}
export default manifest

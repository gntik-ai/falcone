import type { PageEndpoint, ParityManifest } from '../manifest'
import type { EffectiveEntitlements } from '../../../src/pages/consoleTenantPlanOverview/api'

export const myPlanPath = '/v1/tenant/plan/effective-entitlements'
export const myPlanUrl = `${myPlanPath}?include=consumption`
export const myPlanMixed: EffectiveEntitlements = {
  tenantId: 'synthetic-tenant', planSlug: 'synthetic-growth', planStatus: 'active',
  quantitativeLimits: [
    { dimensionKey: 'synthetic-databases', displayLabel: 'Synthetic databases', effectiveValue: 5, currentUsage: 2, usageStatus: 'within_limit' },
    { dimensionKey: 'synthetic-storage', displayLabel: 'Synthetic storage', effectiveValue: 100, currentUsage: 85, usageStatus: 'approaching_limit' },
    { dimensionKey: 'synthetic-functions', displayLabel: 'Synthetic functions', effectiveValue: 10, currentUsage: 10, usageStatus: 'at_limit' },
    { dimensionKey: 'synthetic-requests', displayLabel: 'Synthetic requests', effectiveValue: 10, currentUsage: 25, usageStatus: 'over_limit' },
    { dimensionKey: 'synthetic-events', displayLabel: 'Synthetic events', effectiveValue: -1, currentUsage: 42, usageStatus: 'within_limit' },
    { dimensionKey: 'synthetic-unknown', displayLabel: 'Synthetic unknown', effectiveValue: 50, currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'synthetic-unavailable' },
    { dimensionKey: 'synthetic-missing', usageStatus: 'unknown' },
  ],
  capabilities: [
    { capabilityKey: 'synthetic-realtime', displayLabel: 'Synthetic realtime', enabled: true },
    { capabilityKey: 'synthetic-backups', displayLabel: 'Synthetic backups', enabled: false },
  ],
}
const ok = { status: 200, body: myPlanMixed }
const error = (status: number) => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error', ...(status === 500 ? { requestId: 'req_synthetic_my_plan_500' } : {}) } })
export const myPlanEndpoints: Record<string, PageEndpoint> = {
  myPlanEntitlements: { method: 'GET', path: myPlanPath, fixtures: {
    success: ok, 'my-plan-entitlements-mixed': ok,
    empty: { status: 200, body: { ...myPlanMixed, quantitativeLimits: [] } },
    'my-plan-entitlements-no-limits': { status: 200, body: { ...myPlanMixed, quantitativeLimits: [] } },
    'my-plan-entitlements-no-capabilities': { status: 200, body: { ...myPlanMixed, capabilities: [] } },
    'my-plan-entitlements-loading-delayed': { ...ok, delayMs: 1500 },
    '401': error(401), 'my-plan-entitlements-401': error(401),
    'my-plan-entitlements-401-refresh-ok': [error(401), ok],
    '403': error(403), 'my-plan-entitlements-403': error(403),
    '404': error(404), 'my-plan-entitlements-404': error(404),
    '500': error(500), 'my-plan-entitlements-500': error(500),
    network: { network: true }, 'my-plan-entitlements-network': { network: true },
  } },
}
const manifest: ParityManifest = {
  route: '/console/my-plan', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'],
  fixtures: ['tenant', 'tenants', 'workspaces', 'refresh', 'status', 'myPlanEntitlements'], endpoints: myPlanEndpoints,
  sources: ['src/pages/consoleTenantPlanOverview.tsx', 'src/pages/consoleTenantPlanOverview'],
  data: [{ name: 'quota table', locator: '.plan-overview table' }, { name: 'current plan', locator: '.plan-overview :text-is("synthetic-growth")' }],
  actions: [], states: [
    { fixture: 'myPlanEntitlements', variant: 'empty', locator: { es: '.plan-overview h3:text-is("Sin cuotas")', en: '.plan-overview h3:text-is("No quotas")' } },
    { fixture: 'myPlanEntitlements', variant: '403', locator: { es: '.plan-overview h2:text-is("No tienes acceso al plan de la organización")', en: '.plan-overview h2:text-is("You don\'t have access to the organization\'s plan")' } },
    { fixture: 'myPlanEntitlements', variant: '404', locator: { es: '.plan-overview h2:text-is("Plan no encontrado")', en: '.plan-overview h2:text-is("Plan not found")' } },
    { fixture: 'myPlanEntitlements', variant: '500', locator: '.plan-overview [data-testid="plan-overview-error"]' },
    { fixture: 'myPlanEntitlements', variant: 'network', locator: '.plan-overview [data-testid="plan-overview-error"]' },
  ],
}
export default manifest

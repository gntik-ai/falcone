import type { PageEndpoint, ParityManifest } from '../manifest'
export const tenantBody = { name: 'Synthetic Organization', planId: 'p1', region: 'eu-west', preferences: { locale: 'es' } }
export const tenantRows = [
  { tenantId: 't1', displayName: 'Alpha', slug: 'alpha', state: 'active' },
  { tenantId: 't2', displayName: 'Beta', slug: 'beta', state: 'suspended' },
  { tenantId: 't3', displayName: 'Gamma', slug: 'gamma', state: 'active' },
]
export const activePlans = { items: [{ id: 'p1', slug: 'starter', displayName: 'Starter' }] }
const success = { status: 201, body: { tenantId: 'created' } }
const failure = (status: number) => ({ status, body: { status, code: `HTTP_${status}`, requestId: 'req_synthetic', message: 'PRIVATE_MARKER' } })
const errors = Object.fromEntries([401, 403, 404, 409, 422, 500].map((status) => [String(status), failure(status)]))
export const tenantMetricsEndpoints: Record<string, PageEndpoint> = {
  'tenants.quotas': { method: 'GET', path: '/v1/metrics/tenants/platform/quotas', fixtures: { success: { status: 200, body: { tenantId: 'platform', items: [] } }, ...errors } },
  'tenants.overview': { method: 'GET', path: '/v1/metrics/tenants/platform/overview', fixtures: { success: { status: 200, body: { tenantId: 'platform', dimensions: [] } }, ...errors } },
}
export const tenantEndpoints: Record<string, PageEndpoint> = {
  ...tenantMetricsEndpoints,
  'tenants.plans': { method: 'GET', path: '/v1/plans', fixtures: { success: { status: 200, body: activePlans }, empty: { status: 200, body: { items: [] } }, ...errors } },
  'tenants.create': { method: 'POST', path: '/v1/tenants', fixtures: { success, ...errors, '500-then-success': [failure(500), success], delayed: { ...success, delayMs: 1500 }, '500-then-delayed-success': [failure(500), { ...success, delayMs: 1500 }], 'network-then-success': [{ network: true }, success], '401-then-success': [failure(401), success] } },
}
const manifest: ParityManifest = {
  route: '/console/tenants', roles: ['superadmin', 'tenant_owner'], endpoints: tenantEndpoints,
  fixtures: ['shell:superadmin', 'shell:tenant_owner', 'shell-tenants-three', 'shell-tenants-truncated', 'shell-tenants-empty', 'shell-tenants-loading-delayed', ...Object.entries(tenantEndpoints).flatMap(([name, endpoint]) => Object.keys(endpoint.fixtures).map((variant) => `${name}:${variant}`))],
  sources: ['src/pages/consoleTenants.tsx', 'src/pages/consoleTenants'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Gestión de organizaciones")', en: 'h1:text-is("Organization management")' } }],
  actions: [], states: [
    { fixture: 'tenants.plans', variant: '403', locator: { es: 'h2:text-is("Sin acceso al catálogo de planes")', en: 'h2:text-is("No plan catalog access")' } },
    { fixture: 'tenants.plans', variant: '404', locator: { es: 'h2:text-is("Catálogo de planes no encontrado")', en: 'h2:text-is("Plan catalog not found")' } },
    { fixture: 'tenants.create', variant: '500', locator: { es: 'h2:text-is("No se pudo crear la organización")', en: 'h2:text-is("Could not create the organization")' } },
  ],
}
export default manifest

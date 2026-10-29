import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { PlanPage, PlanRecord } from '../../../src/pages/consolePlanCatalog/api'

export const plansPath = '/v1/plans'
export const catalogPlans: PlanRecord[] = Array.from({ length: 45 }, (_, index) => ({
  id: `synthetic-plan-${index + 1}`, slug: `synthetic-plan-${index + 1}`, displayName: `Synthetic Plan ${index + 1}`,
  status: (['draft', 'active', 'deprecated', 'archived'] as const)[index % 4], capabilities: {}, quotaDimensions: {},
  ...(index % 3 ? { assignedTenantCount: index, updatedAt: '2026-06-01T12:00:00Z' } : {}),
}))
// This is deliberately narrower than the registry's pathname-only lookup.
export function isPlansQuery(method: string, url: URL) {
  return method === 'GET' && url.pathname === plansPath && url.searchParams.has('page') && url.searchParams.has('pageSize') &&
    [...url.searchParams.keys()].every((key) => ['page', 'pageSize', 'status'].includes(key))
}
export function catalogResponse(variant: string, url = new URL('http://localhost/v1/plans?page=1&pageSize=20'), attempt = 0): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (['401', '403', '404', '500'].includes(variant) || variant === '500-then-success' && attempt === 0) {
    const status = variant === '500-then-success' ? 500 : Number(variant)
    return { status, body: { code: `HTTP_${status}`, message: 'synthetic-error', ...(status === 500 ? { requestId: 'req_synthetic_catalog_500' } : {}) } }
  }
  const page = Number(url.searchParams.get('page') ?? 1), pageSize = Number(url.searchParams.get('pageSize') ?? 20)
  let items = variant === 'empty' || variant === 'archived-empty' ? [] : variant === 'single' ? catalogPlans.slice(0, 1) : catalogPlans
  const status = url.searchParams.get('status')
  if (variant === 'active-only') items = items.filter((plan) => plan.status === 'active')
  if (status && status !== 'all') items = items.filter((plan) => plan.status === status)
  const body: PlanPage = { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
  return { status: 200, body, ...(variant === 'loading' ? { delayMs: 1500 } : {}) }
}
export const catalogVariants = ['45-mixed', 'active-only', 'archived-empty', 'empty', 'single', '401', '403', '404', '500', '500-then-success', 'network', 'loading']
export const catalogEndpoints: Record<string, PageEndpoint> = {
  'plans.list': { method: 'GET', path: plansPath, fixtures: Object.fromEntries(['success', ...catalogVariants].map((variant) => [variant,
    variant === '500-then-success' ? [catalogResponse(variant), catalogResponse(variant, undefined, 1)] : catalogResponse(variant),
  ])) },
}
const manifest: ParityManifest = {
  route: '/console/plans', roles: ['superadmin'], endpoints: catalogEndpoints,
  fixtures: ['shell:superadmin', 'shell:plain-member', ...catalogVariants.map((variant) => `plans.list:${variant}`)],
  sources: ['src/pages/consolePlanCatalog.tsx', 'src/pages/consolePlanCatalog'],
  data: [{ name: 'catalog title', locator: { es: 'h1:text-is("Catálogo de planes")', en: 'h1:text-is("Plan catalog")' } }],
  actions: [],
  states: [
    { fixture: 'plans.list', variant: 'empty', locator: { es: 'h2:text-is("No se encontraron planes")', en: 'h2:text-is("No plans found")' } },
    { fixture: 'plans.list', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para consultar planes")', en: 'h2:text-is("You do not have permission to view plans")' } },
    { fixture: 'plans.list', variant: '404', locator: { es: 'h2:text-is("Catálogo de planes no encontrado")', en: 'h2:text-is("Plan catalog not found")' } },
    { fixture: 'plans.list', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar los planes")', en: 'h2:text-is("Could not load plans")' } },
  ],
}
export default manifest

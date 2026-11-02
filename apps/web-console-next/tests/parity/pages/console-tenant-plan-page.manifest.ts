import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { ActivePlan, EffectiveEntitlements, HistoryPage, PlanChangeHistoryEntry, TenantPlanAssignment } from '../../../src/pages/consoleTenantPlan/api'

export const tenantId = 'ten_alpha'
// The CSP harness opens every route with its parameter named sample-<param>.
export const cspTenantId = 'sample-tenantId'
export const plansActivePath = '/v1/plans'
export const planPath = (id = tenantId) => `/v1/tenants/${id}/plan`
export const entitlementsPath = (id = tenantId) => `${planPath(id)}/effective-entitlements`
export const historyPath = (id = tenantId) => `${planPath(id)}/history-impact`
export const entitlementsSearch = '?include=consumption'
export const historySearch = (page = 1) => `?page=${page}&pageSize=20`
export const plansSearch = '?status=active&page=1&pageSize=20'

export const proPlan: TenantPlanAssignment = { assignment: { planId: 'plan-pro' }, plan: { displayName: 'Synthetic Pro', status: 'active' } }
export const freePlan: TenantPlanAssignment = { assignment: { planId: 'plan-free' }, plan: { displayName: 'Synthetic Free', status: 'active' } }
export const unassignedPlan: TenantPlanAssignment = { assignment: null, plan: null }
export const entitlementsMixed: EffectiveEntitlements = {
  tenantId, planSlug: 'synthetic-pro', planStatus: 'active',
  quantitativeLimits: [
    { dimensionKey: 'max_workspaces', displayLabel: 'Synthetic Workspaces', unit: 'count', effectiveValue: 10, source: 'plan', currentUsage: 4, usageStatus: 'within_limit' },
    { dimensionKey: 'max_requests', displayLabel: 'Synthetic Requests', unit: 'requests', effectiveValue: -1, source: 'plan', currentUsage: 1234, usageStatus: 'within_limit' },
    { dimensionKey: 'max_functions', displayLabel: 'Synthetic Functions', unit: 'count', effectiveValue: 5, source: 'plan', currentUsage: 5, usageStatus: 'at_limit' },
    { dimensionKey: 'max_databases', displayLabel: 'Synthetic Databases', unit: 'count', effectiveValue: 2, source: 'plan', currentUsage: 3, usageStatus: 'over_limit' },
    { dimensionKey: 'max_buckets', displayLabel: 'Synthetic Buckets', unit: 'count', effectiveValue: 8, source: 'plan', currentUsage: null, usageStatus: 'unknown' },
  ],
}
export const entitlementsNoLimits: EffectiveEntitlements = { tenantId, quantitativeLimits: [] }
export const activePlans: ActivePlan[] = [
  { id: 'plan-free', displayName: 'Synthetic Free', status: 'active' },
  { id: 'plan-pro', displayName: 'Synthetic Pro', status: 'active' },
  { id: 'plan-team', displayName: 'Synthetic Team', status: 'active' },
  { id: 'plan-draft', displayName: 'Synthetic Draft', status: 'draft' },
]
export const activePlansWithoutTeam = activePlans.filter((plan) => plan.id !== 'plan-team')
export const assignedBody = { planId: 'plan-team', assignedBy: 'console' }

const directions = ['initial_assignment', 'upgrade', 'downgrade', 'lateral', 'equivalent'] as const
export const historyEntries: PlanChangeHistoryEntry[] = Array.from({ length: 45 }, (_, index) => ({
  historyEntryId: `hist-${index + 1}`, tenantId, previousPlanId: index === 0 ? null : 'plan-free', newPlanId: index % 2 ? 'plan-pro' : 'plan-team',
  actorId: `synthetic-admin-${index + 1}`, effectiveAt: new Date(Date.UTC(2026, 4, 31, 12, 0, 0) - index * 3_600_000).toISOString(),
  correlationId: `corr-${index + 1}`, changeReason: index === 0 ? 'Synthetic reason' : null, changeDirection: directions[index % directions.length],
  usageCollectionStatus: (['complete', 'partial', 'unavailable'] as const)[index % 3], overLimitDimensionCount: index % 4,
  quotaImpacts: [{ dimensionKey: 'max_workspaces', displayLabel: 'Synthetic Workspaces', previousEffectiveValueKind: 'bounded', previousEffectiveValue: 3, newEffectiveValueKind: 'bounded', newEffectiveValue: 10, comparison: 'increased', observedUsage: 4, usageStatus: 'within_limit' },
    { dimensionKey: 'max_requests', displayLabel: 'Synthetic Requests', previousEffectiveValueKind: 'bounded', previousEffectiveValue: 100, newEffectiveValueKind: 'unlimited', comparison: 'increased', observedUsage: null, usageStatus: 'unknown' }],
  capabilityImpacts: [{ capabilityKey: 'sso', displayLabel: 'Synthetic SSO', previousState: false, newState: true, comparison: 'enabled' }],
}))
export const historyTotal = historyEntries.length

const error = (status: number, requestId?: string): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error', ...(requestId ? { requestId } : {}) } })
const errors = (prefix: string) => ({
  '401': error(401), '403': error(403), '404': error(404), '500': error(500, `req_synthetic_${prefix}_500`), network: { network: true } as EndpointResponse,
})
const ok = (body: unknown, delayMs?: number): EndpointResponse => ({ status: 200, body, ...(delayMs ? { delayMs } : {}) })

// History is server-paginated, so the page-local route reads the query instead of the registry.
export function historyResponse(variant: string, url = new URL(`http://localhost${historyPath()}${historySearch()}`), attempt = 0): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (['401', '403', '404', '500'].includes(variant) || variant === '500-then-success' && attempt === 0) {
    const status = variant === '500-then-success' ? 500 : Number(variant)
    return error(status, status === 500 ? 'req_synthetic_history_500' : undefined)
  }
  const page = Number(url.searchParams.get('page') ?? 1), pageSize = Number(url.searchParams.get('pageSize') ?? 20)
  const items = variant === 'empty' ? [] : historyEntries
  const body: HistoryPage = { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
  return ok(body, variant === 'page2-delayed' && page === 2 ? 1500 : undefined)
}
export function plansResponse(variant: string, attempt = 0): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (['401', '403', '404', '500'].includes(variant) || variant === '500-then-success' && attempt === 0) {
    const status = variant === '500-then-success' ? 500 : Number(variant)
    return error(status, status === 500 ? 'req_synthetic_plans_500' : undefined)
  }
  const items = variant === 'empty' ? [] : variant === 'without-selected-plan' ? activePlansWithoutTeam : activePlans
  return ok({ items, total: items.length, page: 1, pageSize: 20 }, variant === 'loading' ? 1500 : undefined)
}

export function buildTenantPlanEndpoints(id = tenantId): Record<string, PageEndpoint> {
  return {
    tenantPlan: { method: 'GET', path: planPath(id), fixtures: {
      success: ok(proPlan), 'tenant-plan-assigned': ok(proPlan), 'tenant-plan-unassigned': ok(unassignedPlan), 'tenant-plan-loading-delayed': ok(proPlan, 1500),
      'tenant-plan-after-network-already-assigned': [ok(freePlan), ok({ assignment: { planId: 'plan-team' }, plan: { displayName: 'Synthetic Team', status: 'active' } })],
      'tenant-plan-reassigned': [ok(proPlan), ok({ assignment: { planId: 'plan-team' }, plan: { displayName: 'Synthetic Team', status: 'active' } })],
      ...errors('plan'),
    } },
    tenantEntitlements: { method: 'GET', path: entitlementsPath(id), fixtures: {
      success: ok(entitlementsMixed), 'tenant-entitlements-mixed': ok(entitlementsMixed), 'tenant-entitlements-no-limits': ok(entitlementsNoLimits),
      'tenant-plan-loading-delayed': ok(entitlementsMixed, 1500), ...errors('entitlements'),
    } },
    // Only page 1 is registered here; paging fixtures live in historyResponse.
    tenantHistory: { method: 'GET', path: historyPath(id), fixtures: { success: historyResponse('success'), empty: historyResponse('empty'), ...errors('history') } },
    tenantPlanAssign: { method: 'POST', path: planPath(id), fixtures: {
      success: ok({ assignmentId: 'assign-1' }), 'tenant-plan-assign-200': ok({ assignmentId: 'assign-1' }), 'tenant-plan-assign-delayed': ok({ assignmentId: 'assign-1' }, 1500),
      'tenant-plan-assign-retry-200': [error(500, 'req_synthetic_assign_500'), ok({ assignmentId: 'assign-1' })],
      'tenant-plan-assign-401-refresh-ok': [error(401), ok({ assignmentId: 'assign-1' })],
      ...errors('assign'),
    } },
  }
}
export const tenantPlanEndpoints = buildTenantPlanEndpoints()
// The CSP session opens exactly these two queried reads; every other query stays unmatched.
const cspQueries = new Set([`${entitlementsPath(cspTenantId)}${entitlementsSearch}`, `${historyPath(cspTenantId)}${historySearch()}`])
export function isTenantPlanQuery(method: string, url: URL) {
  return method === 'GET' && cspQueries.has(url.pathname + url.search)
}

const manifest: ParityManifest = {
  route: `/console/tenants/${tenantId}/plan`, roles: ['superadmin'], endpoints: { ...tenantPlanEndpoints, plansActive: { method: 'GET', path: plansActivePath, fixtures: { success: plansResponse('active'), empty: plansResponse('empty') } } },
  fixtures: ['shell:superadmin', 'shell:tenant-owner', ...Object.keys(tenantPlanEndpoints).map((name) => `${name}:success`)],
  sources: ['src/pages/consoleTenantPlan.tsx', 'src/pages/consoleTenantPlan'],
  data: [{ name: 'page title', locator: { es: 'h1:text-is("Plan de la organización")', en: 'h1:text-is("Organization plan")' } }],
  actions: [],
  states: [
    { fixture: 'tenantPlan', variant: '403', locator: { es: 'h2:text-is("Sin acceso al plan de la organización")', en: 'h2:text-is("No access to the organization plan")' } },
    { fixture: 'tenantPlan', variant: '404', locator: { es: 'h2:text-is("Organización no encontrada")', en: 'h2:text-is("Organization not found")' } },
    { fixture: 'tenantPlan', variant: '500', locator: { es: 'h2:text-is("Plan de la organización no disponible")', en: 'h2:text-is("Organization plan unavailable")' } },
  ],
}
export default manifest

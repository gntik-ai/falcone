import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { LimitRow, PlanRecord, PlanStatus } from '../../../src/pages/consolePlanDetail/api'

export const planId = 'synthetic-plan'
export const planName = 'Synthetic Plan'
export const limitKey = 'max_workspaces'
export const planPath = (id = planId) => `/v1/plans/${id}`
const failure = (status: number, extra: Record<string, unknown> = {}): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'PRIVATE_MARKER', detail: 'PRIVATE_MARKER', ...extra } })
const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
const record = (id: string, status: PlanStatus, extra: Partial<PlanRecord> = {}): PlanRecord => ({
  id, slug: id, displayName: planName, description: 'Synthetic description', status, capabilities: { sso: true, audit_export: false },
  quotaDimensions: {}, assignedTenantCount: 0, updatedAt: '2026-05-30T10:00:00Z', ...extra,
})
export const limitRows: LimitRow[] = [
  { dimensionKey: limitKey, displayLabel: 'Workspaces', unit: 'count', effectiveValue: 5, source: 'explicit' },
  { dimensionKey: 'max_storage_gb', displayLabel: 'Storage', unit: 'GB', effectiveValue: 10, source: 'default' },
  { dimensionKey: 'max_functions', displayLabel: 'Functions', unit: 'count', effectiveValue: -1, source: 'unlimited' },
  { dimensionKey: 'max_members', displayLabel: 'Members', unit: 'count', effectiveValue: 25, source: 'default' },
  { dimensionKey: 'max_api_keys', displayLabel: 'API keys', unit: 'count', effectiveValue: 0, source: 'explicit' },
  { dimensionKey: 'max_events', displayLabel: 'Events', unit: 'events/day', effectiveValue: 1000, source: 'default' },
]
const failures = { '401': { status: 401, body: { code: 'UNAUTHORIZED' } }, '403': failure(403, { code: 'FORBIDDEN' }), '404': failure(404, { code: 'NOT_FOUND' }), '500': failure(500, { requestId: 'req_synthetic_plan_500' }) }

export function planDetailFixtures(id: string) {
  const detail: Record<string, EndpointResponse | EndpointResponse[]> = {
    success: ok(record(id, 'draft')),
    draft: ok(record(id, 'draft')),
    'active-3-tenants': ok(record(id, 'active', { assignedTenantCount: 3 })),
    deprecated: ok(record(id, 'deprecated')),
    archived: ok(record(id, 'archived')),
    'no-description-no-capabilities': ok(record(id, 'draft', { description: null, capabilities: {}, assignedTenantCount: undefined, updatedAt: undefined })),
    ...failures,
    network: { network: true },
    '500-then-success': [failures['500'], ok(record(id, 'draft'))],
  }
  const limits: Record<string, EndpointResponse | EndpointResponse[]> = {
    success: ok({ planId: id, profile: limitRows }),
    'profile-6': ok({ planId: id, profile: limitRows }),
    empty: ok({ planId: id, profile: [] }),
    ...failures,
    network: { network: true },
    '500-then-success': [failures['500'], ok({ planId: id, profile: limitRows })],
  }
  const lifecycle: Record<string, EndpointResponse | EndpointResponse[] | ((role: unknown, body?: unknown) => EndpointResponse)> = {
    success: (_role: unknown, body?: unknown) => ok({ planId: id, previousStatus: 'draft', newStatus: (body as { targetStatus?: string } | undefined)?.targetStatus ?? 'active', transitionedAt: '2026-06-01T12:00:00Z' }),
    '500': failures['500'],
    '403': failures['403'],
    network: { network: true },
    '500-unknown-code': failure(500, { code: 'PLAN_SYNTHETIC_FAILURE', requestId: 'req_synthetic_plan_500' }),
    '409-invalid-transition': failure(409, { code: 'INVALID_TRANSITION' }),
  }
  lifecycle['500-then-success'] = [failures['500'], lifecycle.success as never]
  const remove: Record<string, EndpointResponse | EndpointResponse[]> = {
    success: ok({ planId: id, deleted: true }),
    '403': failures['403'], '404': failures['404'], '500': failures['500'],
    network: { network: true },
    '409-assignment-history': failure(409, { code: 'PLAN_HAS_ASSIGNMENT_HISTORY' }),
    'network-then-success': [{ network: true }, ok({ planId: id, deleted: true })],
  }
  const set: Record<string, EndpointResponse | EndpointResponse[]> = {
    success: ok({ planId: id, dimensionKey: limitKey, previousValue: 5, newValue: 500, source: 'explicit' }),
    '400-invalid-limit': failure(400, { code: 'INVALID_LIMIT_VALUE' }),
    '409-frozen': failure(409, { code: 'PLAN_LIMITS_FROZEN' }),
    '403': failures['403'], '500': failures['500'],
    '500-then-success': [failures['500'], ok({ planId: id, dimensionKey: limitKey, previousValue: 5, newValue: 500, source: 'explicit' })],
  }
  const removal: Record<string, EndpointResponse | EndpointResponse[]> = {
    success: ok({ planId: id, dimensionKey: limitKey, removedValue: 5, effectiveValue: 10, source: 'default' }),
    '500': failures['500'],
    network: { network: true },
    'network-then-success': [{ network: true }, ok({ planId: id, dimensionKey: limitKey, removedValue: 5, effectiveValue: 10, source: 'default' })],
  }
  return { detail, limits, lifecycle, remove, set, removal }
}

// The harness registry matches exact paths, so every endpoint is keyed to one plan id and one dimension.
export function buildPlanDetailEndpoints(id = planId): Record<string, PageEndpoint> {
  const fixtures = planDetailFixtures(id)
  return {
    'plans.detail': { method: 'GET', path: planPath(id), fixtures: fixtures.detail },
    'plans.limits': { method: 'GET', path: `${planPath(id)}/limits`, fixtures: fixtures.limits },
    'plans.lifecycle': { method: 'POST', path: `${planPath(id)}/lifecycle`, fixtures: fixtures.lifecycle },
    'plans.delete': { method: 'DELETE', path: planPath(id), fixtures: fixtures.remove },
    'plans.limits.set': { method: 'PUT', path: `${planPath(id)}/limits/${limitKey}`, fixtures: fixtures.set },
    'plans.limits.remove': { method: 'DELETE', path: `${planPath(id)}/limits/${limitKey}`, fixtures: fixtures.removal },
  }
}
// Only the two reads that mounting this page adds to other journeys (create redirect, CSP route enumeration).
export function buildPlanDetailReads(id: string): Record<string, PageEndpoint> {
  const { 'plans.detail': detail, 'plans.limits': limits } = buildPlanDetailEndpoints(id)
  return { 'plans.detail': detail, 'plans.limits': limits }
}
export const planEndpoints = buildPlanDetailEndpoints()

const variants = (name: string) => Object.keys(planEndpoints[name].fixtures).map((variant) => `${name}:${variant}`)
const manifest: ParityManifest = {
  route: `/console/plans/${planId}`, roles: ['superadmin'], endpoints: planEndpoints,
  fixtures: ['shell:superadmin', 'shell:plain-member', ...Object.keys(planEndpoints).flatMap(variants)],
  sources: ['src/pages/consolePlanDetail.tsx', 'src/pages/consolePlanDetail'],
  data: [{ name: 'plan name', locator: { es: `h1:text-is("${planName}")`, en: `h1:text-is("${planName}")` } }],
  actions: [],
  states: [
    { fixture: 'plans.detail', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para consultar este plan")', en: 'h2:text-is("You do not have permission to view this plan")' } },
    { fixture: 'plans.detail', variant: '404', locator: { es: 'h2:text-is("Plan no encontrado")', en: 'h2:text-is("Plan not found")' } },
    { fixture: 'plans.detail', variant: '500', locator: { es: 'h2:text-is("No se pudo cargar el plan")', en: 'h2:text-is("The plan could not be loaded")' } },
    { fixture: 'plans.limits', variant: '500', locator: { es: 'h2:text-is("No se pudo cargar el plan")', en: 'h2:text-is("The plan could not be loaded")' } },
  ],
}
export default manifest

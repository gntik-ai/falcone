import type { PageEndpoint, ParityManifest } from '../manifest'

export const planPath = '/v1/plans'
export const planBody = { slug: 'starter-2026', displayName: 'Starter', description: '  Optional text  ', capabilities: {}, quotaDimensions: {} }
export const planFailure = { status: 500, body: { code: 'HTTP_500', message: 'PRIVATE_MARKER', detail: 'PRIVATE_MARKER', requestId: 'req_synthetic' } }
const success = { status: 200, body: { id: 'p1' } }
export const planFixtures = {
  success,
  '500': planFailure,
  '500-then-success': [planFailure, success],
  'network-then-success': [{ network: true }, success],
  network: { network: true },
  '401-then-success': [{ status: 401, body: { code: 'UNAUTHORIZED' } }, success],
  '401': { status: 401, body: { code: 'UNAUTHORIZED' } },
  '403': { status: 403, body: { code: 'FORBIDDEN', message: 'PRIVATE_MARKER' } },
  '404': { status: 404, body: { code: 'NOT_FOUND', message: 'PRIVATE_MARKER' } },
  '409': { status: 409, body: { code: 'PLAN_SLUG_CONFLICT', message: 'PRIVATE_MARKER' } },
  '400': { status: 400, body: { code: 'INVALID_REQUEST', message: 'PRIVATE_MARKER' } },
  correlation: { status: 500, body: { code: 'HTTP_500', correlationId: 'corr_synthetic', message: 'PRIVATE_MARKER', detail: 'PRIVATE_MARKER' } },
  slow: { ...success, delayMs: 1500 },
}
export const planEndpoints: Record<string, PageEndpoint> = {
  'plans.create': { method: 'POST', path: planPath, fixtures: planFixtures },
}
const manifest: ParityManifest = {
  route: '/console/plans/new', roles: ['superadmin'], endpoints: planEndpoints, fixtures: ['shell:superadmin', 'shell:superadmin-delayed', 'shell:plain-member', ...Object.keys(planFixtures).map((variant) => `plans.create:${variant}`)],
  sources: ['src/pages/consolePlanCreate.tsx', 'src/pages/consolePlanCreate'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Crear plan")', en: 'h1:text-is("Create plan")' } }],
  actions: [],
  states: [
    { fixture: 'plans.create', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para crear planes")', en: 'h2:text-is("You do not have permission to create plans")' } },
    { fixture: 'plans.create', variant: '404', locator: { es: 'h2:text-is("Servicio de planes no disponible")', en: 'h2:text-is("Plan service unavailable")' } },
    { fixture: 'plans.create', variant: '500', locator: { es: 'h2:text-is("No se pudo crear el plan")', en: 'h2:text-is("Could not create the plan")' } },
  ],
}
export default manifest

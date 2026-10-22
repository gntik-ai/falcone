import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'

export const runtimePath = '/v1/platform/runtime/knative'
export const ready = { mode: 'managed', owner: 'platform', stage: 'ready', compatibility: 'compatible', version: '1.15', state: 'ready', reason: 'READY', lastTransitionAt: '2026-08-07T10:00:00Z' }
const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
export const failure = { status: 500, body: { code: 'HTTP_500', message: 'Never render this internal message', requestId: 'synthetic-runtime-request' } }
export const runtimeFixtures = {
  'knative-ready': ok(ready),
  'knative-degraded': ok({ ...ready, state: 'degraded', reason: 'WEBHOOK_NOT_READY' }),
  'knative-unverified': ok({ ...ready, state: 'unverified' }),
  'knative-unavailable-external': ok({ ...ready, state: 'unavailable', mode: 'external' }),
  'knative-disabled': ok({ ...ready, state: 'disabled', mode: 'disabled' }),
  'knative-unknown-values': ok({ ...ready, state: 'rebuilding', mode: 'hybrid', owner: '', version: null }),
  'knative-no-transition': ok({ ...ready, lastTransitionAt: null }),
  'knative-delayed': { ...ok(ready), delayMs: 1500 },
  'knative-403': { status: 403, body: { code: 'FORBIDDEN', message: 'Never render this internal message' } },
  'knative-404': { status: 404, body: { code: 'NOT_FOUND', message: 'Never render this internal message' } },
  'knative-500': failure,
  'knative-500-then-ready': [failure, ok(ready)],
  'knative-network': { network: true },
  'knative-401': { status: 401, body: { code: 'UNAUTHORIZED' } },
  'knative-401-refresh-ok': [{ status: 401, body: { code: 'UNAUTHORIZED' } }, ok(ready)],
  'knative-401-after-refresh': { status: 401, body: { code: 'UNAUTHORIZED' } },
}
export const runtimeEndpoints: Record<string, PageEndpoint> = {
  runtime: { method: 'GET', path: runtimePath, fixtures: { success: ok(ready), empty: runtimeFixtures['knative-no-transition'], ...runtimeFixtures } },
}
const manifest: ParityManifest = {
  route: '/console/runtime', roles: ['superadmin'], endpoints: runtimeEndpoints, fixtures: ['runtime'],
  sources: ['src/pages/consoleRuntime.tsx', 'src/pages/consoleRuntime'],
  data: [
    { name: 'title', locator: { es: 'h1:has-text("Runtime de funciones")', en: 'h1:has-text("Functions runtime")' } },
    { name: 'owner', locator: 'dd:text-is("platform")' },
    { name: 'version', locator: 'dd:text-is("1.15")' },
  ],
  actions: [{ name: 'recheck', trigger: [{ es: 'button:text-is("Volver a comprobar")', en: 'button:text-is("Check again")' }], expected: { method: 'GET', path: runtimePath }, outcome: 'dd:text-is("platform")' }],
  states: [
    { fixture: 'runtime', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para consultar el runtime.")', en: 'h2:text-is("You do not have permission to inspect the runtime.")' } },
    { fixture: 'runtime', variant: '404', locator: { es: 'h2:text-is("Runtime no encontrado")', en: 'h2:text-is("Runtime not found")' } },
    ...(['500', 'network'] as const).map((variant) => ({ fixture: 'runtime', variant, locator: { es: 'h2:text-is("No se pudo consultar el runtime")', en: 'h2:text-is("Could not check the runtime")' } })),
  ],
}
export default manifest

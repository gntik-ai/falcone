import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
export const realtimePath = '/v1/workspaces/ws-1/realtime'
export const capabilitiesPath = '/v1/tenant/effective-capabilities'
export const ready = { workspaceId: 'ws-1', realtimeEndpointUrl: 'wss://synthetic-realtime.example.test', features: { realtime: true }, dataSources: [{ type: 'postgresql' }, { type: 'mongodb' }] }
const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
export const capabilityFixtures = {
  success: ok({ capabilities: { realtime: true } }),
  'capability-delayed': { ...ok({ capabilities: { realtime: true } }), delayMs: 1500 },
  'capability-disabled': ok({ capabilities: { realtime: false } }),
  'capability-delayed-disabled': { ...ok({ capabilities: { realtime: false } }), delayMs: 1500 },
  'capability-error': { status: 500, body: { code: 'HTTP_500' } },
}
const failure = { status: 500, body: { code: 'HTTP_500', requestId: 'synthetic-realtime-request' } }
export const realtimeFixtures = {
  'workspace-realtime': ok(ready),
  'workspace-realtime-dup-unsupported': ok({ ...ready, dataSources: [{ type: 'postgresql' }, { type: 'postgresql' }, { type: 's3' }, { type: null }, { type: 'mongodb' }] }),
  'workspace-realtime-null-endpoint': ok({ ...ready, realtimeEndpointUrl: null, dataSources: [{ type: 'postgresql' }] }),
  'workspace-realtime-only-unsupported': ok({ ...ready, dataSources: [{ type: 's3' }, { type: null }] }),
  'workspace-realtime-no-sources': ok({ ...ready, dataSources: [] }),
  'workspace-realtime-disabled': ok({ ...ready, features: { realtime: false } }),
  'workspace-realtime-delayed': { ...ok(ready), delayMs: 1500 },
  'workspace-realtime-401': { status: 401, body: { code: 'UNAUTHORIZED' } },
  'workspace-realtime-401-refresh-ok': [{ status: 401, body: { code: 'UNAUTHORIZED' } }, ok(ready)],
  'workspace-realtime-401-refresh-rejected': { status: 401, body: { code: 'UNAUTHORIZED' } },
  'workspace-realtime-403': { status: 403, body: { code: 'FORBIDDEN' } },
  'workspace-realtime-404': { status: 404, body: { code: 'NOT_FOUND' } },
  'workspace-realtime-500': failure,
  'workspace-realtime-500-then-ok': [failure, ok(ready)],
  'workspace-realtime-network': { network: true },
}
export const realtimeEndpoints: Record<string, PageEndpoint> = {
  realtime: { method: 'GET', path: realtimePath, fixtures: { success: ok(ready), empty: realtimeFixtures['workspace-realtime-no-sources'], ...realtimeFixtures } },
}
// Allowed presentation differences from legacy; the snippets and transport remain identical.
export const allowedDifferences = ['inert disabled content', 'description list', 'endpoint copy', '403/404 states', 'back links', 'request id', 'focus moves']
const manifest: ParityManifest = {
  route: '/console/workspaces/ws-1/realtime', roles: ['superadmin', 'tenant_viewer'], endpoints: realtimeEndpoints,
  fixtures: ['realtime'], sources: ['src/pages/consoleRealtime.tsx', 'src/pages/consoleRealtime'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Tiempo real del área de trabajo")', en: 'h1:text-is("Workspace realtime")' } }],
  actions: [], states: [],
}
export default manifest

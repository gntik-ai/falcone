import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import { buildTenantCollectionFixture } from '@in-falcone/console-api/fixtures'

export const tenantId = 'synthetic-tenant'
export const tenant = { ...buildTenantCollectionFixture().items[0], tenantId: 'synthetic-tenant' }
export const quotasPath = `/v1/metrics/tenants/${tenantId}/quotas`
export const overviewPath = `/v1/metrics/tenants/${tenantId}/overview`
export const createPath = `/v1/tenants/${tenantId}/workspaces`
export const available = { dimensions: [{ dimensionId: 'workspaces.count', hardLimit: 10, measuredValue: 2, remainingToHardLimit: 8 }] }
export const exhausted = { dimensions: [{ dimensionId: 'workspaces.count', hardLimit: 1, measuredValue: 1, remainingToHardLimit: 0 }] }
export const success = { workspaceId: 'synthetic-created-workspace' }
export const rawMessage = 'synthetic-backend-message'
export const failure = (status: number): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: rawMessage, requestId: 'synthetic-workspaces-request' } })
function metricsFixtures(kind: 'quotas' | 'overview') {
  const body = kind === 'quotas' ? available : { hardLimitDimensions: [] }
  const prefix = `metrics.tenant-${kind}`
  return {
    success: { body }, [`${prefix}.available`]: { body }, [`${prefix}.delayed`]: { body, delayMs: 1500 },
    [`${prefix}.exhausted`]: { body: kind === 'quotas' ? exhausted : { hardLimitDimensions: ['workspaces.count'] } },
    ...Object.fromEntries([403, 404, 500].map((status) => [`${prefix}.${status}`, failure(status)])),
    [`${prefix}.network`]: { network: true },
    ...Object.fromEntries([403, 404, 500].map((status) => [`${prefix}.${status}-then-success`, [failure(status), { body }]])),
    [`${prefix}.network-then-success`]: [{ network: true }, { body }],
  }
}
export const endpoints: Record<string, PageEndpoint> = {
  workspacesQuotas: { method: 'GET', path: quotasPath, fixtures: metricsFixtures('quotas') },
  workspacesOverview: { method: 'GET', path: overviewPath, fixtures: metricsFixtures('overview') },
  workspacesCreate: { method: 'POST', path: createPath, fixtures: {
    success: { body: success }, 'tenant-workspaces.create.success': { body: success },
    'tenant-workspaces.create.validation-errors': { body: success },
    ...Object.fromEntries([403, 404, 409, 422, 500].map((status) => [`tenant-workspaces.create.${status}`, failure(status)])),
    'tenant-workspaces.create.network': { network: true },
    'tenant-workspaces.create.500-then-success': [failure(500), { body: success }],
    'tenant-workspaces.create.401-refresh-success': [failure(401), { body: success }],
    'tenant-workspaces.create.401-refresh-failure': failure(401),
  } },
}
const manifest: ParityManifest = {
  route: '/console/workspaces', roles: ['tenant_owner', 'tenant_viewer'], endpoints,
  fixtures: [...new Set(Object.values(endpoints).flatMap((endpoint) => Object.keys(endpoint.fixtures))), 'shell.tenant-admin', 'shell.tenant-viewer', 'shell.no-active-tenant'],
  sources: ['src/pages/consoleWorkspaces.tsx', 'src/pages/consoleWorkspaces'],
  data: [{ name: 'inventory', locator: { es: 'h2:text-is("Inventario")', en: 'h2:text-is("Inventory")' } }], actions: [], states: [],
}
export default manifest

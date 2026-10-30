import type { WorkspaceConsumptionResponse } from '@in-falcone/console-api/clients'
import type { PageEndpoint, ParityManifest } from '../manifest'

export const consumption: WorkspaceConsumptionResponse = {
  workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant', snapshotAt: '2026-07-01T00:00:00.000Z',
  dimensions: [
    { dimensionKey: 'max_pg_databases', displayLabel: 'PostgreSQL databases', unit: 'count', tenantEffectiveValue: 10,
      workspaceLimit: 6, workspaceSource: 'workspace_sub_quota', currentUsage: 4, usageStatus: 'within_limit', usageUnknownReason: null },
    { dimensionKey: 'max_requests', displayLabel: 'Synthetic requests', unit: 'count', tenantEffectiveValue: -1,
      workspaceLimit: null, workspaceSource: 'tenant_shared_pool', currentUsage: 7, usageStatus: 'within_limit' },
    { dimensionKey: 'max_storage', displayLabel: 'Synthetic storage', unit: 'bytes', tenantEffectiveValue: 100,
      workspaceLimit: null, workspaceSource: 'tenant_shared_pool', currentUsage: null, usageStatus: 'unknown' },
  ],
  capabilities: [
    { capabilityKey: 'realtime', displayLabel: 'Synthetic realtime capability', enabled: true, source: 'plan' },
    { capabilityKey: 'synthetic.disabled', displayLabel: 'Synthetic disabled capability', enabled: false },
  ],
}
const absent = { ...consumption, capabilities: undefined }
export const meterEdges: WorkspaceConsumptionResponse = { ...consumption, dimensions: [
  { ...consumption.dimensions[0], dimensionKey: 'null', displayLabel: 'Synthetic null', currentUsage: null, usageStatus: 'unknown' },
  { ...consumption.dimensions[0], dimensionKey: 'unlimited', displayLabel: 'Synthetic unlimited', workspaceLimit: -1 },
  { ...consumption.dimensions[0], dimensionKey: 'zero', displayLabel: 'Synthetic zero', workspaceLimit: 0, currentUsage: 0, usageStatus: 'at_limit' },
  { ...consumption.dimensions[0], dimensionKey: 'zero-positive', displayLabel: 'Synthetic zero positive', workspaceLimit: 0, currentUsage: 2, usageStatus: 'over_limit' },
  { ...consumption.dimensions[0], dimensionKey: 'equal', displayLabel: 'Synthetic equal', workspaceLimit: 6, currentUsage: 6, usageStatus: 'at_limit' },
  { ...consumption.dimensions[0], dimensionKey: 'over', displayLabel: 'Synthetic over', workspaceLimit: 6, currentUsage: 10, usageStatus: 'over_limit' },
] }
const ok = (body: unknown) => ({ status: 200, body })
export const consumptionFailure = (status: number) => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error',
  ...(status === 500 ? { requestId: 'req_synthetic_workspace_500' } : {}) } })
export const consumptionFixtures = {
  success: ok(consumption), 'workspace-consumption.success': ok(consumption),
  'workspace-consumption.unlimited-and-unknown': ok(consumption),
  'workspace-consumption.long-identifiers': ok({ ...consumption, workspaceId: 'synthetic-workspace-'.repeat(16), tenantId: 'synthetic-tenant-'.repeat(16) }),
  'workspace-consumption.delayed': { ...ok(consumption), delayMs: 1500 },
  empty: ok({ ...consumption, dimensions: [] }),
  'workspace-consumption.dimensions-empty': ok({ ...consumption, dimensions: [] }),
  'workspace-consumption.capabilities-empty': ok({ ...consumption, capabilities: [] }),
  'workspace-consumption.capabilities-absent': ok(absent),
  'workspace-consumption.dimensions-empty-capabilities-absent': ok({ ...absent, dimensions: [] }),
  'workspace-consumption.meter-edges': ok(meterEdges),
  '401': [consumptionFailure(401), ok(consumption)],
  'workspace-consumption.401-refresh-ok': [consumptionFailure(401), ok(consumption)],
  'workspace-consumption.401-refresh-fail': consumptionFailure(401),
  '403': consumptionFailure(403), 'workspace-consumption.403': consumptionFailure(403),
  '404': consumptionFailure(404), 'workspace-consumption.404': consumptionFailure(404),
  '500': consumptionFailure(500), 'workspace-consumption.500': consumptionFailure(500),
  network: { network: true }, 'workspace-consumption.network': { network: true },
}
export const workspaceConsumptionEndpoints: Record<string, PageEndpoint> = {
  // Keep the parity route inside the shared shell session's workspace membership.
  workspaceConsumption: { method: 'GET', path: `/v1/workspaces/${consumption.workspaceId}/consumption`, fixtures: consumptionFixtures },
  // The CSP route enumerator uses this parameter sample independently of shell membership.
  sampleWorkspaceConsumption: { method: 'GET', path: '/v1/workspaces/sample-workspaceId/consumption', fixtures: {
    success: ok({ ...consumption, workspaceId: 'sample-workspaceId' }),
  } },
}
const manifest: ParityManifest = {
  route: `/console/workspaces/${consumption.workspaceId}`, roles: ['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'],
  endpoints: workspaceConsumptionEndpoints, fixtures: ['tenant', 'tenants', 'workspaces', 'refresh', 'workspaceConsumption'],
  sources: ['src/pages/consoleWorkspaceDashboard.tsx'],
  data: [{ name: 'quota table', locator: '.workspace-dashboard table' }, { name: 'capabilities', locator: '.workspace-dashboard ul' }],
  actions: [], states: [
    { fixture: 'workspaceConsumption', variant: 'empty', locator: { es: '.workspace-dashboard h3:text-is("No se devolvieron dimensiones de cuota.")', en: '.workspace-dashboard h3:text-is("No quota dimensions were returned.")' } },
    { fixture: 'workspaceConsumption', variant: '403', locator: { es: '.workspace-dashboard h2:text-is("No tienes acceso a esta área de trabajo.")', en: '.workspace-dashboard h2:text-is("You do not have access to this workspace.")' } },
    { fixture: 'workspaceConsumption', variant: '404', locator: { es: '.workspace-dashboard h2:text-is("Datos de consumo no disponibles")', en: '.workspace-dashboard h2:text-is("Consumption data unavailable")' } },
    { fixture: 'workspaceConsumption', variant: '500', locator: '.workspace-dashboard [data-testid="workspace-error"]' },
    { fixture: 'workspaceConsumption', variant: 'network', locator: '.workspace-dashboard [data-testid="workspace-error"]' },
  ],
}
export default manifest

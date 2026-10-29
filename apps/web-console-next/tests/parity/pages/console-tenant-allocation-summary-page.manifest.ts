import type { ParityManifest, PageEndpoint } from '../manifest'
import type { AllocationSummary } from '../../../src/pages/consoleTenantAllocationSummary/api'

export const allocationMixed: AllocationSummary = {
  tenantId: 'synthetic-tenant',
  dimensions: [
    { dimensionKey: 'max_pg_databases', displayLabel: 'PostgreSQL Databases', unit: 'count', tenantEffectiveValue: 5, totalAllocated: 5, unallocated: 0, isFullyAllocated: true,
      workspaces: [{ workspaceId: 'synthetic-production', displayLabel: 'Synthetic Production', workspaceName: 'Ignored name', allocatedValue: 3 },
        { workspaceId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', displayLabel: '   ', workspaceName: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', allocatedValue: 2 }] },
    { dimensionKey: 'max_storage_bytes', displayLabel: 'Storage', unit: 'bytes', tenantEffectiveValue: 8192, totalAllocated: 2048, unallocated: 6144, isFullyAllocated: false,
      workspaces: [{ workspaceId: 'synthetic-storage', workspaceSlug: 'synthetic-storage', allocatedValue: 2048 }] },
    { dimensionKey: 'max_requests', displayLabel: 'Requests', unit: 'requests', tenantEffectiveValue: -1, totalAllocated: 12345, unallocated: null, isFullyAllocated: false, workspaces: [] },
  ],
}
export const allocationEmpty: AllocationSummary = { ...allocationMixed, dimensions: allocationMixed.dimensions.map((row) => ({ ...row, workspaces: [] })) }
const ok = { status: 200, body: allocationMixed }
const error = (status: number) => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-error', ...(status === 500 ? { requestId: 'req_synthetic_alloc_500' } : {}) } })
export const allocationEndpoints: Record<string, PageEndpoint> = {
  allocationSummary: { method: 'GET', path: '/v1/tenant/plan/allocation-summary', fixtures: {
    success: ok, 'allocation-summary-mixed': ok, empty: { status: 200, body: allocationEmpty },
    'allocation-summary-no-allocations': { status: 200, body: allocationEmpty },
    'allocation-summary-loading-delayed': { ...ok, delayMs: 1500 },
    '401': [error(401), ok], 'allocation-summary-401': [error(401), ok],
    'allocation-summary-401-refresh-rejected': error(401),
    '403': error(403), '404': error(404), '500': error(500), network: { network: true },
    'allocation-summary-403': error(403), 'allocation-summary-404': error(404), 'allocation-summary-500': error(500), 'allocation-summary-network': { network: true },
  } },
}
const manifest: ParityManifest = {
  route: '/console/my-plan/allocation', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'],
  fixtures: ['tenant', 'tenants', 'workspaces', 'refresh', 'status', 'allocationSummary'], endpoints: allocationEndpoints,
  sources: ['src/pages/consoleTenantAllocationSummary.tsx', 'src/pages/consoleTenantAllocationSummary'],
  data: [{ name: 'allocation table', locator: '.allocation-summary table' }, { name: 'workspace label', locator: '.allocation-summary :text-is("Synthetic Production")' }],
  actions: [],
  states: [
    { fixture: 'allocationSummary', variant: 'empty', locator: { es: '.allocation-summary h2:text-is("Todavía no hay asignaciones de área de trabajo")', en: '.allocation-summary h2:text-is("No workspace allocations yet")' } },
    { fixture: 'allocationSummary', variant: '403', locator: { es: '.allocation-summary h2:text-is("Sin acceso al resumen de asignación")', en: '.allocation-summary h2:text-is("No access to the allocation summary")' } },
    { fixture: 'allocationSummary', variant: '404', locator: { es: '.allocation-summary h2:text-is("Resumen de asignación no encontrado")', en: '.allocation-summary h2:text-is("Allocation summary not found")' } },
    { fixture: 'allocationSummary', variant: '500', locator: '.allocation-summary [data-testid="allocation-error"]' },
    { fixture: 'allocationSummary', variant: 'network', locator: '.allocation-summary [data-testid="allocation-error"]' },
  ],
}
export default manifest

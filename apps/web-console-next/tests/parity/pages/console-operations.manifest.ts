import type { EndpointResponse, ParityManifest, PageEndpoint, Role } from '../manifest'
import { operationEndpoints, operation } from './operationDetail.manifest'
import type { OperationFilters, OperationSummary } from '../../../src/pages/consoleOperations/query'

export const operations: OperationSummary[] = Array.from({ length: 45 }, (_, index) => ({
  ...operation, operationId: `op_${index + 1}`, operationType: ['synthetic-workspace-create', 'synthetic-bucket-create', 'synthetic-workspace-delete'][index % 3],
  status: (['pending', 'running', 'completed', 'failed', 'timed_out', 'cancelled'] as const)[index % 6],
  workspaceId: index % 2 ? null : 'synthetic-workspace', correlationId: 'synthetic-correlation',
}))
export const running = { ...operations[0], status: 'running' as const }
export const completed = { ...running, status: 'completed' as const }
export const listBody = (filters: OperationFilters = {}, offset = 0, limit = 20) => ({ queryType: 'list', filters, pagination: { limit, offset } })
export const reconciliationBody = (offset = 0) => listBody({ status: ['running', 'pending'], tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace' }, offset, 100)
const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
const failure = { status: 500, body: { code: 'HTTP_500', message: 'synthetic-error', requestId: 'synthetic-request' } }
export function listResponse(items: OperationSummary[], total = items.length, offset = 0, limit = 20) {
  return { queryType: 'list' as const, items, total, pagination: { limit, offset } }
}
function fixture(rows: OperationSummary[], remote: OperationSummary[] = rows) {
  return (_role: Role, body?: unknown): EndpointResponse => {
    const request = body as { filters: OperationFilters; pagination: { limit: number; offset: number } }
    const { filters = {}, pagination: { limit, offset } } = request
    if (Array.isArray(filters.status)) return ok(listResponse(remote.slice(offset, offset + limit), remote.length, offset, limit))
    const filtered = rows.filter((row) => (!filters.status || row.status === filters.status) && (!filters.operationType || row.operationType === filters.operationType) && (!filters.workspaceId || row.workspaceId === filters.workspaceId))
    return ok(listResponse(filtered.slice(offset, offset + limit), filtered.length, offset, limit))
  }
}
export const listEndpoint: PageEndpoint = {
  method: 'POST', path: '/v1/async-operation-query', requestBody: { queryType: 'list' }, fixtures: {
    success: fixture(operations), '45-mixed': fixture(operations),
    'with-running': fixture([running]), '45-running': fixture(operations.map((row) => ({ ...row, status: 'running' }))), 'all-completed': fixture(operations.map((row) => ({ ...row, status: 'completed' }))),
    empty: fixture([]), 'filtered-empty': fixture([]), '500': failure,
    '500-then-success': [failure, failure, failure, fixture(operations.map((row) => ({ ...row, status: 'running' })))],
    'network-then-success': [{ network: true }, { network: true }, { network: true }, fixture(operations.map((row) => ({ ...row, status: 'running' })))],
    'delta-updated': fixture([completed], [completed, { ...running, operationId: 'op_added' }]),
    unchanged: fixture([running]), 'after-reconcile': fixture([completed]),
    'paged-reconciliation': fixture([running], [running, ...Array.from({ length: 100 }, (_, i) => ({ ...running, operationId: `op_added_${i}` }))]),
  },
}
const manifest: ParityManifest = {
  route: '/console/operations', roles: ['tenant_owner', 'workspace_viewer'],
  endpoints: { ...operationEndpoints, 'ops.list': listEndpoint, 'console.session': { method: 'GET', path: '/v1/console/session', fixtures: { success: ok({ authenticationState: 'active' }) } } },
  fixtures: ['ops.list', 'console.session'], sources: ['src/pages/consoleOperations.tsx', 'src/pages/consoleOperations'],
  data: [
    { name: 'title', locator: { es: 'h1:has(> span:text-is("Operaciones"))', en: 'h1:has(> span:text-is("Operations"))' } },
    { name: 'first type', locator: 'tbody tr:first-child a:text-is("synthetic-workspace-create")' },
    { name: 'range', locator: { es: 'p:text-is("1–20 de 45")', en: 'p:text-is("1–20 of 45")' } },
    { name: 'actor', locator: 'tbody tr:first-child td:text-is("synthetic-user")' },
  ],
  actions: [
    { name: 'next page', trigger: [{ es: 'button[aria-label="Siguiente"]', en: 'button[aria-label="Next"]' }], expected: { method: 'POST', path: '/v1/async-operation-query', body: listBody({}, 20) }, outcome: 'tbody tr:first-child a[href$="/op_21"]' },
  ],
  states: [
    { fixture: 'ops.list', variant: 'empty', locator: { es: 'h2:text-is("No hay operaciones registradas para esta organización.")', en: 'h2:text-is("No operations have been recorded for this organization.")' } },
    { fixture: 'ops.list', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para ver esta página.")', en: 'h2:text-is("You do not have permission to view this page.")' } },
    { fixture: 'ops.list', variant: '404', locator: { es: 'h2:text-is("Operaciones no disponibles.")', en: 'h2:text-is("Operations unavailable.")' } },
    ...(['500', 'network'] as const).map((variant) => ({ fixture: 'ops.list', variant, locator: { es: 'h2:text-is("No se pudieron cargar las operaciones.")', en: 'h2:text-is("Could not load operations.")' } })),
  ],
}
export default manifest

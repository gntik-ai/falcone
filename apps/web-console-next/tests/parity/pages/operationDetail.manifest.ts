import type { EndpointResponse, ParityManifest, PageEndpoint, Role } from '../manifest'

export const operation = {
  queryType: 'detail', operationId: 'op_1', status: 'completed', operationType: 'synthetic-workspace-create',
  tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actorId: 'synthetic-user', actorType: 'tenant_owner',
  correlationId: 'synthetic-correlation', sagaId: 'synthetic-saga', idempotencyKey: null, errorSummary: null,
  createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-01T11:00:00Z',
}
export const entries = Array.from({ length: 45 }, (_, i) => ({
  logEntryId: `synthetic-log-${i + 1}`, level: (['info', 'warning', 'error'] as const)[i % 3],
  message: `Synthetic operation message ${i + 1}: ${'synthetic-progress '.repeat(8).trim()}`,
  occurredAt: '2026-06-01T11:55:00Z',
}))
export const successResult = {
  queryType: 'result', operationId: 'op_1', status: 'completed', resultType: 'success',
  summary: 'Synthetic operation completed', failureReason: null, retryable: null, completedAt: '2026-06-01T11:00:00Z',
}
const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
const failure = { status: 500, body: { code: 'HTTP_500', message: 'synthetic-error', requestId: 'synthetic-request' } }
const detail = ok(operation)
const result = ok(successResult)
const logs = (_role: Role, body?: unknown): EndpointResponse => {
  const pagination = (body as { pagination: { limit: number; offset: number } }).pagination
  return ok({ queryType: 'logs', operationId: 'op_1', entries: entries.slice(pagination.offset, pagination.offset + pagination.limit), total: 45, pagination })
}
export const operationEndpoints: Record<string, PageEndpoint> = {
  'ops.detail': { method: 'POST', path: '/v1/async-operation-query', requestBody: { queryType: 'detail' }, fixtures: {
    success: detail, completed: detail, empty: ok({}), '500': failure,
    '500-then-success': [failure, failure, failure, detail],
    ...Object.fromEntries(['pending', 'running', 'failed', 'timed_out', 'cancelled'].map((status) => [status, ok({ ...operation, status })])),
  } },
  'ops.logs': { method: 'POST', path: '/v1/async-operation-query', requestBody: { queryType: 'logs' }, fixtures: {
    success: logs,
    '45-entries': logs,
    empty: ok({ queryType: 'logs', operationId: 'op_1', entries: [], total: 0, pagination: { limit: 20, offset: 0 } }),
    '500': failure,
    '500-then-success': [failure, failure, failure, logs],
  } },
  'ops.result': { method: 'POST', path: '/v1/async-operation-query', requestBody: { queryType: 'result' }, fixtures: {
    success: result,
    'failure-retryable': ok({ ...successResult, status: 'failed', resultType: 'failure', summary: null, failureReason: 'Synthetic failure reason', retryable: true }),
    pending: ok({ ...successResult, status: 'running', resultType: 'pending', summary: null, completedAt: null }),
    empty: ok({ ...successResult, status: 'running', resultType: 'pending', summary: null, completedAt: null }),
    '500': failure,
    'network-then-success': [{ network: true }, { network: true }, { network: true }, result],
  } },
}
export const bodyFor = (queryType: string, offset = 0) => ({ queryType, operationId: 'op_1', pagination: { limit: 20, offset } })
const manifest: ParityManifest = {
  route: '/console/operations/op_1', roles: ['tenant_owner', 'workspace_viewer'],
  endpoints: operationEndpoints, fixtures: ['ops.detail', 'ops.logs', 'ops.result'],
  sources: ['src/pages/operationDetail.tsx', 'src/pages/operationDetail'],
  data: [
    // The wrapping title span owns the text; :text-is on h1 only checks its own text nodes.
    { name: 'title', locator: { es: 'h1:has(> span:text-is("Detalle de operación"))', en: 'h1:has(> span:text-is("Operation detail"))' } },
    ...['synthetic-workspace-create', 'synthetic-user', 'synthetic-tenant', 'synthetic-workspace', 'synthetic-correlation', 'synthetic-saga'].map((value) => ({ name: value, locator: `.operation-metadata dd :text-is("${value}")` })),
    { name: 'eight metadata fields', locator: '.operation-metadata dt >> nth=0' },
    { name: 'first log', locator: 'td:text-is("' + entries[0].message + '")' },
    { name: 'range', locator: { es: 'p:text-is("1–20 de 45")', en: 'p:text-is("1–20 of 45")' } },
  ],
  actions: [
    { name: 'next logs', trigger: [{ es: 'button[aria-label="Siguiente"]', en: 'button[aria-label="Next"]' }], expected: { method: 'POST', path: '/v1/async-operation-query', body: bodyFor('logs', 20) }, outcome: 'td:text-is("' + entries[20].message + '")' },
    { name: 'previous logs', trigger: [{ es: 'button[aria-label="Siguiente"]', en: 'button[aria-label="Next"]' }, { es: 'button[aria-label="Anterior"]', en: 'button[aria-label="Previous"]' }], expected: { method: 'POST', path: '/v1/async-operation-query', body: bodyFor('logs') }, outcome: 'td:text-is("' + entries[0].message + '")' },
  ],
  states: [
    { fixture: 'ops.detail', variant: '404', locator: { es: 'h2:text-is("Operación no encontrada o no disponible.")', en: 'h2:text-is("Operation not found or unavailable.")' } },
    { fixture: 'ops.detail', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para ver esta operación.")', en: 'h2:text-is("You do not have permission to view this operation.")' } },
    ...(['500', 'network'] as const).map((variant) => ({ fixture: 'ops.detail', variant, locator: { es: 'h3:text-is("No se pudo cargar: Metadatos")', en: 'h3:text-is("Could not load: Metadata")' } })),
    { fixture: 'ops.logs', variant: 'empty', locator: { es: 'h3:text-is("La operación aún no ha comenzado a ejecutarse.")', en: 'h3:text-is("The operation has not started running yet.")' } },
  ],
}
export default manifest

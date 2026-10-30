import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { ExecutionPage } from '../../../src/pages/consoleFlowHistory/api'

export const historyPath = '/v1/flows/workspaces/synthetic-workspace/flows/f1/executions'
export const executionId = 'synthetic-tenant:synthetic-workspace:f1:run-aaaaaaaaaaaaaaaaaaaaaaaaa'
export const firstPage: ExecutionPage = { items: [{ executionId, workflowId: 'synthetic-workflow', status: 'Completed', triggerType: 'manual', version: 1, startedAt: '2026-01-01T00:00:00Z' }], nextPageToken: 'tok-2' }
export const lastPage: ExecutionPage = { items: [{ executionId: 'synthetic-run-page2', workflowId: 'synthetic-workflow', status: 'Failed', triggerType: 'cron' }], nextPageToken: null }
export const historyVariants = ['page1-with-token', 'page2-last', 'filtered-failed', 'empty', 'filtered-empty', '401', '401-repeat', '403', '404', '500', 'network', 'loading']
export function historyResponse(variant: string): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (['401', '401-repeat', '403', '404', '500'].includes(variant)) {
    const status = variant === '401-repeat' ? 401 : Number(variant)
    return { status, body: { code: `HTTP_${status}`, message: 'synthetic-backend-reason', requestId: 'req_synthetic_history' } }
  }
  return { status: 200, body: ['empty', 'filtered-empty'].includes(variant) ? { items: [], nextPageToken: null } : ['page2-last', 'filtered-failed'].includes(variant) ? lastPage : firstPage, ...(variant === 'loading' ? { delayMs: 1500 } : {}) }
}
export const historyEndpoints: Record<string, PageEndpoint> = {
  'flows.executions': { method: 'GET', path: historyPath, fixtures: Object.fromEntries(['success', ...historyVariants].map((variant) => [variant, historyResponse(variant)])) },
}
// Approved deliberate differences from legacy, all bounded to presentation.
export const deliberateChanges = [
  '403 renders no-access with the backend reason and no request-access action.',
  '404 renders not-found with a link to Flows.',
  '500 displays status and request identifier diagnostics.',
  'Known trigger labels are translated; request values are unchanged.',
]
const manifest: ParityManifest = {
  route: '/console/flows/f1/runs', roles: ['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'], endpoints: historyEndpoints,
  fixtures: ['shell:no-workspace', 'nav-state:flow-trigger', 'refresh:success', 'refresh:401', ...historyVariants.map((name) => `flows.executions:${name}`)],
  sources: ['src/pages/consoleFlowHistory.tsx', 'src/pages/consoleFlowHistory'],
  data: [{ name: 'history title', locator: { es: 'h1:text-is("Historial de ejecuciones")', en: 'h1:text-is("Execution history")' } }],
  actions: [], states: [
    { fixture: 'flows.executions', variant: 'empty', locator: { es: 'h2:text-is("Todavía no hay ejecuciones")', en: 'h2:text-is("No executions yet")' } },
    { fixture: 'flows.executions', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a las ejecuciones de este flujo")', en: 'h2:text-is("You do not have access to this flow’s executions")' } },
    { fixture: 'flows.executions', variant: '404', locator: { es: 'h2:text-is("Flujo no encontrado")', en: 'h2:text-is("Flow not found")' } },
    { fixture: 'flows.executions', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar las ejecuciones")', en: 'h2:text-is("Could not load executions")' } },
  ],
}
export default manifest

import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import { historyEndpoints } from './console-flow-history-page.manifest'
export const flowsPath = '/v1/flows/workspaces/synthetic-workspace/flows'
export const triggerPath = `${flowsPath}/f1/schedule/trigger`
export const flowRows = { items: [
  { flowId: 'f1', name: 'Synthetic published flow', status: 'published', updatedAt: '2026-06-30T12:00:00Z' },
  { flowId: 'draft/1', name: 'Synthetic draft flow', status: 'draft', createdAt: '2026-01-01T00:00:00Z' },
] }
export const variants = ['success', 'empty', '401', '403', '404', '409', '429', '500', 'network', 'loading']
export function flowResponse(variant: string, success: unknown = flowRows): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (/^\d+$/.test(variant)) return { status: Number(variant), body: { code: `HTTP_${variant}`, message: 'synthetic-backend-reason', requestId: 'req_synthetic_flows' } }
  return { status: 200, body: variant === 'empty' ? { items: [] } : success, ...(variant === 'loading' ? { delayMs: 1500 } : {}) }
}
export const flowsEndpoints: Record<string, PageEndpoint> = {
  'flows.list': { method: 'GET', path: flowsPath, fixtures: Object.fromEntries([...variants, 'success-draft-and-published'].map((variant) => [variant, flowResponse(variant)])) },
  'flows.post': { method: 'POST', path: flowsPath, fixtures: Object.fromEntries(variants.map((variant) => [variant, flowResponse(variant, { flowId: 'created/1', name: 'Trimmed' })])) },
  'flows.schedule.trigger': { method: 'POST', path: triggerPath, fixtures: Object.fromEntries(variants.map((variant) => [variant, flowResponse(variant, { status: 'triggered', scheduleId: 'synthetic-schedule' })])) },
  ...historyEndpoints,
}
export const deliberateChanges = [
  'History and run-now use migrated in-router history; designer and post-create load the legacy document.',
  'No success toast or announcement precedes navigation; history displays the trigger notice.',
  'Failures are announced; list access, not-found and diagnostic states use the approved kit variants.',
]
const manifest: ParityManifest = {
  route: '/console/flows', roles: ['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'], endpoints: flowsEndpoints,
  fixtures: ['flows.list:success-draft-and-published', 'shell:no-workspace', 'shell:workspace-viewer', 'refresh:success', 'refresh:401', ...['flows.list', 'flows.post', 'flows.schedule.trigger'].flatMap((name) => variants.map((variant) => `${name}:${variant}`))],
  sources: ['src/pages/consoleFlows.tsx', 'src/pages/consoleFlows'],
  data: [{ name: 'flows title', locator: { es: 'h1:text-is("Flujos")', en: 'h1:text-is("Flows")' } }], actions: [],
  states: [
    { fixture: 'flows.list', variant: 'empty', locator: { es: 'h2:text-is("Todavía no hay flujos")', en: 'h2:text-is("No flows yet")' } },
    { fixture: 'flows.list', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a los flujos de esta área de trabajo")', en: 'h2:text-is("You do not have access to this workspace’s flows")' } },
    { fixture: 'flows.list', variant: '404', locator: { es: 'h2:text-is("Área de trabajo no encontrada")', en: 'h2:text-is("Workspace not found")' } },
    { fixture: 'flows.list', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar los flujos")', en: 'h2:text-is("Could not load flows")' } },
  ],
}
export default manifest

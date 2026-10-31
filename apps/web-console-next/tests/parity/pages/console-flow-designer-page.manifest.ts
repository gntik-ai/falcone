import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { FlowDefinitionRecord } from '../../../src/pages/consoleFlowDesigner/api'
import type { TaskTypeDescriptor } from '../../../src/pages/consoleFlowDesigner/flows'

export const flowPath = '/v1/flows/workspaces/synthetic-workspace/flows/f1'
export const taskTypesPath = '/v1/flows/workspaces/synthetic-workspace/task-types'
export const versionPath = `${flowPath}/versions`
export const triggerPath = `${flowPath}/schedule/trigger`
export const taskTypes: TaskTypeDescriptor[] = [{ id: 'synthetic-task', label: 'Synthetic task', category: 'Synthetic catalogue', inputSchema: { type: 'object', properties: { text: { type: 'string' }, count: { type: 'integer' }, enabled: { type: 'boolean' }, mode: { enum: ['a', 'b'] }, expression: { type: 'string', 'x-falcone-expression': true } } } }]
export const flowRecord: FlowDefinitionRecord = {
  flowId: 'f1', name: 'Synthetic flow', status: 'draft', definition: {
    apiVersion: 'v1.0', name: 'Synthetic flow', nodes: [
      { id: 'sequence', type: 'sequence', steps: ['parallel'], next: 'subflow' },
      { id: 'parallel', type: 'parallel', branches: ['branch', 'approval'], next: 'wait' },
      { id: 'branch', type: 'branch', arms: [{ when: 'true', next: 'task' }], default: 'wait' },
      { id: 'task', type: 'task', taskType: 'synthetic-task', input: { text: 'Synthetic input' }, next: 'wait' },
      { id: 'approval', type: 'approval', approvers: ['synthetic-approver'], timeout: 'P1D', next: 'wait' },
      { id: 'wait', type: 'wait', duration: 'PT10M' },
      { id: 'subflow', type: 'sub-flow', flowId: 'synthetic-child', flowVersion: '1' },
    ], canvasMetadata: { nodes: Object.fromEntries(['sequence', 'parallel', 'branch', 'task', 'approval', 'wait', 'subflow'].map((id, index) => [id, { x: (index % 3) * 250, y: Math.floor(index / 3) * 170 }])) },
  },
}
export const serverErrors = [
  { code: 'FLW-E006', nodeId: 'task', message: 'Never display raw backend diagnostics', params: { taskType: 'synthetic-task' } },
  { code: 'FLW-E007', nodeId: null, message: 'Never display raw backend diagnostics', params: { schedule: 'synthetic-invalid' } },
]
export const variants = ['success', 'draft-all-node-kinds', 'empty-draft', 'empty', 'published', 'loading', '401', '401-refresh-ok', '401-refresh-rejected', '403', '404', '500', 'network', '422-node-errors']
export function designerResponse(variant: string, success: unknown = flowRecord): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (variant === '422-node-errors') return { status: 422, body: { code: 'FLOW_VALIDATION_FAILED', errors: serverErrors } }
  if (/^\d+$/.test(variant) || variant.startsWith('401-')) return { status: Number(variant.slice(0, 3)), body: { code: `HTTP_${variant}`, message: 'synthetic-backend-reason', requestId: 'req_synthetic_designer' } }
  return { status: 200, body: variant === 'empty-draft' ? { ...flowRecord, definition: {} } : variant === 'published' ? { ...flowRecord, status: 'published' } : variant === 'empty' ? { items: [] } : success, ...(variant === 'loading' ? { delayMs: 1500 } : {}) }
}
function fixtures(success: unknown) { return Object.fromEntries(variants.map((variant) => [variant, designerResponse(variant, success)])) }
export const designerEndpoints: Record<string, PageEndpoint> = {
  'flows.get': { method: 'GET', path: flowPath, fixtures: fixtures(flowRecord) },
  'flows.task-types': { method: 'GET', path: taskTypesPath, fixtures: fixtures({ items: taskTypes }) },
  'flows.patch': { method: 'PATCH', path: flowPath, fixtures: fixtures(flowRecord) },
  'flows.versions.post': { method: 'POST', path: versionPath, fixtures: fixtures({ flowId: 'f1', version: 2 }) },
  'flows.schedule.trigger': { method: 'POST', path: triggerPath, fixtures: fixtures({ status: 'triggered', scheduleId: 'synthetic-schedule' }) },
}
const manifest: ParityManifest = {
  route: '/console/flows/f1', roles: ['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'], endpoints: designerEndpoints,
  fixtures: ['shell:no-workspace', 'refresh:success', 'refresh:401', ...Object.keys(designerEndpoints).flatMap((name) => variants.map((variant) => `${name}:${variant}`))],
  sources: ['src/pages/consoleFlowDesigner.tsx', 'src/pages/consoleFlowDesigner'],
  data: [{ name: 'flow title', locator: 'h1:text-is("Synthetic flow")' }], actions: [],
  states: [
    { fixture: 'flows.get', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a este flujo")', en: 'h2:text-is("You do not have access to this flow")' } },
    { fixture: 'flows.get', variant: '404', locator: { es: 'h2:text-is("Flujo no encontrado")', en: 'h2:text-is("Flow not found")' } },
    { fixture: 'flows.get', variant: '500', locator: { es: 'h2:text-is("No se pudo cargar el flujo")', en: 'h2:text-is("Could not load the flow")' } },
    { fixture: 'flows.get', variant: 'network', locator: { es: 'h2:text-is("No se pudo cargar el flujo")', en: 'h2:text-is("Could not load the flow")' } },
  ],
}
export default manifest

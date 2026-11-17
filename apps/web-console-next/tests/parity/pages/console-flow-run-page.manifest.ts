import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { ExecutionDetail, FlowDefinitionRecord } from '../../../src/pages/consoleFlowRun/api'

// Synthetic identifiers only: no credential, key or real name appears in any fixture.
export const flowPath = '/v1/flows/workspaces/synthetic-workspace/flows/f1'
export const executionPath = `${flowPath}/executions/e1`
export const eventsPath = '/v1/flows/workspaces/synthetic-workspace/executions/e1/events'
export const cancelPath = `${executionPath}/cancellations`
export const retryPath = `${executionPath}/retries`
export const signalPath = `${executionPath}/signals/review`
export const runRoute = '/console/flows/f1/runs/e1'

export const flowRecord: FlowDefinitionRecord = {
  flowId: 'f1', name: 'Synthetic flow', status: 'published', definition: {
    apiVersion: 'v1.0', name: 'Synthetic flow', nodes: [
      { id: 'start', type: 'task', taskType: 'synthetic-task', next: 'review' },
      { id: 'review', type: 'approval', approvers: ['synthetic-approver'], next: 'done' },
      { id: 'done', type: 'task', taskType: 'synthetic-task' },
    ],
    canvasMetadata: { nodes: { start: { x: 0, y: 0 }, review: { x: 0, y: 140 }, done: { x: 0, y: 280 } } },
  },
}
const attempt = (status: 'completed' | 'failed' | 'started' | 'waiting-approval', n = 1) => ({ status, attemptNumber: n, startedAt: '2026-01-01T00:00:00Z', ...(status === 'completed' || status === 'failed' ? { completedAt: '2026-01-01T00:00:01Z' } : {}) })
// A payload whose pretty-printed text is exactly `length` characters long.
export function payloadOfLength(length: number) {
  const base = JSON.stringify({ value: '' }, null, 2).length
  return { value: 'x'.repeat(length - base) }
}
const base: ExecutionDetail = { executionId: 'e1', workflowId: 'synthetic-workflow', status: 'Completed', version: 1, startedAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-01T00:00:03Z', nodes: [
  { nodeId: 'start', status: 'completed', input: { synthetic: 'input' }, output: { synthetic: 'output' }, attempts: [attempt('failed'), attempt('completed', 2)] },
  { nodeId: 'review', status: 'completed', input: null, output: null, attempts: [] },
  { nodeId: 'done', status: 'completed', input: null, output: null, attempts: [attempt('completed')] },
] }
const withStart = (patch: Partial<ExecutionDetail['nodes'] extends (infer N)[] | undefined ? N : never>, rest: Partial<ExecutionDetail> = {}): ExecutionDetail =>
  ({ ...base, ...rest, nodes: base.nodes!.map((node) => node.nodeId === 'start' ? { ...node, ...patch } : node) })
export const executionVariants: Record<string, ExecutionDetail> = {
  completed: base,
  failed: { ...base, status: 'Failed', nodes: base.nodes!.map((node) => node.nodeId === 'done' ? { ...node, status: 'failed', error: { message: 'synthetic failure', stack: 'Error: synthetic failure\n    at synthetic (synthetic.js:1:1)' }, attempts: [attempt('failed')] } : node) },
  running: { ...base, status: 'Running', closedAt: null, nodes: [{ nodeId: 'start', status: 'completed', attempts: [attempt('completed')] }, { nodeId: 'review', status: 'scheduled', attempts: [] }, { nodeId: 'done', status: 'scheduled', attempts: [] }] },
  'waiting-approval': { ...base, status: 'Running', closedAt: null, nodes: [{ nodeId: 'start', status: 'completed', attempts: [attempt('completed')] }, { nodeId: 'review', status: 'waiting-approval', attempts: [attempt('waiting-approval')] }, { nodeId: 'done', status: 'scheduled', attempts: [] }] },
  'payload-4095': withStart({ output: payloadOfLength(4095) }),
  'payload-4096': withStart({ output: payloadOfLength(4096) }),
  'payload-4097': withStart({ output: payloadOfLength(4097) }),
  'payload-string-and-null': withStart({ input: 'plain synthetic text', output: null, attempts: [] }),
}
export const variants = ['success', ...Object.keys(executionVariants), 'no-definition', '401', '403', '404', '500', 'network']
function response(variant: string, success: unknown): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (/^\d+$/.test(variant)) return { status: Number(variant), body: { code: `HTTP_${variant}`, message: 'synthetic-backend-reason', requestId: 'req_synthetic_run' } }
  return { status: 200, body: success }
}
function executionResponse(variant: string): EndpointResponse {
  return response(variant, executionVariants[variant] ?? executionVariants.completed)
}
export const post = (success: unknown, failure = '403') => ({ success: response('success', success), '403': response(failure, success), '500': response('500', success) })
export const runEndpoints: Record<string, PageEndpoint> = {
  'flows.run.flow': { method: 'GET', path: flowPath, fixtures: { ...Object.fromEntries(variants.map((variant) => [variant, response(variant === 'no-definition' ? 'success' : variant, variant === 'no-definition' ? { ...flowRecord, definition: undefined } : flowRecord)])) } },
  'flows.run.execution': { method: 'GET', path: executionPath, fixtures: Object.fromEntries(variants.map((variant) => [variant, executionResponse(variant)])) },
  'flows.run.cancellations': { method: 'POST', path: cancelPath, fixtures: post({ executionId: 'e1', status: 'Canceled' }) },
  'flows.run.retries': { method: 'POST', path: retryPath, fixtures: post({ executionId: 'e2', status: 'Running', version: 1 }) },
  'flows.run.signals': { method: 'POST', path: signalPath, fixtures: post({ executionId: 'e1', signal: 'review', delivered: true }) },
}

// Server-sent frames. Every frame has an id so a resumed stream can be checked against Last-Event-ID.
export const frame = (id: string, type: string, data: object) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
export const sse = {
  // Statuses change, then the run ends.
  nodeStatusFrames: [
    frame('1', 'node-status', { nodeId: 'review', status: 'started', attemptNumber: 1, startedAt: '2026-01-01T00:00:01Z' }),
    frame('2', 'node-status', { nodeId: 'review', status: 'completed', attemptNumber: 1, startedAt: '2026-01-01T00:00:01Z', completedAt: '2026-01-01T00:00:02Z' }),
    frame('3', 'stream-end', { status: 'Completed' }),
  ].join(''),
  // Held-open streams for the running and waiting-approval states: one frame, no stream-end.
  runningLive: frame('1', 'node-status', { nodeId: 'review', status: 'started', attemptNumber: 1, startedAt: '2026-01-01T00:00:01Z' }),
  waitingLive: frame('1', 'node-status', { nodeId: 'review', status: 'waiting-approval', attemptNumber: 1, startedAt: '2026-01-01T00:00:01Z' }),
  // The first connection ends after one frame without stream-end; the resumed one continues from it.
  dropFirst: frame('1', 'node-status', { nodeId: 'review', status: 'started', attemptNumber: 1, startedAt: '2026-01-01T00:00:01Z' }),
  resumed: [
    frame('2', 'node-status', { nodeId: 'review', status: 'completed', attemptNumber: 1, completedAt: '2026-01-01T00:00:02Z' }),
    frame('3', 'stream-end', { status: 'Completed' }),
  ].join(''),
}

export const deliberateChanges = [
  'The anonymous-key input is removed: a non-terminal run streams over the session Authorization header and no request URL carries a credential.',
  'A dropped stream turns the live indicator off and shows an inline notice; the client reconnects with Last-Event-ID.',
  'Enter and Space open the node inspector from the keyboard; Escape and Close return focus to the node.',
  'A failed action closes its confirmation dialog so the error beside the toolbar is visible.',
  '403 renders no-access with the backend reason, 404 renders not-found with a link to the run history, 500 shows status and request identifier.',
]
const manifest: ParityManifest = {
  route: runRoute, roles: ['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'], endpoints: runEndpoints,
  fixtures: ['shell:no-workspace', 'refresh:success', 'refresh:401', 'flows.events.sse.node-status-frames', 'flows.events.sse.drop-then-resume', 'flows.events.sse.error', 'flows.get.no-definition',
    ...Object.keys(runEndpoints).flatMap((name) => variants.map((variant) => `${name}:${variant}`))],
  sources: ['src/pages/consoleFlowRun.tsx', 'src/pages/consoleFlowRun'],
  data: [{ name: 'run title', locator: 'h1:text-is("Synthetic flow")' }], actions: [],
  states: [
    { fixture: 'flows.run.execution', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a esta ejecución")', en: 'h2:text-is("You do not have access to this run")' } },
    { fixture: 'flows.run.execution', variant: '404', locator: { es: 'h2:text-is("Ejecución no encontrada")', en: 'h2:text-is("Run not found")' } },
    { fixture: 'flows.run.execution', variant: '500', locator: { es: 'h2:text-is("No se pudo cargar la ejecución")', en: 'h2:text-is("Could not load the run")' } },
    { fixture: 'flows.run.execution', variant: 'network', locator: { es: 'h2:text-is("No se pudo cargar la ejecución")', en: 'h2:text-is("Could not load the run")' } },
  ],
}
export default manifest

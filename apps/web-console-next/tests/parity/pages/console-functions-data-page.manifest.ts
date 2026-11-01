import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'

const workspace = 'synthetic-workspace'
export const actionsPath = `/v1/functions/workspaces/${workspace}/actions`
export const deployPath = '/v1/functions/actions'
export const invokePath = '/v1/functions/actions/synthetic-function-2/invocations'
export const activationsPath = '/v1/functions/actions/synthetic-function-2/activations'
const record = (resourceId: string, actionName: string, runtime: string) => ({
  resourceId, actionName, tenantId: 'synthetic-tenant', workspaceId: workspace, execution: { runtime }, status: 'active',
})
export const actions2 = { items: [record('synthetic-function-1', 'synthetic-user-hook', 'nodejs:20'), record('synthetic-function-2', 'synthetic-billing', 'python:3.12')] }
export const deployedRecord = record('synthetic-function-3', 'hello', 'nodejs:20')
export const actions3 = { items: [...actions2.items, deployedRecord] }
export const actions60 = { items: Array.from({ length: 60 }, (_, index) => record(`synthetic-function-${index + 1}`, `synthetic-fn-${String(index + 1).padStart(2, '0')}`, 'nodejs:20')) }
export const deployAccepted = { acceptedAt: '2026-06-01T12:00:00Z', correlationId: 'synthetic-corr-deploy', family: 'functions', requestId: 'req_synthetic_deploy_ok', resourceId: 'synthetic-function-3', resourceType: 'function_action', status: 'accepted' }
export const invokeResult = { result: { greeting: 'synthetic-hello', count: 2 }, activationId: 'synthetic-activation-1', durationMs: 12 }
export const activations3 = { items: [
  { activationId: 'synthetic-activation-1', status: 'success', startedAt: '2026-06-01T11:59:00Z', durationMs: 12 },
  { activationId: 'synthetic-activation-2', status: 'failed', startedAt: '2026-06-01T11:58:00Z', durationMs: 340 },
  { activationId: 'synthetic-activation-3', status: 'running', startedAt: '2026-06-01T11:57:00Z' },
] }
export const activationsRefreshed = { items: [
  { activationId: 'synthetic-activation-4', status: 'success', startedAt: '2026-06-01T12:00:00Z', durationMs: 7 },
  ...activations3.items,
] }
const failure = (status: number, requestId: string): EndpointResponse => ({ status, body: { status, code: `HTTP_${status}`, message: 'synthetic-error', requestId } })

export const actionsFixtures: Record<string, EndpointResponse> = {
  'actions-2': { body: actions2 }, 'actions-3': { body: actions3 }, 'actions-60': { body: actions60 },
  'actions-empty': { body: { items: [] } }, 'actions-network': { network: true },
  'actions-401': { status: 401, body: { status: 401, code: 'HTTP_401', message: 'synthetic-error' } },
  'actions-403': failure(403, 'req_synthetic_actions_403'),
  'actions-500': failure(500, 'req_synthetic_actions_500'),
}
export const deployFixtures: Record<string, EndpointResponse> = {
  'deploy-accepted': { body: deployAccepted }, 'deploy-500': failure(500, 'req_synthetic_deploy_500'), 'deploy-network': { network: true },
}
export const invokeFixtures: Record<string, EndpointResponse> = {
  'invoke-result': { body: invokeResult }, 'invoke-404': failure(404, 'req_synthetic_invoke_404'),
  'invoke-500': failure(500, 'req_synthetic_invoke_500'), 'invoke-network': { network: true },
}
export const activationsFixtures: Record<string, EndpointResponse> = {
  'activations-3': { body: activations3 }, 'activations-empty': { body: { items: [] } },
  'activations-3-refreshed': { body: activationsRefreshed },
  'activations-500': failure(500, 'req_synthetic_activations_500'), 'activations-network': { network: true },
}
const alias = (fixtures: Record<string, EndpointResponse>) => ({ success: Object.values(fixtures)[0], ...fixtures })
export const functionsDataEndpoints: Record<string, PageEndpoint> = {
  'functions-data-list': { method: 'GET', path: actionsPath, fixtures: alias(actionsFixtures) },
  'functions-data-deploy': { method: 'POST', path: deployPath, fixtures: alias(deployFixtures) },
  'functions-data-invoke': { method: 'POST', path: invokePath, fixtures: alias(invokeFixtures) },
  'functions-data-activations': { method: 'GET', path: activationsPath, fixtures: alias(activationsFixtures) },
}
const manifest: ParityManifest = {
  route: '/console/functions/data', roles: ['superadmin', 'tenant_viewer'], endpoints: functionsDataEndpoints,
  fixtures: [
    ...[...Object.keys(actionsFixtures), ...Object.keys(deployFixtures), ...Object.keys(invokeFixtures), ...Object.keys(activationsFixtures)].map((key) => `functions-data:${key}`),
    'shell:tenant-none', 'shell:workspace-none',
  ],
  sources: ['src/pages/consoleFunctionsData.tsx', 'src/pages/consoleFunctionsData'],
  data: [{ name: 'quick-deploy', locator: '[data-testid="console-functions-data-page"] h1' }], actions: [],
  states: [
    { fixture: 'functions-data-list', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a las funciones de esta área de trabajo")', en: 'h2:text-is("You do not have access to this workspace’s functions")' } },
    { fixture: 'functions-data-list', variant: '500', locator: { es: 'h3:text-is("No se pudieron cargar las funciones.")', en: 'h3:text-is("Could not load functions.")' } },
  ],
}
export default manifest

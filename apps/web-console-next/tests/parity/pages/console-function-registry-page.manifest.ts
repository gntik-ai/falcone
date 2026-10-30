import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
export const functionsPath = '/v1/workspaces/synthetic-workspace/functions'
const record = (id: string, name: string, runtime: string, handler: string | null, status: string, runtime_status: string) => ({ id, name, runtime, handler, status, runtime_status, workspace_id: 'synthetic-workspace', source_ref: null, created_at: '2026-06-01T12:00:00Z' })
export const functionRows = { items: [
  record('synthetic-function-1', 'synthetic-user-hook', 'nodejs:20', null, 'registered', 'pending_data_plane'),
  record('synthetic-function-2', 'synthetic-billing', 'nodejs:18', 'run', 'accepted', 'provisioning'),
  record('synthetic-function-3', 'synthetic-report', 'python:3.12', 'report', 'custom_status', 'custom_runtime_status'),
], total: 3 }
export const registeredFunction = record('synthetic-function-4', 'on-user-created', 'nodejs:20', 'main', 'registered', 'pending_data_plane')
export const functionRows4 = { items: [...functionRows.items, registeredFunction], total: 4 }
export const functionFixtures: Record<string, EndpointResponse> = {
  'list-3': { body: functionRows }, 'list-4': { body: functionRows4 }, 'list-empty': { body: { items: [], total: 0 } },
  'list-pending': { body: functionRows, delayMs: 1500 }, 'register-accepted': { body: registeredFunction },
  ...Object.fromEntries([401, 403, 404, 500].map((status) => [`list-${status}`, { status, body: { requestId: 'req_synthetic_functions' } }])),
  'list-network': { network: true }, 'register-network': { network: true },
  'register-500': { status: 500, body: { requestId: 'req_synthetic_register' } },
}
export const functionEndpoints: Record<string, PageEndpoint> = {
  'function-registry': { method: 'GET', path: functionsPath, fixtures: { success: functionFixtures['list-3'], ...Object.fromEntries(Object.entries(functionFixtures).filter(([key]) => key.startsWith('list-'))) } },
  'function-register': { method: 'POST', path: functionsPath, fixtures: { success: functionFixtures['register-accepted'], ...Object.fromEntries(Object.entries(functionFixtures).filter(([key]) => key.startsWith('register-'))) } },
}
const manifest: ParityManifest = {
  route: '/console/functions-registry', roles: ['superadmin', 'tenant_viewer'], endpoints: functionEndpoints,
  fixtures: [...Object.keys(functionFixtures).map((key) => `function-registry:${key}`), ...['loading', 'error', 'list', 'none'].map((key) => `shell:workspaces-${key}`)], sources: ['src/pages/consoleFunctionRegistry.tsx', 'src/pages/consoleFunctionRegistry'],
  data: [{ name: 'registry', locator: '[data-testid="console-function-registry-page"] h1' }], actions: [],
  states: [
    { fixture: 'function-registry', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a las funciones de esta área de trabajo")', en: 'h2:text-is("You do not have access to this workspace’s functions")' } },
    { fixture: 'function-registry', variant: '404', locator: { es: 'h2:text-is("Área de trabajo no encontrada")', en: 'h2:text-is("Workspace not found")' } },
    { fixture: 'function-registry', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar las funciones del área de trabajo.")', en: 'h2:text-is("Could not load workspace functions.")' } },
  ],
}
export default manifest

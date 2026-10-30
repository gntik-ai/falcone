import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { McpServerDetailInput } from '../../../src/pages/consoleMcpServerDetail/api'

export const detailPath = '/v1/mcp/workspaces/synthetic-workspace/servers/srv_1'
export const callPath = `${detailPath}/tool-calls`
export const server: McpServerDetailInput = {
  id: 'srv_1', name: 'Acme Orders', slug: 'acme-orders', status: 'running', endpointUrl: 'https://gw.example.test/mcp/acme-orders',
  activeVersion: { version: 'v3', source: 'instant', tools: [
    { name: 'list_orders', description: 'list', mutates: false, scope: 'mcp:orders:read' },
    { name: 'update_order', description: 'update', mutates: true, suggestedScope: 'mcp:orders:write' },
  ] },
}
export const toolResult = { result: { content: [{ type: 'text', text: 'synthetic-tool-result' }] } }
export const variants = ['success', 'empty', 'no-endpoint', 'runtime-not-ready', '401', '403', '404', '500', 'network', 'loading']
export function detailResponse(variant: string): EndpointResponse {
  if (variant === 'network') return { network: true }
  if (/^\d+$/.test(variant)) return { status: Number(variant), body: { code: `HTTP_${variant}`, message: 'synthetic-backend-reason', requestId: 'req_synthetic_mcp' } }
  return { status: 200, body: {
    ...server,
    ...(variant === 'empty' ? { activeVersion: { version: 'v3', tools: [] } } : {}),
    ...(variant === 'no-endpoint' ? { endpointUrl: null } : {}),
    ...(variant === 'runtime-not-ready' ? { runtimeReady: false, runtimeDependency: { state: 'unavailable', reason: 'synthetic-runtime-reason' } } : {}),
  }, ...(variant === 'loading' ? { delayMs: 1500 } : {}) }
}
export const mcpEndpoints: Record<string, PageEndpoint> = {
  'mcp.server': { method: 'GET', path: detailPath, fixtures: Object.fromEntries(variants.map((variant) => [variant, detailResponse(variant)])) },
  'mcp.tool-call': { method: 'POST', path: callPath, fixtures: { success: { status: 200, body: toolResult }, '500': { status: 500, body: { message: 'synthetic-backend-reason' } } } },
}
export const deliberateChanges = [
  '403 renders localized in-page no-access without a raw backend reason.',
  '404 renders in-page not-found with an overview link and no retry.',
  '500 displays a request identifier only when supplied by the gateway.',
  'Cursor deeplinks are copyable code, with no anchor.',
]
const manifest: ParityManifest = {
  route: '/console/mcp/servers/srv_1', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'], endpoints: mcpEndpoints,
  fixtures: ['mcp:server-2-tools', 'mcp:tool-call-ok', 'mcp:tool-call-500', 'shell:workspace-active', 'shell:workspace-none', ...variants.map((variant) => `mcp.server:${variant}`)],
  sources: ['src/pages/consoleMcpServerDetail.tsx', 'src/pages/consoleMcpServerDetail'],
  data: [{ name: 'server name', locator: 'h1:text-is("Acme Orders")' }],
  actions: [{ name: 'invoke list_orders', trigger: [{ es: '[role="tab"]:text-is("Área de pruebas")', en: '[role="tab"]:text-is("Test area")' }, { es: 'button:text-is("Invocar")', en: 'button:text-is("Invoke")' }], expected: { method: 'POST', path: callPath, body: { name: 'list_orders', arguments: {} } }, outcome: 'text=synthetic-tool-result' }],
  states: [
    { fixture: 'mcp.server', variant: 'empty', locator: { es: 'h3:text-is("Sin herramientas publicadas todavía.")', en: 'h3:text-is("No tools published yet.")' } },
    { fixture: 'mcp.server', variant: '403', locator: { es: 'h2:text-is("No tienes permiso para acceder a este servidor MCP")', en: 'h2:text-is("You do not have permission to access this MCP server")' } },
    { fixture: 'mcp.server', variant: '404', locator: { es: 'h2:text-is("Servidor MCP no encontrado")', en: 'h2:text-is("MCP server not found")' } },
    { fixture: 'mcp.server', variant: '500', locator: { es: 'h2:text-is("No se pudo cargar el servidor MCP")', en: 'h2:text-is("Could not load MCP server")' } },
  ],
}
export default manifest

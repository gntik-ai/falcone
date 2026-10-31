import { newPages, type ParityManifest } from '../manifest'
import { detailPath, server } from './console-mcp-server-detail-page.manifest'

export const listPath = '/v1/mcp/workspaces/synthetic-workspace/servers'
export const serverRows = { items: [
  { serverId: 'srv_1', name: 'Acme Orders', status: 'published', lifecycleStatus: 'active', version: 'v3' },
  { serverId: 'srv_2', name: '', status: 'draft', lifecycleStatus: 'active', version: null },
] }
const manifest = {
  ...newPages['console-mcp-servers-page'],
  roles: ['superadmin', 'tenant_viewer', 'workspace_viewer'],
  endpoints: {
    'mcp.list': { method: 'GET', path: listPath, fixtures: {
      success: { body: serverRows }, empty: { body: { items: [] } },
    } },
    'mcp.detail': { method: 'GET', path: detailPath, fixtures: { success: { body: server } } },
  },
  fixtures: ['mcp.list:success', 'mcp.list:empty', 'mcp.list:401', 'mcp.list:403', 'mcp.list:404', 'mcp.list:500', 'mcp.list:network', 'shell:workspace-active', 'shell:workspace-none'],
  sources: ['src/pages/consoleMcpServers.tsx', 'src/pages/consoleMcpServers'],
  data: [{ name: 'server name', locator: 'a:text-is("Acme Orders")' }, { name: 'id fallback', locator: 'a:text-is("srv_2")' }],
  actions: [],
  states: [
    { fixture: 'mcp.list', variant: 'empty', locator: { es: 'h2:text-is("No hay servidores MCP")', en: 'h2:text-is("No MCP servers")' } },
    { fixture: 'mcp.list', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a los servidores MCP")', en: 'h2:text-is("You do not have access to MCP servers")' } },
    { fixture: 'mcp.list', variant: '404', locator: { es: 'h2:text-is("MCP no está disponible")', en: 'h2:text-is("MCP is not available")' } },
    { fixture: 'mcp.list', variant: '500', locator: { es: 'h2:text-is("No se pudieron cargar los servidores MCP")', en: 'h2:text-is("Could not load MCP servers")' } },
  ],
} satisfies ParityManifest & { legacyRoute: null }
export default manifest

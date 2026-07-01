import type { SnippetEntry } from '@/lib/snippets/snippet-types'

/**
 * MCP "Connect" snippets (issue #397, epic #386).
 *
 * Pure, deterministic generation of the client-config snippets a tenant copies to connect an MCP
 * client to their Falcone-hosted server: a one-click "Add to Cursor" deeplink plus copy-paste
 * config blocks for Claude Code, claude.ai custom connectors and VS Code. Reuses the SnippetEntry
 * shape so the existing <ConnectionSnippets entries=… /> component renders them unchanged.
 *
 * Transport is Streamable HTTP (the remote MCP transport, 2025-11-25 stable). Authentication is the
 * per-tenant OAuth 2.1 flow (#390) — there is NO static secret embedded in these configs; the client
 * performs the OAuth dance against the endpoint, so `hasPlaceholderSecrets` is false.
 */

export interface McpServerConnectInfo {
  /** Display name of the server (e.g. "Acme Orders"). */
  name: string | null
  /** Stable slug used as the client-side server key; derived from the name when absent. */
  slug?: string | null
  /** The public Streamable-HTTP endpoint (through the gateway). Null → placeholder + note. */
  endpoint: string | null
}

const ENDPOINT_PLACEHOLDER = '<MCP_ENDPOINT>'
const OAUTH_NOTE = 'La autenticación usa el flujo OAuth 2.1 de la organización; el cliente la completa al conectar (no se incrusta ningún secreto en la configuración).'
const ENDPOINT_NOTE = 'El punto de conexión aún no está publicado en esta vista; usa el marcador temporal y actualízalo cuando el servidor esté disponible.'

function slugify(value: string | null | undefined): string {
  const base = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return base || 'mcp-server'
}

/** Latin1-safe base64 (browser/jsdom expose btoa; endpoint URLs are ASCII). */
function base64(input: string): string {
  const g = globalThis as { btoa?: (s: string) => string }
  return typeof g.btoa === 'function' ? g.btoa(input) : ENDPOINT_PLACEHOLDER
}

/**
 * Build the Connect-tab snippets for an MCP server.
 * @param info server name/slug/endpoint
 * @returns SnippetEntry[] (Cursor deeplink, Claude Code, claude.ai, VS Code)
 */
export function generateMcpConnectSnippets(info: McpServerConnectInfo): SnippetEntry[] {
  const slug = slugify(info.slug ?? info.name)
  const endpoint = info.endpoint ?? ENDPOINT_PLACEHOLDER
  const endpointMissing = info.endpoint == null
  const notes = (extra: string[] = []): string[] =>
    Array.from(new Set([OAUTH_NOTE, ...(endpointMissing ? [ENDPOINT_NOTE] : []), ...extra]))

  // Cursor consumes a base64-encoded remote-server config in the deeplink.
  const cursorConfig = base64(JSON.stringify({ url: endpoint }))
  const cursorDeeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(slug)}&config=${cursorConfig}`

  const claudeCodeConfig = JSON.stringify(
    { mcpServers: { [slug]: { type: 'http', url: endpoint } } },
    null,
    2
  )
  const vscodeConfig = JSON.stringify(
    { servers: { [slug]: { type: 'http', url: endpoint } } },
    null,
    2
  )

  return [
    {
      id: 'mcp-cursor-deeplink',
      label: 'Cursor — Añadir a Cursor',
      code: cursorDeeplink,
      notes: notes(['Pega el enlace en el navegador o publícalo como botón "Add to Cursor"; Cursor abrirá el diálogo de instalación del servidor.']),
      hasPlaceholderSecrets: false,
      secretPlaceholderRef: null
    },
    {
      id: 'mcp-claude-code',
      label: 'Claude Code — .mcp.json',
      code: claudeCodeConfig,
      notes: notes(['Guárdalo como .mcp.json en la raíz del proyecto, o ejecuta: claude mcp add --transport http ' + slug + ' ' + endpoint]),
      hasPlaceholderSecrets: false,
      secretPlaceholderRef: null
    },
    {
      id: 'mcp-claude-ai',
      label: 'claude.ai — Conector personalizado',
      code: endpoint,
      notes: notes(['En claude.ai abre Configuración → Conectores → Añadir conector personalizado y pega esta URL del servidor remoto.']),
      hasPlaceholderSecrets: false,
      secretPlaceholderRef: null
    },
    {
      id: 'mcp-vscode',
      label: 'VS Code — .vscode/mcp.json',
      code: vscodeConfig,
      notes: notes(['Guárdalo como .vscode/mcp.json en la carpeta del proyecto para registrar el servidor en VS Code.']),
      hasPlaceholderSecrets: false,
      secretPlaceholderRef: null
    }
  ]
}

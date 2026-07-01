import { useMemo } from 'react'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { generateMcpConnectSnippets } from '@/lib/mcp/mcp-connect-snippets'

/**
 * Connect tab for an MCP server (issue #397): a one-click "Add to Cursor" deeplink plus copy-paste
 * config for Claude Code, claude.ai and VS Code. Delegates rendering to the existing
 * <ConnectionSnippets> by feeding it the MCP connect snippets.
 */
interface McpServerConnectPanelProps {
  name: string | null
  slug?: string | null
  endpoint: string | null
}

export function McpServerConnectPanel({ name, slug, endpoint }: McpServerConnectPanelProps) {
  const entries = useMemo(() => generateMcpConnectSnippets({ name, slug, endpoint }), [name, slug, endpoint])

  return (
    <div className="space-y-4" data-testid="mcp-connect-panel">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Conecta tu cliente</h3>
        <p className="text-sm text-muted-foreground">
          Transporte HTTP remoto (Streamable HTTP). La autenticación usa el flujo OAuth 2.1 de la organización.
        </p>
      </div>
      <ConnectionSnippets entries={entries} />
    </div>
  )
}

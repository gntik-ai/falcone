import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { McpServerConnectPanel } from '@/components/console/mcp/McpServerConnectPanel'
import { McpServerPlayground } from '@/components/console/mcp/McpServerPlayground'
import { fetchMcpServerDetail } from '@/lib/mcp/mcp-api'
import { toMcpServerDetailViewModel, type McpServerDetailView } from '@/lib/mcp/mcp-server-detail'

/**
 * MCP server detail page (issue #397): endpoint + status + active version + curated tool list,
 * with a Connect tab (client snippets) and an interactive Playground tab.
 */
type Tab = 'connect' | 'playground'

export function ConsoleMcpServerDetailPage() {
  const { mcpServerId = '' } = useParams<{ mcpServerId: string }>()
  const [view, setView] = useState<McpServerDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('connect')

  useEffect(() => {
    if (!mcpServerId) return undefined
    const controller = new AbortController()
    setError(null)
    setView(null)
    fetchMcpServerDetail(mcpServerId, controller.signal)
      .then((payload) => setView(toMcpServerDetailViewModel(payload)))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'No se pudo cargar el servidor MCP.')
      })
    return () => controller.abort()
  }, [mcpServerId])

  const tools = useMemo(() => view?.tools ?? [], [view])

  if (error) {
    return <p className="text-sm text-destructive" role="alert">{error}</p>
  }
  if (!view) {
    return <p className="text-sm text-muted-foreground" data-testid="mcp-detail-loading">Cargando servidor MCP…</p>
  }

  return (
    <section className="space-y-6" data-testid="mcp-server-detail">
      <header className="space-y-3">
        <h2 className="text-2xl font-semibold text-foreground">{view.name ?? mcpServerId}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Endpoint</dt>
            <dd className="break-all text-sm text-foreground" data-testid="mcp-detail-endpoint">{view.endpoint ?? 'No publicado'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Versión activa</dt>
            <dd className="text-sm text-foreground" data-testid="mcp-detail-version">{view.version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Estado</dt>
            <dd className="text-sm text-foreground">{view.status ?? '—'}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="mcp-tools-heading" className="space-y-2">
        <h3 id="mcp-tools-heading" className="text-lg font-semibold text-foreground">Herramientas curadas</h3>
        {tools.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin herramientas publicadas todavía.</p>
        ) : (
          <ul className="space-y-1" data-testid="mcp-detail-tools">
            {tools.map((tool) => (
              <li key={tool.name} className="rounded-md border border-border/70 bg-background/70 p-2 text-sm">
                <span className="font-medium text-foreground">{tool.name}</span>
                {tool.mutates ? <span className="ml-2 text-xs text-amber-600">muta</span> : null}
                {tool.description ? <span className="ml-2 text-muted-foreground">— {tool.description}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="tablist" aria-label="MCP server tabs" className="flex gap-2">
        {(['connect', 'playground'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={
              tab === value
                ? 'rounded-md bg-foreground px-3 py-1 text-sm font-medium text-background'
                : 'rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground'
            }
            onClick={() => setTab(value)}
          >
            {value === 'connect' ? 'Connect' : 'Playground'}
          </button>
        ))}
      </div>

      {tab === 'connect' ? (
        <McpServerConnectPanel name={view.name} slug={view.slug} endpoint={view.endpoint} />
      ) : (
        <McpServerPlayground serverId={view.id ?? mcpServerId} tools={tools} endpoint={view.endpoint} />
      )}
    </section>
  )
}

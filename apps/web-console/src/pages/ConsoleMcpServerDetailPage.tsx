import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { McpServerConnectPanel } from '@/components/console/mcp/McpServerConnectPanel'
import { McpServerPlayground } from '@/components/console/mcp/McpServerPlayground'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { fetchMcpServerDetail } from '@/lib/mcp/mcp-api'
import { toMcpServerDetailViewModel, type McpServerDetailView } from '@/lib/mcp/mcp-server-detail'

/**
 * MCP server detail page (issue #397): endpoint + status + active version + curated tool list,
 * with a Connect tab (client snippets) and an interactive Playground tab.
 */
type Tab = 'connect' | 'playground'

const tabs: Array<{ value: Tab; label: string }> = [
  { value: 'connect', label: 'Connect' },
  { value: 'playground', label: 'Playground' }
]

function getTabId(tab: Tab) {
  return `mcp-server-${tab}-tab`
}

function getPanelId(tab: Tab) {
  return `mcp-server-${tab}-panel`
}

export function ConsoleMcpServerDetailPage() {
  const { mcpServerId = '' } = useParams<{ mcpServerId: string }>()
  const { activeWorkspaceId, workspacesLoading } = useConsoleContext()
  const [view, setView] = useState<McpServerDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('connect')

  useEffect(() => {
    setError(null)
    setView(null)

    if (!mcpServerId || !activeWorkspaceId) return undefined

    const controller = new AbortController()
    fetchMcpServerDetail(activeWorkspaceId, mcpServerId, controller.signal)
      .then((payload) => setView(toMcpServerDetailViewModel(payload)))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'No se pudo cargar el servidor MCP.')
      })
    return () => controller.abort()
  }, [activeWorkspaceId, mcpServerId])

  const tools = useMemo(() => view?.tools ?? [], [view])

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, value: Tab) {
    const currentIndex = tabs.findIndex((item) => item.value === value)
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1

    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = tabs[nextIndex].value
    setTab(nextTab)
    requestAnimationFrame(() => document.getElementById(getTabId(nextTab))?.focus())
  }

  if (!activeWorkspaceId) {
    if (workspacesLoading) {
      return (
        <div data-testid="mcp-detail-loading">
          <ConsolePageState
            kind="loading"
            title="Cargando workspace"
            description="Estamos resolviendo el workspace activo antes de cargar el servidor MCP."
          />
        </div>
      )
    }
    return (
      <div data-testid="mcp-detail-no-workspace">
        <ConsolePageState
          kind="empty"
          title="Selecciona un workspace"
          description="El detalle y el playground del servidor MCP se cargan para el workspace activo. Selecciona un workspace para continuar."
        />
      </div>
    )
  }

  if (error) {
    return (
      <ConsolePageState
        kind="error"
        title="No se pudo cargar el servidor MCP"
        description={error}
      />
    )
  }
  if (!view) {
    return (
      <div data-testid="mcp-detail-loading">
        <ConsolePageState
          kind="loading"
          title="Cargando servidor MCP"
          description="Estamos cargando el endpoint, la versión activa y las herramientas curadas."
        />
      </div>
    )
  }

  return (
    <section className="space-y-6" data-testid="mcp-server-detail" aria-labelledby="mcp-server-detail-heading">
      <header className="space-y-3">
        <h2 id="mcp-server-detail-heading" className="text-2xl font-semibold text-foreground">{view.name ?? mcpServerId}</h2>
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
            <dd className="text-sm text-foreground" data-testid="mcp-detail-status">
              <Badge variant="outline">{view.status ?? 'Sin estado'}</Badge>
            </dd>
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{tool.name}</span>
                  {tool.mutates ? <Badge variant="secondary" className="border border-amber-500/40 bg-amber-500/10 text-amber-700">Muta estado</Badge> : null}
                  {tool.scope ? <Badge variant="outline">Scope: {tool.scope}</Badge> : null}
                </div>
                {tool.description ? <p className="mt-1 text-muted-foreground">{tool.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="tablist" aria-label="Servidor MCP" className="flex flex-wrap gap-2">
        {tabs.map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            role="tab"
            id={getTabId(value)}
            aria-controls={getPanelId(value)}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            variant={tab === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab(value)}
            onKeyDown={(event) => handleTabKeyDown(event, value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <section
        role="tabpanel"
        id={getPanelId(tab)}
        aria-labelledby={getTabId(tab)}
        tabIndex={0}
        className="outline-none"
      >
        {tab === 'connect' ? (
          <McpServerConnectPanel name={view.name} slug={view.slug} endpoint={view.endpoint} />
        ) : (
          <McpServerPlayground
            workspaceId={activeWorkspaceId}
            serverId={view.id ?? mcpServerId}
            tools={tools}
            endpoint={view.endpoint}
          />
        )}
      </section>
    </section>
  )
}

// Flow list page (change: add-console-flow-designer).
//
// Lists the active workspace's flows and creates new drafts, then hands off to the
// canvas designer at /console/flows/:flowId. Lazy-loaded from router.tsx so the
// @xyflow/react chunk stays out of the initial shell bundle.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { History, PenLine } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConsoleContext } from '@/lib/console-context'
import { createFlowDraft, listFlows, type FlowSummary } from '@/services/flowsApi'

const FLOW_STATUS_LABELS: Record<string, string> = {
  archived: 'Archivado',
  draft: 'Borrador',
  failed: 'Fallido',
  published: 'Publicado'
}

function formatTimestamp(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatFlowStatus(status?: string | null): string {
  return status ? FLOW_STATUS_LABELS[status] ?? status : FLOW_STATUS_LABELS.draft
}

export function ConsoleFlowsPage() {
  const navigate = useNavigate()
  const { activeWorkspaceId } = useConsoleContext()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newFlowName, setNewFlowName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return
    setLoading(true)
    setLoadError(null)
    try {
      const response = await listFlows(activeWorkspaceId)
      setFlows(response.items ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los flujos')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    if (!activeWorkspaceId || !newFlowName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createFlowDraft(activeWorkspaceId, { name: newFlowName.trim() })
      navigate(`/console/flows/${encodeURIComponent(created.flowId)}`)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'No se pudo crear el borrador del flujo')
      setCreating(false)
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="space-y-2 p-6">
        <h1 className="text-xl font-semibold">Flujos</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona un área de trabajo para gestionar sus flujos.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-5 p-6" data-testid="console-flows-page">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1">
          <Badge variant="outline" className="w-fit">Flujos</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">Flujos</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Definiciones visuales de flujos de trabajo para el área de trabajo <span className="font-mono">{activeWorkspaceId}</span>.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="w-full sm:w-64">
            <Input
              aria-label="Nombre del flujo nuevo"
              className="w-full"
              placeholder="Nombre del flujo nuevo"
              value={newFlowName}
              onChange={(event) => setNewFlowName(event.target.value)}
              data-testid="new-flow-name-input"
            />
          </div>
          <Button className="w-full sm:w-auto" onClick={() => void onCreate()} disabled={creating || newFlowName.trim() === ''}>
            {creating ? 'Creando…' : 'Flujo nuevo'}
          </Button>
        </div>
      </header>

      {createError ? <p className="text-sm text-destructive">{createError}</p> : null}

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : loadError ? (
        <div className="space-y-2 rounded-lg border border-destructive/40 p-4 text-sm">
          <p className="text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : flows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Todavía no hay flujos. Crea el primero para abrir el diseñador.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full table-fixed text-sm sm:min-w-[48rem] sm:table-auto">
            <caption className="sr-only">Flujos del área de trabajo</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Estado</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Última modificación</th>
                <th scope="col" className="w-40 px-4 py-3 text-right font-medium sm:w-64">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((flow) => {
                const encodedFlowId = encodeURIComponent(flow.flowId)
                const flowLabel = flow.name || flow.flowId

                return (
                  <tr key={flow.flowId} className="border-t border-border transition-colors hover:bg-muted/20" data-testid="flow-row">
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      <span className="block max-w-[10rem] truncate sm:max-w-[18rem]" title={flowLabel}>{flowLabel}</span>
                    </th>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <Badge variant="outline" className="text-xs">
                        {formatFlowStatus(flow.status)}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      {formatTimestamp(flow.updatedAt ?? flow.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div
                        className="inline-flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-end"
                        role="group"
                        aria-label={`Acciones para ${flowLabel}`}
                      >
                        <Button size="sm" variant="outline" className="justify-start sm:justify-center" asChild>
                          <Link
                            to={`/console/flows/${encodedFlowId}`}
                            aria-label={`Abrir diseñador para ${flowLabel}`}
                          >
                            <PenLine className="h-4 w-4" aria-hidden="true" />
                            Abrir diseñador
                          </Link>
                        </Button>
                        <Button size="sm" variant="secondary" className="justify-start sm:justify-center" asChild>
                          <Link
                            to={`/console/flows/${encodedFlowId}/runs`}
                            aria-label={`Ver historial de ejecuciones para ${flowLabel}`}
                          >
                            <History className="h-4 w-4" aria-hidden="true" />
                            Historial de ejecuciones
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

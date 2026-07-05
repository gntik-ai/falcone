// Console flow run-view page (change: add-console-flow-monitoring / #366).
//
// Places the #363 designer canvas in read-only run mode with per-node status badges fed by the
// live SSE stream (useFlowExecution), a node detail panel on click, and the cancel/retry/approval
// action toolbar. A completed/terminal run renders statically from the persisted execution detail
// without an open SSE connection (spec "Completed run rendered from history"); a live run opens the
// SSE stream (the user supplies the anon key, mirroring the realtime console) and transitions to
// static mode on `stream-end`.
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'

import { RunCanvas } from '@/components/flows/RunCanvas'
import { RunActionToolbar, type WaitingApprovalNode } from '@/components/flows/RunActionToolbar'
import { RunNodeDetailPanel } from '@/components/flows/RunNodeDetailPanel'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { RunStatusBadge } from '@/components/flows/FlowStatusBadge'
import { Input } from '@/components/ui/input'
import { useConsoleContext } from '@/lib/console-context'
import { useFlowExecution, type NodeStatusSnapshot } from '@/lib/hooks/use-flow-execution'
import { getFlow, type FlowDefinitionRecord } from '@/services/flowsApi'
import {
  getExecution,
  isTerminalExecution,
  type ExecutionDetail
} from '@/services/flowsMonitoringApi'
import type { FlowDefinition } from '@/types/flows'

// Build the static per-node status map for a terminal run from its persisted detail (the SSE
// stream is not opened for a completed run). Each node detail entry's status seeds the badge.
function staticStatusesFromDetail(detail: ExecutionDetail | null): Map<string, NodeStatusSnapshot> {
  const map = new Map<string, NodeStatusSnapshot>()
  for (const node of detail?.nodes ?? []) {
    if (!node.status) continue
    map.set(node.nodeId, {
      nodeId: node.nodeId,
      status: node.status,
      attemptNumber: node.attempts?.at(-1)?.attemptNumber ?? 1,
      startedAt: node.attempts?.[0]?.startedAt ?? null,
      completedAt: node.attempts?.at(-1)?.completedAt ?? null,
      error: node.error ?? null
    })
  }
  return map
}

function RunView({
  workspaceId,
  flowId,
  executionId
}: {
  workspaceId: string
  flowId: string
  executionId: string
}) {
  const navigate = useNavigate()
  const [record, setRecord] = useState<FlowDefinitionRecord | null>(null)
  const [detail, setDetail] = useState<ExecutionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const apiKeyInputId = useId()
  const apiKeyHelpId = useId()
  const encodedFlowId = encodeURIComponent(flowId)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [flow, exec] = await Promise.all([
        getFlow(workspaceId, flowId),
        getExecution(workspaceId, flowId, executionId)
      ])
      setRecord(flow)
      setDetail(exec)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la ejecución.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, flowId, executionId])

  useEffect(() => {
    void load()
  }, [load])

  const terminal = isTerminalExecution(detail?.status)
  // Open the live stream only for a non-terminal run AND once the user supplied an anon key.
  const streamEnabled = !terminal && apiKey.trim() !== ''

  const live = useFlowExecution({
    workspaceId,
    executionId,
    apiKey: apiKey.trim(),
    enabled: streamEnabled
  })

  // Merge static (persisted) statuses with the live stream — live wins per node.
  const nodeStatuses = useMemo(() => {
    const merged = new Map(staticStatusesFromDetail(detail))
    for (const [nodeId, snapshot] of live.nodeStatuses) merged.set(nodeId, snapshot)
    return merged
  }, [detail, live.nodeStatuses])

  // When the live stream signals stream-end the run is terminal: refresh the detail for the final
  // static render (output payloads, attempt history).
  useEffect(() => {
    if (live.ended) void load()
  }, [live.ended, load])

  const definition: FlowDefinition | null = record?.definition ?? null

  // Detect a waiting human-approval node so the toolbar shows Approve/Reject only then.
  const waitingApproval: WaitingApprovalNode | null = useMemo(() => {
    for (const [nodeId, snapshot] of nodeStatuses) {
      if (snapshot.status === 'waiting-approval') return { nodeId, signalName: nodeId }
    }
    return null
  }, [nodeStatuses])

  const selectedDetail = useMemo(
    () => detail?.nodes?.find((node) => node.nodeId === selectedNodeId) ?? null,
    [detail, selectedNodeId]
  )

  if (loadError && record === null) {
    return (
      <section className="p-6" data-testid="run-load-error">
        <ConsolePageState
          kind="error"
          title="No se pudo cargar la ejecución"
          description={loadError}
          actionLabel="Reintentar"
          onAction={() => void load()}
        />
      </section>
    )
  }

  if (loading && record === null) {
    return (
      <section className="p-6">
        <ConsolePageState
          kind="loading"
          title="Cargando ejecución"
          description="Consultando la definición del flujo y el detalle de la ejecución."
        />
      </section>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col" data-testid="console-flow-run-page">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Link className="text-sm text-muted-foreground hover:underline" to="/console/flows">
            Flujos
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link className="text-sm text-muted-foreground hover:underline" to={`/console/flows/${encodedFlowId}/runs`}>
            Ejecuciones
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="min-w-0 max-w-[16rem] truncate text-sm font-semibold" title={executionId}>
            {record?.name ?? flowId}
          </span>
          <RunStatusBadge status={detail?.status} />
          {!terminal ? (
            live.streaming ? (
              <span className="text-xs text-emerald-300" data-testid="run-streaming-indicator">
                En vivo
              </span>
            ) : (
              <>
                <label htmlFor={apiKeyInputId} className="sr-only">
                  Clave anónima para transmitir la ejecución en vivo
                </label>
                <Input
                  id={apiKeyInputId}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="clave anónima (flc_anon_…) para transmitir en vivo"
                  className="h-8 w-full min-w-[14rem] text-xs sm:w-64"
                  aria-describedby={apiKeyHelpId}
                  data-testid="run-apikey-input"
                />
                <span id={apiKeyHelpId} className="sr-only">
                  Introduce una clave anónima para abrir el stream en vivo; los estados históricos siguen visibles sin la clave.
                </span>
              </>
            )
          ) : (
            <span className="text-xs text-muted-foreground" data-testid="run-static-indicator">
              Estado final del historial
            </span>
          )}
        </div>
        {definition ? (
          <RunActionToolbar
            workspaceId={workspaceId}
            flowId={flowId}
            executionId={executionId}
            status={detail?.status}
            waitingApproval={waitingApproval}
            onCancelled={() => void load()}
            onSignalSent={() => void load()}
            onRetried={(newId) => navigate(`/console/flows/${encodedFlowId}/runs/${encodeURIComponent(newId)}`)}
          />
        ) : null}
      </header>
      {loadError && record !== null ? (
        <p className="border-b border-border bg-destructive/10 px-4 py-1 text-xs text-destructive">{loadError}</p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {definition ? (
          <RunCanvas
            definition={definition}
            nodeStatuses={nodeStatuses}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        ) : (
          <div className="w-full p-6">
            <ConsolePageState
              kind="empty"
              title="Sin definición de flujo"
              description="No hay definición de flujo disponible para esta ejecución."
            />
          </div>
        )}
        {selectedNodeId ? (
          <RunNodeDetailPanel
            nodeId={selectedNodeId}
            detail={selectedDetail}
            liveStatus={nodeStatuses.get(selectedNodeId) ?? null}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

export function ConsoleFlowRunPage() {
  const navigate = useNavigate()
  const { flowId, executionId } = useParams<{ flowId: string; executionId: string }>()
  const { activeWorkspaceId } = useConsoleContext()

  if (!flowId || !executionId) {
    return (
      <section className="p-6">
        <ConsolePageState
          kind="blocked"
          title="Ejecución bloqueada"
          description="Falta el identificador del flujo o de la ejecución."
          actionLabel="Volver a Flujos"
          onAction={() => navigate('/console/flows')}
        />
      </section>
    )
  }
  if (!activeWorkspaceId) {
    return (
      <section className="p-6">
        <WorkspaceRequiredState title="Ejecución bloqueada" description="Selecciona un área de trabajo para abrir la vista de ejecución." />
      </section>
    )
  }

  return (
    <RunView
      workspaceId={activeWorkspaceId}
      flowId={flowId}
      executionId={decodeURIComponent(executionId)}
    />
  )
}

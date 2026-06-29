// Console flow run-view page (change: add-console-flow-monitoring / #366).
//
// Places the #363 designer canvas in read-only run mode with per-node status badges fed by the
// live SSE stream (useFlowExecution), a node detail panel on click, and the cancel/retry/approval
// action toolbar. A completed/terminal run renders statically from the persisted execution detail
// without an open SSE connection (spec "Completed run rendered from history"); a live run opens the
// SSE stream (the user supplies the anon key, mirroring the realtime console) and transitions to
// static mode on `stream-end`.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'

import { RunCanvas } from '@/components/flows/RunCanvas'
import { RunActionToolbar, type WaitingApprovalNode } from '@/components/flows/RunActionToolbar'
import { RunNodeDetailPanel } from '@/components/flows/RunNodeDetailPanel'
import { Badge } from '@/components/ui/badge'
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [flow, exec] = await Promise.all([
        getFlow(workspaceId, flowId),
        getExecution(workspaceId, flowId, executionId)
      ])
      setRecord(flow)
      setDetail(exec)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load the run')
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
      <div className="space-y-2 p-6 text-sm">
        <p className="text-destructive" data-testid="run-load-error">
          {loadError}
        </p>
        <button type="button" className="text-xs underline" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col" data-testid="console-flow-run-page">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Link className="text-sm text-muted-foreground hover:underline" to="/console/flows">
            Flows
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link className="text-sm text-muted-foreground hover:underline" to={`/console/flows/${flowId}/runs`}>
            Runs
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold" title={executionId}>
            {record?.name ?? flowId}
          </span>
          <Badge variant="outline" className="text-xs" data-testid="run-status-badge">
            {detail?.status ?? 'unknown'}
          </Badge>
          {!terminal ? (
            live.streaming ? (
              <span className="text-xs text-emerald-600" data-testid="run-streaming-indicator">
                Live
              </span>
            ) : (
              <Input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="anon key (flc_anon_…) to stream live"
                className="h-8 w-64 text-xs"
                data-testid="run-apikey-input"
              />
            )
          ) : (
            <span className="text-xs text-muted-foreground" data-testid="run-static-indicator">
              Final state from history
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
            onRetried={(newId) => navigate(`/console/flows/${flowId}/runs/${encodeURIComponent(newId)}`)}
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
          <p className="p-6 text-sm text-muted-foreground">No flow definition available for this run.</p>
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
  const { flowId, executionId } = useParams<{ flowId: string; executionId: string }>()
  const { activeWorkspaceId } = useConsoleContext()

  if (!flowId || !executionId) {
    return <p className="p-6 text-sm text-muted-foreground">Missing flow or execution identifier.</p>
  }
  if (!activeWorkspaceId) {
    return <p className="p-6 text-sm text-muted-foreground">Select a workspace to open the run view.</p>
  }

  return (
    <RunView
      workspaceId={activeWorkspaceId}
      flowId={flowId}
      executionId={decodeURIComponent(executionId)}
    />
  )
}

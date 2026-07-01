// Run-view mutation actions (change: add-console-flow-monitoring / #366).
//
// Cancel / Retry / Approval-signal, each behind a ConfirmActionDialog and gated on execution state
// per the spec:
//   - Cancel: visible always, DISABLED on a terminal execution (task 6.2).
//   - Retry: HIDDEN on a non-terminal execution (task 6.4); on confirm navigates to the new run.
//   - Approve/Reject: rendered ONLY when an approval node is in `waiting-approval` (tasks 6.5/6.6).
// All actions call the #361 endpoints (cancellations / retries / signals), which audit server-side.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmActionDialog } from '@/components/flows/ConfirmActionDialog'
import {
  cancelExecution,
  retryExecution,
  sendApprovalSignal,
  isTerminalExecution
} from '@/services/flowsMonitoringApi'

export interface WaitingApprovalNode {
  nodeId: string
  // The signal name to address this approval node (the node id or the `human-approval` alias).
  signalName: string
}

export interface RunActionToolbarProps {
  workspaceId: string
  flowId: string
  executionId: string
  status: string | null | undefined
  // The approval node currently awaiting input, when any (drives the Approve/Reject controls).
  waitingApproval?: WaitingApprovalNode | null
  // Called after a successful cancel/signal so the run view can refresh / optimistically update.
  onCancelled?: () => void
  onSignalSent?: (decision: { approved: boolean; nodeId: string }) => void
  // Called with the new execution id after a successful retry so the page can navigate.
  onRetried?: (newExecutionId: string) => void
}

type PendingAction = 'cancel' | 'retry' | 'approve' | 'reject' | null

export function RunActionToolbar({
  workspaceId,
  flowId,
  executionId,
  status,
  waitingApproval,
  onCancelled,
  onSignalSent,
  onRetried
}: RunActionToolbarProps) {
  const [dialog, setDialog] = useState<PendingAction>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const terminal = isTerminalExecution(status)

  const close = () => {
    if (pending) return
    setDialog(null)
  }

  const runConfirm = async () => {
    setPending(true)
    setError(null)
    try {
      if (dialog === 'cancel') {
        await cancelExecution(workspaceId, flowId, executionId)
        onCancelled?.()
      } else if (dialog === 'retry') {
        const result = await retryExecution(workspaceId, flowId, executionId)
        onRetried?.(result.executionId)
      } else if ((dialog === 'approve' || dialog === 'reject') && waitingApproval) {
        const approved = dialog === 'approve'
        await sendApprovalSignal(workspaceId, flowId, executionId, waitingApproval.signalName, {
          approved,
          nodeId: waitingApproval.nodeId
        })
        onSignalSent?.({ approved, nodeId: waitingApproval.nodeId })
      }
      setDialog(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La acción falló')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="run-action-toolbar">
      {/* Cancel — always present, disabled on a terminal execution. */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setDialog('cancel')}
        disabled={terminal}
        data-testid="run-cancel-button"
      >
        Cancelar
      </Button>

      {/* Retry — only for a terminal execution. */}
      {terminal ? (
        <Button size="sm" variant="outline" onClick={() => setDialog('retry')} data-testid="run-retry-button">
          Reintentar
        </Button>
      ) : null}

      {/* Approve / Reject — only when an approval node is waiting. */}
      {waitingApproval ? (
        <>
          <Button size="sm" onClick={() => setDialog('approve')} data-testid="run-approve-button">
            Aprobar
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDialog('reject')} data-testid="run-reject-button">
            Rechazar
          </Button>
        </>
      ) : null}

      {error ? (
        <span className="text-xs text-destructive" data-testid="run-action-error">
          {error}
        </span>
      ) : null}

      <ConfirmActionDialog
        open={dialog === 'cancel'}
        title="Cancelar ejecución"
        description="Esto detiene el flujo de trabajo en ejecución de forma controlada. Las actividades en curso reciben una señal de cancelación."
        confirmLabel="Cancelar ejecución"
        cancelLabel="Mantener ejecución"
        destructive
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('cancel') : close())}
      />

      <ConfirmActionDialog
        open={dialog === 'retry'}
        title="Reintentar ejecución"
        description="Esto inicia una ejecución nueva con la misma versión del flujo y la entrada original del disparador. La ejecución original no cambia."
        confirmLabel="Iniciar reintento"
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('retry') : close())}
      />

      <ConfirmActionDialog
        open={dialog === 'approve'}
        title="Aprobar nodo"
        description={`Envía una señal de aprobación al nodo "${waitingApproval?.nodeId ?? ''}". El flujo de trabajo continúa después de la compuerta de aprobación.`}
        confirmLabel="Aprobar"
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('approve') : close())}
      />

      <ConfirmActionDialog
        open={dialog === 'reject'}
        title="Rechazar nodo"
        description={`Envía una señal de rechazo al nodo "${waitingApproval?.nodeId ?? ''}". El flujo de trabajo sigue su ruta de rechazo.`}
        confirmLabel="Rechazar"
        destructive
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('reject') : close())}
      />
    </div>
  )
}

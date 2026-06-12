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
      setError(caught instanceof Error ? caught.message : 'Action failed')
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
        Cancel
      </Button>

      {/* Retry — only for a terminal execution. */}
      {terminal ? (
        <Button size="sm" variant="outline" onClick={() => setDialog('retry')} data-testid="run-retry-button">
          Retry
        </Button>
      ) : null}

      {/* Approve / Reject — only when an approval node is waiting. */}
      {waitingApproval ? (
        <>
          <Button size="sm" onClick={() => setDialog('approve')} data-testid="run-approve-button">
            Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDialog('reject')} data-testid="run-reject-button">
            Reject
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
        title="Cancel execution"
        description="This stops the running workflow gracefully. In-flight activities are signalled to cancel."
        confirmLabel="Cancel execution"
        cancelLabel="Keep running"
        destructive
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('cancel') : close())}
      />

      <ConfirmActionDialog
        open={dialog === 'retry'}
        title="Retry execution"
        description="This launches a new run with the same flow version and original trigger input. The original run is unchanged."
        confirmLabel="Start retry"
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('retry') : close())}
      />

      <ConfirmActionDialog
        open={dialog === 'approve'}
        title="Approve node"
        description={`Send an approval signal to node "${waitingApproval?.nodeId ?? ''}". The workflow continues past the approval gate.`}
        confirmLabel="Approve"
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('approve') : close())}
      />

      <ConfirmActionDialog
        open={dialog === 'reject'}
        title="Reject node"
        description={`Send a rejection signal to node "${waitingApproval?.nodeId ?? ''}". The workflow follows its rejection path.`}
        confirmLabel="Reject"
        destructive
        pending={pending}
        onConfirm={runConfirm}
        onOpenChange={(open) => (open ? setDialog('reject') : close())}
      />
    </div>
  )
}

// Run actions (ported from the legacy RunActionToolbar): cancel, retry, approve and reject, each
// behind an alert-dialog and gated on the execution state.
//   Cancel: always visible, disabled on a terminal run.   Retry: hidden on a non-terminal run.
//   Approve and Reject: rendered only while a node waits for approval.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Text } from '@gntik-ai/ui'
import { RunButton as Button } from './controls'
import { cancelExecution, isTerminalExecution, retryExecution, sendApprovalSignal } from './api'
import { useActionError, useNotify } from './notify'

export interface WaitingApprovalNode { nodeId: string; signalName: string }
type Pending = 'cancel' | 'retry' | 'approve' | 'reject'
const dialogs: Record<Pending, { destructive: boolean }> = { cancel: { destructive: true }, retry: { destructive: false }, approve: { destructive: false }, reject: { destructive: true } }

export function Actions({ workspaceId, flowId, executionId, status, waitingApproval, onCancelled, onSignalSent, onRetried }: {
  workspaceId: string; flowId: string; executionId: string; status: string | null | undefined; waitingApproval: WaitingApprovalNode | null
  onCancelled: () => void; onSignalSent: () => void; onRetried: (executionId: string) => void
}) {
  const { t } = useTranslation('pages.console-flow-run-page')
  const notify = useNotify(), describe = useActionError()
  const [dialog, setDialog] = useState<Pending | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const buttons = useRef<Partial<Record<Pending, HTMLButtonElement | null>>>({})
  const terminal = isTerminalExecution(status)

  async function confirm() {
    if (!dialog || inFlight.current) return
    inFlight.current = true; setPending(true); setError('')
    try {
      if (dialog === 'cancel') {
        await cancelExecution(workspaceId, flowId, executionId)
        notify(t('cancelledResult')); onCancelled()
      } else if (dialog === 'retry') {
        const result = await retryExecution(workspaceId, flowId, executionId)
        notify(t('retriedResult', { id: result.executionId })); onRetried(result.executionId)
      } else if (waitingApproval) {
        const approved = dialog === 'approve'
        await sendApprovalSignal(workspaceId, flowId, executionId, waitingApproval.signalName, { approved, nodeId: waitingApproval.nodeId })
        notify(t(approved ? 'approvedResult' : 'rejectedResult', { node: waitingApproval.nodeId })); onSignalSent()
      }
      setDialog(null)
    } catch (cause) {
      // The view and its statuses stay as they are; the dialog closes so the message is visible.
      const message = describe(cause)
      setError(message); notify(message, true); setDialog(null)
    } finally { setPending(false); inFlight.current = false }
  }
  const node = waitingApproval?.nodeId ?? ''
  const trigger = (key: Pending, variant: 'primary' | 'secondary' | 'destructive', disabled: boolean) =>
    <Button ref={(element) => { buttons.current[key] = element }} variant={variant} disabled={disabled} onClick={() => setDialog(key)} data-testid={`run-${key}-button`}>{t(`actions.${key}`)}</Button>
  return <div role="group" aria-label={t('actionsLabel')} className="flex min-w-0 flex-wrap items-center gap-2" data-testid="run-action-toolbar">
    {trigger('cancel', 'secondary', terminal)}
    {terminal && trigger('retry', 'secondary', false)}
    {waitingApproval && <>{trigger('approve', 'primary', false)}{trigger('reject', 'destructive', false)}</>}
    {error && <Text variant="supporting" tone="destructive" role="alert" data-testid="run-action-error">{error}</Text>}
    {(Object.keys(dialogs) as Pending[]).map((key) => <AlertDialog key={key} open={dialog === key} onOpenChange={(open) => { if (!pending) setDialog(open ? key : null) }}>
      <AlertDialogContent size="sm" container={undefined} finalFocus={{ current: buttons.current[key] ?? null }} className="min-w-0 wrap-anywhere" data-testid="confirm-action-dialog">
        <AlertDialogHeader tone={dialogs[key].destructive ? 'destructive' : 'info'} icon={null}>
          <AlertDialogTitle>{t(`dialog.${key}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`dialog.${key}.description`, { node })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" disabled={pending} data-testid="confirm-action-cancel" onClick={() => setDialog(null)}>{t(`dialog.${key}.dismiss`)}</Button>
          <Button variant={dialogs[key].destructive ? 'destructive' : 'primary'} disabled={pending} data-testid="confirm-action-confirm" onClick={() => void confirm()}>{pending ? t('working') : t(`dialog.${key}.confirm`)}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>)}
  </div>
}

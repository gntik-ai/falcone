import { useId, useState } from 'react'
import { Play } from 'lucide-react'

import { ConfirmActionDialog } from '@/components/flows/ConfirmActionDialog'
import { isPublishedFlowStatus } from '@/components/flows/FlowStatusBadge'
import { Button } from '@/components/ui/button'
import { triggerFlowSchedule, type FlowScheduleTriggerAck } from '@/services/flowsApi'

export interface FlowRunTriggerButtonProps {
  workspaceId: string
  flowId: string
  flowName?: string | null
  status?: string | null
  className?: string
  onTriggered?: (ack: FlowScheduleTriggerAck) => void
}

export function FlowRunTriggerButton({
  workspaceId,
  flowId,
  flowName,
  status,
  className,
  onTriggered
}: FlowRunTriggerButtonProps) {
  const disabledDescriptionId = useId()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const flowLabel = flowName?.trim() || flowId
  const canRun = isPublishedFlowStatus(status)
  const disabledReason = 'Publica este flujo antes de ejecutarlo.'

  const onConfirm = async () => {
    setPending(true)
    setError(null)
    try {
      const ack = await triggerFlowSchedule(workspaceId, flowId)
      setDialogOpen(false)
      onTriggered?.(ack)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo iniciar el flujo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        className={className}
        disabled={!canRun || pending}
        title={canRun ? undefined : disabledReason}
        aria-describedby={canRun ? undefined : disabledDescriptionId}
        aria-label={
          canRun
            ? `Ejecutar ahora ${flowLabel}`
            : `Ejecutar ahora no disponible para ${flowLabel}: ${disabledReason}`
        }
        data-testid="flow-run-now-button"
        onClick={() => setDialogOpen(true)}
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Ejecutando...' : 'Ejecutar ahora'}
      </Button>
      {!canRun ? (
        <span id={disabledDescriptionId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
      {error ? (
        <span className="text-xs text-destructive" role="alert" data-testid="flow-run-now-error">
          {error}
        </span>
      ) : null}
      <ConfirmActionDialog
        open={dialogOpen}
        title="Ejecutar flujo ahora"
        description={`Se solicitará una ejecución inmediata de "${flowLabel}". La API devuelve una confirmación de disparo; después verás el historial para abrir el detalle cuando aparezca la ejecución.`}
        confirmLabel="Ejecutar ahora"
        pending={pending}
        onConfirm={onConfirm}
        onOpenChange={(open) => {
          if (!pending) setDialogOpen(open)
        }}
      />
    </>
  )
}

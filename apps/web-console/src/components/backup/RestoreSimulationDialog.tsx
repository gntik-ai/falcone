import { useEffect, useId, useMemo, useState } from 'react'
import type { InitiateRestoreBody } from '@/services/backupOperationsApi'
import { Button } from '@/components/ui/button'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'

interface RestoreSimulationDialogProps {
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId: string
  onLaunch: (body: InitiateRestoreBody) => Promise<void>
  onClose: () => void
  disabled?: boolean
}

export function RestoreSimulationDialog({
  tenantId,
  componentType,
  instanceId,
  snapshotId,
  onLaunch,
  onClose,
  disabled = false,
}: RestoreSimulationDialogProps) {
  const [submitted, setSubmitted] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  // Focus-on-open + Tab-trap + focus-return, matching the sibling DestructiveConfirmationDialog.
  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(true)
  const body = useMemo<InitiateRestoreBody>(() => ({
    tenant_id: tenantId,
    component_type: componentType,
    instance_id: instanceId,
    snapshot_id: snapshotId,
    execution_mode: 'simulation',
  }), [tenantId, componentType, instanceId, snapshotId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Escape dismisses the drill dialog (same effect as the Cancelar button) unless a launch is
      // already in flight.
      if (event.key === 'Escape' && !submitted && !disabled) {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [submitted, disabled, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleTabTrap}
        className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">Simulación de restore</h2>
        <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
          Esta acción ejecuta un drill en un entorno seguro. No toca producción.
        </p>
        <div className="mt-4 space-y-1 text-sm text-foreground">
          <p><strong>Organización:</strong> {tenantId}</p>
          <p><strong>Componente:</strong> {componentType}</p>
          <p><strong>Instancia:</strong> {instanceId}</p>
          <p><strong>Instantánea:</strong> {snapshotId}</p>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={disabled || submitted}
            onClick={async () => {
              setSubmitted(true)
              await onLaunch(body)
            }}
          >
            {submitted ? 'Lanzando…' : 'Lanzar simulación'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RestoreSimulationDialog

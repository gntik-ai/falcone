import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTriggerBackup } from '@/hooks/useTriggerBackup'

interface TriggerBackupButtonProps {
  tenantId: string
  componentType: string
  instanceId: string
  token: string
  capabilities: { triggerBackup: boolean }
  onSuccess?: (operationId: string) => void
}

export function TriggerBackupButton({
  tenantId,
  componentType,
  instanceId,
  token,
  capabilities,
  onSuccess,
}: TriggerBackupButtonProps) {
  if (!capabilities.triggerBackup) return null

  const [showModal, setShowModal] = useState(false)
  const { trigger, isLoading, error } = useTriggerBackup()

  async function handleConfirm() {
    await trigger({ tenant_id: tenantId, component_type: componentType, instance_id: instanceId }, token)
    setShowModal(false)
    if (onSuccess) onSuccess('')
  }

  return (
    <>
      <Button type="button" size="sm" data-testid="trigger-backup-button" onClick={() => setShowModal(true)}>
        Iniciar backup
      </Button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-2 text-foreground">Confirmar backup</h2>
            <p className="text-sm text-muted-foreground mb-4">
              ¿Iniciar backup bajo demanda para el componente <strong>{componentType}</strong> ({instanceId}) de la organización <strong>{tenantId}</strong>?
            </p>
            {error && <p className="text-destructive text-sm mb-2">{error.message}</p>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowModal(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={isLoading} onClick={() => void handleConfirm()}>
                {isLoading ? 'Iniciando…' : 'Confirmar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

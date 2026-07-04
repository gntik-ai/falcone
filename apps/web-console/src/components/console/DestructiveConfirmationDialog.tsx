import { useEffect, useId, useState } from 'react'
import { AlertTriangle, ShieldAlert, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'
import { type DestructiveOpConfig, type DestructiveOpState } from '@/lib/destructive-ops'
import { cn } from '@/lib/utils'

interface DestructiveConfirmationDialogProps {
  open: boolean
  config: DestructiveOpConfig | null
  opState: DestructiveOpState
  confirmError: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function DestructiveConfirmationDialog({
  open,
  config,
  opState,
  confirmError,
  onConfirm,
  onCancel
}: DestructiveConfirmationDialogProps) {
  const [confirmationText, setConfirmationText] = useState('')
  const titleId = useId()
  const descriptionId = useId()
  const isConfirming = opState === 'confirming'
  const isCritical = config?.level === 'CRITICAL'
  // Tab-trap + focus-on-open + focus-return (#783). The `ui/dialog.tsx` primitive is a bare
  // backdrop overlay and provides neither on its own.
  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(open)

  useEffect(() => {
    setConfirmationText('')
  }, [config?.operationId, config?.resourceName, open])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isConfirming) {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isConfirming, onCancel, open])

  if (!config) {
    return null
  }

  const confirmDisabled =
    isConfirming ||
    opState === 'loading-impact' ||
    (isCritical && confirmationText !== config.resourceName)
  const SeverityIcon = isCritical ? Trash2 : ShieldAlert

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isConfirming) {
          onCancel()
        }
      }}
    >
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={handleTabTrap}
          className="focus:outline-none"
        >
          <DialogHeader className="mb-0 border-b border-border/70 bg-muted/20 p-5 sm:p-6">
            <div className="flex gap-3">
              <span
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
                  isCritical ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/30 bg-primary/10 text-primary'
                )}
                aria-hidden="true"
              >
                <SeverityIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <DialogTitle id={titleId}>{isCritical ? `Eliminar ${config.resourceType}` : 'Confirmar acción'}</DialogTitle>
                <DialogDescription id={descriptionId}>
                  {isCritical
                    ? 'Revisa el impacto antes de confirmar la eliminación.'
                    : 'Revisa los detalles de la acción antes de continuar.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 p-5 sm:p-6">
            {isCritical ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    Vas a eliminar <strong>{config.resourceName}</strong>.
                  </p>
                  {config.impactDescription ? <p className="text-sm leading-6 text-muted-foreground">{config.impactDescription}</p> : null}
                </div>
                <section className="border-l border-border pl-4">
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">Impacto en cascada</h3>
                  {opState === 'loading-impact' ? <p className="mt-2 text-sm text-muted-foreground">Calculando impacto…</p> : null}
                  {config.cascadeImpactError ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">No se pudo calcular el impacto completo. Puedes continuar con la información disponible.</p> : null}
                  {!config.cascadeImpactError && opState !== 'loading-impact' && (config.cascadeImpact?.length ?? 0) === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No se detectaron recursos dependientes adicionales.</p>
                  ) : null}
                  {!config.cascadeImpactError && (config.cascadeImpact?.length ?? 0) > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                      {config.cascadeImpact?.map((item) => (
                        <li key={`${item.resourceType}-${item.count}`}>{item.resourceType} / {item.count}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
                <p className="flex gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Esta operación es irreversible.</span>
                </p>
                <label className="space-y-2 text-sm text-foreground">
                  <span>Escribe exactamente el nombre del recurso para confirmar.</span>
                  <Input
                    type="text"
                    value={confirmationText}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    placeholder={config.resourceName}
                  />
                </label>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    Vas a actuar sobre <strong>{config.resourceName}</strong> ({config.resourceType}).
                  </p>
                  {config.impactDescription ? <p className="text-sm leading-6 text-muted-foreground">{config.impactDescription}</p> : null}
                </div>
                <p className="flex gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Esta operación no se puede deshacer.</span>
                </p>
              </>
            )}

            {confirmError ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{confirmError}</div> : null}
          </div>

          <DialogFooter className="mt-0 flex-col items-stretch border-t border-border/70 bg-muted/20 p-5 sm:flex-row sm:items-center sm:justify-end sm:p-6">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onCancel} disabled={isConfirming}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full min-w-[8rem] sm:w-auto"
              onClick={() => onConfirm()}
              disabled={confirmDisabled}
              aria-busy={isConfirming}
            >
              {isCritical ? <Trash2 className="h-4 w-4" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4" aria-hidden="true" />}
              {isConfirming ? (isCritical ? 'Eliminar…' : 'Confirmar…') : isCritical ? 'Eliminar' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

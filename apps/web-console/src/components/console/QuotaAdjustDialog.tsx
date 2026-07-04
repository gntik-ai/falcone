import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'
import type { ConsoleQuotaDimensionView } from '@/lib/console-quotas'
import * as api from '@/services/planManagementApi'

// The console's ONLY wired write path for a quota dimension's hard limit is the tenant's
// assigned PLAN limit (PUT /v1/plans/{planId}/limits/{dimensionKey} — planManagementApi.setPlanLimit).
// There is no per-tenant/per-workspace quota-override endpoint in the public route catalog, so
// "Ajustar cuota" resolves the active tenant's current plan and edits THAT plan's limit for this
// dimension — honestly disclosed below, since the change is shared by every tenant on that plan.
export interface QuotaAdjustTarget {
  tenantId: string
  dimension: ConsoleQuotaDimensionView
  // Distinguishes the "Organización" and "Área de trabajo" tables so the return-focus lookup below
  // can re-locate the exact triggering button even though both tables may render a row for the same
  // dimensionId.
  tableKey: string
}

type PlanResolution =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-plan' }
  | { status: 'frozen'; planId: string; planDisplayName: string }
  | { status: 'ready'; planId: string; planDisplayName: string }

type AdjustFeedback = { kind: 'success'; newValue: number } | { kind: 'error'; message: string } | null

function planLimitErrorMessage(error: unknown): string {
  const candidate = error as Partial<api.PlanApiError>
  const code = typeof candidate?.code === 'string' ? candidate.code : null

  if (code === 'INVALID_LIMIT_VALUE') {
    return 'INVALID_LIMIT_VALUE: usa -1 para indicar sin límite, 0 o un número entero positivo.'
  }
  if (code === 'PLAN_LIMITS_FROZEN') {
    return 'PLAN_LIMITS_FROZEN: este plan ya no acepta cambios de límites.'
  }

  const message = error instanceof Error && error.message ? error.message : 'La solicitud falló.'
  return code && !message.includes(code) ? `${code}: ${message}` : message
}

function quotaAdjustTriggerSelector(tableKey: string): string {
  return `[data-quota-adjust-trigger="${tableKey}"]`
}

// Both the posture view (`null` = unbounded/unset) and the plan-limit API (`-1` sentinel) can mean
// "no upper bound"; render both as the same human phrase the quotas table already uses.
function formatLimit(value: number | null): string {
  return value === null || value === -1 ? 'sin límite' : String(value)
}

// Seed the editable field with the current limit as an integer so the input is never mysteriously
// blank: an unbounded dimension seeds as "-1", round-tripping with the "usa -1 para indicar sin
// límite" helper instead of forcing the user to guess.
function limitInputSeed(value: number | null): string {
  return value === null ? '-1' : String(value)
}

export function QuotaAdjustDialog({
  target,
  onClose,
  onAdjusted
}: {
  target: QuotaAdjustTarget | null
  onClose: () => void
  onAdjusted: () => void
}) {
  const isOpen = target !== null
  const titleId = useId()
  const descriptionId = useId()
  const scopeId = useId()
  const helpId = useId()
  const errorId = useId()
  const valueInputId = useId()
  // Fresh per open (the parent remounts this via `key`), so the seed reflects the row that was
  // clicked without a stale-state flash on reopen.
  const [resolution, setResolution] = useState<PlanResolution>({ status: 'loading' })
  const [value, setValue] = useState(() => (target ? limitInputSeed(target.dimension.hardLimit) : ''))
  const [validationError, setValidationError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<AdjustFeedback>(null)
  const [busy, setBusy] = useState(false)
  const [resolveNonce, setResolveNonce] = useState(0)

  const valueInputRef = useRef<HTMLInputElement>(null)
  const successCloseRef = useRef<HTMLButtonElement>(null)
  // Frozen at open time so the close-time `resolveReturnFocus` can still re-locate the triggering
  // row button by data-attribute even though `target` is already null by the time this instance is
  // unmounting — and even though a success reload may have replaced that button with a fresh DOM
  // node (a node reference captured at open time would be detached; #783).
  const triggerTableKeyRef = useRef<string | null>(target ? target.tableKey : null)
  if (target) triggerTableKeyRef.current = target.tableKey

  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(isOpen, {
    resolveReturnFocus: () => {
      const key = triggerTableKeyRef.current
      return key ? document.querySelector<HTMLElement>(quotaAdjustTriggerSelector(key)) : null
    }
  })

  useEffect(() => {
    if (!target) return
    let cancelled = false

    api.getTenantCurrentPlan(target.tenantId).then((data) => {
      if (cancelled) return
      const response = data as { noAssignment?: boolean; assignment?: { planId?: string }; plan?: { id?: string; displayName?: string; status?: api.PlanStatus } }
      const planId = response?.assignment?.planId ?? response?.plan?.id ?? null
      if (response?.noAssignment || !planId || !response.plan) {
        setResolution({ status: 'no-plan' })
        return
      }
      const planDisplayName = response.plan.displayName ?? planId
      if (response.plan.status === 'deprecated' || response.plan.status === 'archived') {
        setResolution({ status: 'frozen', planId, planDisplayName })
        return
      }
      setResolution({ status: 'ready', planId, planDisplayName })
    }).catch((caught) => {
      if (cancelled) return
      setResolution({ status: 'error', message: caught instanceof Error && caught.message ? caught.message : 'No se pudo resolver el plan asignado a la organización.' })
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.tenantId, target?.dimension.dimensionId, target?.tableKey, resolveNonce])

  // Move focus onto the editable field as soon as the form is ready (fires once per open, since the
  // status only transitions loading -> ready). A later inline error keeps the status 'ready', so
  // focus is NOT yanked off the button the user just pressed.
  useEffect(() => {
    if (isOpen && resolution.status === 'ready') {
      valueInputRef.current?.focus()
    }
  }, [resolution.status, isOpen])

  // A successful save swaps the form (and its focused "Guardar" button) for the confirmation panel;
  // move focus to the confirmation's "Cerrar" so it never drops to <body>, which would break the
  // Tab-trap and the Escape handler that live on the panel.
  useEffect(() => {
    if (isOpen && feedback?.kind === 'success') {
      successCloseRef.current?.focus()
    }
  }, [feedback?.kind, isOpen])

  if (!target) {
    return null
  }

  const activeTarget = target
  const { dimension } = activeTarget

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    handleTabTrap(event)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy || resolution.status !== 'ready') return
    const trimmed = value.trim()
    const parsed = Number(trimmed)
    if (trimmed === '' || !Number.isInteger(parsed) || parsed < -1) {
      setValidationError('Ingresa un número entero mayor o igual a -1 (usa -1 para indicar sin límite).')
      valueInputRef.current?.focus()
      return
    }
    setValidationError(null)
    setBusy(true)
    setFeedback(null)
    try {
      const result = await api.setPlanLimit(resolution.planId, dimension.dimensionId, parsed)
      setFeedback({ kind: 'success', newValue: result.newValue })
      onAdjusted()
    } catch (caught) {
      setFeedback({ kind: 'error', message: planLimitErrorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  function retryResolution() {
    setFeedback(null)
    setResolution({ status: 'loading' })
    setResolveNonce((current) => current + 1)
  }

  const planDisplayName = resolution.status === 'ready' || resolution.status === 'frozen' ? resolution.planDisplayName : null
  const readyDescribedBy = [scopeId, helpId, validationError ? errorId : null].filter(Boolean).join(' ')

  return (
    <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="max-w-lg">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="focus:outline-none"
        >
          <DialogHeader>
            <DialogTitle id={titleId} className="break-words">Ajustar cuota: {dimension.displayName}</DialogTitle>
            <DialogDescription id={descriptionId}>
              Cambia el límite de esta dimensión editando el plan asignado a la organización activa.
            </DialogDescription>
          </DialogHeader>

          {feedback?.kind === 'success' ? (
            <div className="space-y-4">
              <Alert variant="success" role="status" aria-live="polite">
                <AlertTitle>Límite guardado</AlertTitle>
                <AlertDescription>
                  {dimension.displayName} ahora es {feedback.newValue === -1 ? 'sin límite' : feedback.newValue} en el plan «{planDisplayName}». Cierra este panel para ver la tabla de cuotas actualizada.
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button ref={successCloseRef} type="button" onClick={onClose}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : null}

          {feedback?.kind !== 'success' && resolution.status === 'loading' ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              Resolviendo el plan asignado a la organización…
            </p>
          ) : null}

          {feedback?.kind !== 'success' && resolution.status === 'error' ? (
            <div className="space-y-4">
              <Alert variant="destructive" role="alert">
                <AlertTitle>No se pudo resolver el plan</AlertTitle>
                <AlertDescription>{resolution.message}</AlertDescription>
              </Alert>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
                <Button type="button" onClick={retryResolution}>Reintentar</Button>
              </DialogFooter>
            </div>
          ) : null}

          {feedback?.kind !== 'success' && resolution.status === 'no-plan' ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-foreground">
                Esta organización no tiene un plan asignado, así que no hay un límite de plan que ajustar para {dimension.displayName}.
                Asigna un plan a la organización para poder definir sus límites de cuota.
              </p>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
                <Button type="button" asChild>
                  <Link to={`/console/tenants/${activeTarget.tenantId}/plan`} onClick={onClose}>Ir a asignar plan</Link>
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {feedback?.kind !== 'success' && resolution.status === 'frozen' ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-foreground">
                El plan «{planDisplayName}» asignado a esta organización está retirado y ya no acepta cambios de límites.
                Cambia el estado del plan o asigna otro plan activo para ajustar {dimension.displayName}.
              </p>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
                <Button type="button" asChild>
                  <Link to={`/console/plans/${resolution.planId}`} onClick={onClose}>Abrir plan</Link>
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {feedback?.kind !== 'success' && resolution.status === 'ready' ? (
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
              <Alert variant="default" role="note" id={scopeId}>
                <AlertDescription>
                  <strong className="font-semibold text-foreground">Este cambio afecta a todo el plan, no solo a esta organización.</strong>{' '}
                  Editas el límite de {dimension.displayName} en el plan «{resolution.planDisplayName}»; se aplica a todas las
                  organizaciones que usan ese plan.
                </AlertDescription>
              </Alert>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Valor actual</span>
                <span className="font-medium tabular-nums text-foreground">{formatLimit(dimension.hardLimit)}</span>
              </div>
              <div className="space-y-2">
                <Label htmlFor={valueInputId}>Nuevo límite de {dimension.displayName}</Label>
                <Input
                  ref={valueInputRef}
                  id={valueInputId}
                  type="number"
                  inputMode="numeric"
                  min={-1}
                  step={1}
                  autoComplete="off"
                  value={value}
                  disabled={busy}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={readyDescribedBy}
                  onChange={(event) => {
                    setValue(event.currentTarget.value)
                    if (validationError) setValidationError(null)
                  }}
                />
                <p id={helpId} className="text-xs text-muted-foreground">Usa -1 para indicar sin límite.</p>
              </div>
              {validationError ? <p id={errorId} role="alert" className="text-sm text-destructive">{validationError}</p> : null}
              {feedback?.kind === 'error' ? (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>El límite no se guardó</AlertTitle>
                  <AlertDescription>{feedback.message}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
                <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
              </DialogFooter>
            </form>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save } from 'lucide-react'
import type { LimitProfileRow } from '@/services/planManagementApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type PlanLimitRowStatus = {
  state: 'saving' | 'saved' | 'failed'
  message?: string
}

type DraftValidation =
  | { valid: true; value: number }
  | { valid: false; message: string }

function limitInputValue(dimension: LimitProfileRow): string {
  return Number.isFinite(dimension.effectiveValue) ? String(dimension.effectiveValue) : ''
}

function inputValuesFor(dimensions: LimitProfileRow[]): Record<string, string> {
  return Object.fromEntries(dimensions.map((dimension) => [dimension.dimensionKey, limitInputValue(dimension)]))
}

function safeControlId(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '-')
}

function formatLimitSource(source: LimitProfileRow['source']): string {
  const labels: Partial<Record<LimitProfileRow['source'], string>> = {
    explicit: 'Explícito',
    default: 'Predeterminado',
    unlimited: 'Sin límite'
  }

  return labels[source] ?? String(source).replace(/_/g, ' ')
}

function validateDraftValue(rawDraftValue: string): DraftValidation {
  const draftValue = rawDraftValue.trim()
  if (draftValue === '') {
    return { valid: false, message: 'Introduce -1, 0 o un número entero positivo.' }
  }

  const nextValue = Number(draftValue)
  if (!Number.isFinite(nextValue) || !Number.isInteger(nextValue) || nextValue < -1) {
    return { valid: false, message: 'Usa -1 para indicar sin límite, 0 o un número entero positivo.' }
  }

  return { valid: true, value: nextValue }
}

function formatRowStatus({
  validation,
  isDirty,
  rowStatus
}: {
  validation: DraftValidation
  isDirty: boolean
  rowStatus?: PlanLimitRowStatus
}): { label: string; tone: 'muted' | 'success' | 'warning' | 'destructive'; icon: 'saved' | 'saving' | 'error' | null; role?: 'status' | 'alert' } {
  if (rowStatus?.state === 'saving') {
    return { label: rowStatus.message ?? 'Guardando', tone: 'warning', icon: 'saving', role: 'status' }
  }
  if (!validation.valid) {
    return { label: validation.message, tone: 'destructive', icon: 'error', role: 'alert' }
  }
  if (isDirty) {
    return { label: 'Cambio sin guardar', tone: 'warning', icon: null, role: 'status' }
  }
  if (rowStatus?.state === 'failed') {
    return { label: rowStatus.message ?? 'Error al guardar', tone: 'destructive', icon: 'error', role: 'alert' }
  }
  if (rowStatus?.state === 'saved') {
    return { label: rowStatus.message ?? 'Guardado', tone: 'success', icon: 'saved', role: 'status' }
  }
  return { label: 'Persistido', tone: 'muted', icon: 'saved' }
}

export function PlanLimitsTable({
  dimensions,
  editable,
  busyDimensionKey = null,
  rowStatuses = {},
  onUpdate,
  onResetRequest
}: {
  dimensions: LimitProfileRow[]
  editable: boolean
  busyDimensionKey?: string | null
  rowStatuses?: Record<string, PlanLimitRowStatus | undefined>
  onUpdate?: (key: string, value: number) => void | Promise<void>
  onResetRequest?: (dimension: LimitProfileRow) => void
}) {
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => inputValuesFor(dimensions))

  useEffect(() => {
    setInputValues(inputValuesFor(dimensions))
  }, [dimensions])

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] divide-y divide-border text-left text-sm" aria-busy={busyDimensionKey !== null}>
        <caption className="sr-only">Límites del plan</caption>
        <thead className="bg-muted/40">
          <tr className="text-xs uppercase text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">Dimensión</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Valor</th>
            <th scope="col" className="px-4 py-3 font-medium">Estado</th>
            <th scope="col" className="px-4 py-3 font-medium">Origen</th>
            <th scope="col" className="px-4 py-3 font-medium">Unidad</th>
            <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/80">
          {dimensions.map((dimension) => {
            const isBusy = busyDimensionKey === dimension.dimensionKey
            const controlId = safeControlId(dimension.dimensionKey)
            const helpId = `${controlId}-limit-help`
            const statusId = `${controlId}-limit-status`
            const persistedValue = limitInputValue(dimension)
            const draftValue = inputValues[dimension.dimensionKey] ?? persistedValue
            const validation = validateDraftValue(draftValue)
            const isDirty = validation.valid ? validation.value !== dimension.effectiveValue : draftValue.trim() !== persistedValue
            const rowStatus = rowStatuses[dimension.dimensionKey]
            const displayedStatus = formatRowStatus({ validation, isDirty, rowStatus })
            const canSave = editable && !isBusy && validation.valid && isDirty

            return (
              <tr key={dimension.dimensionKey} aria-busy={isBusy} className="align-top transition-colors hover:bg-muted/30">
                <th scope="row" className="max-w-[18rem] whitespace-normal break-words px-4 py-4 text-left font-medium text-foreground">{dimension.displayLabel}</th>
                <td className="w-40 px-4 py-4 text-right tabular-nums">
                  {editable ? (
                    <div>
                      <Input
                        className="ml-auto h-9 w-32 rounded-md text-right tabular-nums"
                        aria-label={`${dimension.displayLabel}: valor del límite`}
                        aria-describedby={`${helpId} ${statusId}`}
                        aria-invalid={!validation.valid}
                        type="number"
                        inputMode="numeric"
                        min={-1}
                        step={1}
                        value={draftValue}
                        disabled={isBusy}
                        onChange={(event) => {
                          const nextDraft = event.currentTarget.value
                          setInputValues((current) => ({ ...current, [dimension.dimensionKey]: nextDraft }))
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setInputValues((current) => ({ ...current, [dimension.dimensionKey]: persistedValue }))
                          } else if (event.key === 'Enter' && canSave && validation.valid) {
                            event.preventDefault()
                            void onUpdate?.(dimension.dimensionKey, validation.value)
                          }
                        }}
                      />
                      <span id={helpId} className="sr-only">Usa -1 para indicar sin límite. Haz clic en Guardar para confirmar el cambio.</span>
                    </div>
                  ) : dimension.effectiveValue === -1 ? 'Sin límite' : String(dimension.effectiveValue)}
                </td>
                <td className="w-56 px-4 py-4">
                  <span
                    id={statusId}
                    role={displayedStatus.role}
                    aria-live={displayedStatus.role ? (displayedStatus.role === 'alert' ? 'assertive' : 'polite') : undefined}
                    className={cn(
                      'inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium leading-5',
                      displayedStatus.tone === 'muted' && 'border-border bg-muted/30 text-muted-foreground',
                      displayedStatus.tone === 'success' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
                      displayedStatus.tone === 'warning' && 'border-amber-500/40 bg-amber-500/10 text-amber-100',
                      displayedStatus.tone === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive'
                    )}
                  >
                    {displayedStatus.icon === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                    {displayedStatus.icon === 'saved' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    {displayedStatus.icon === 'error' ? <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    <span>{displayedStatus.label}</span>
                  </span>
                </td>
                <td className="px-4 py-4 text-muted-foreground">{formatLimitSource(dimension.source)}</td>
                <td className="px-4 py-4 text-muted-foreground">{dimension.unit ?? 'count'}</td>
                <td className="w-56 px-4 py-4">
                  {editable ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="min-w-[6.5rem] whitespace-nowrap"
                        disabled={!canSave}
                        aria-label={isBusy ? `Guardando límite de ${dimension.displayLabel}` : `Guardar límite de ${dimension.displayLabel}`}
                        onClick={() => {
                          if (!validation.valid || !isDirty) return
                          void onUpdate?.(dimension.dimensionKey, validation.value)
                        }}
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                        {isBusy ? 'Guardando' : 'Guardar'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-w-[7.25rem] whitespace-nowrap"
                        disabled={isBusy}
                        aria-label={`Restablecer límite de ${dimension.displayLabel} al valor predeterminado`}
                        onClick={() => onResetRequest?.(dimension)}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Restablecer
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

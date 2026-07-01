import { useEffect, useRef, useState } from 'react'
import type { LimitProfileRow } from '@/services/planManagementApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function limitInputValue(dimension: LimitProfileRow): string {
  return Number.isFinite(dimension.effectiveValue) ? String(dimension.effectiveValue) : ''
}

function inputValuesFor(dimensions: LimitProfileRow[]): Record<string, string> {
  return Object.fromEntries(dimensions.map((dimension) => [dimension.dimensionKey, limitInputValue(dimension)]))
}

function safeControlId(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '-')
}

function isResetControlForDimension(target: EventTarget | null, dimensionKey: string): boolean {
  return target instanceof HTMLElement && target.dataset.resetDimensionKey === dimensionKey
}

function isLimitInputForDimension(target: EventTarget | null, dimensionKey: string): boolean {
  return target instanceof HTMLElement && target.dataset.limitInputDimensionKey === dimensionKey
}

function formatLimitSource(source: LimitProfileRow['source']): string {
  const labels: Partial<Record<LimitProfileRow['source'], string>> = {
    explicit: 'Explícito',
    default: 'Predeterminado',
    unlimited: 'Sin límite'
  }

  return labels[source] ?? String(source).replace(/_/g, ' ')
}

export function PlanLimitsTable({
  dimensions,
  editable,
  busyDimensionKey = null,
  onUpdate,
  onRemove
}: {
  dimensions: LimitProfileRow[]
  editable: boolean
  busyDimensionKey?: string | null
  onUpdate?: (key: string, value: number) => void | Promise<void>
  onRemove?: (key: string) => void | Promise<void>
}) {
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => inputValuesFor(dimensions))
  const resetIntentDimensionKey = useRef<string | null>(null)
  const keyboardResetFocusDimensionKey = useRef<string | null>(null)

  useEffect(() => {
    setInputValues(inputValuesFor(dimensions))
  }, [dimensions])

  function restoreInputValue(key: string, value: string) {
    setInputValues((current) => ({ ...current, [key]: value }))
  }

  function commitDraftValue(dimension: LimitProfileRow, rawDraftValue: string) {
    const persistedValue = limitInputValue(dimension)
    const draftValue = rawDraftValue.trim()
    if (draftValue === '') {
      restoreInputValue(dimension.dimensionKey, persistedValue)
      return
    }

    const nextValue = Number(draftValue)
    if (Number.isNaN(nextValue)) {
      restoreInputValue(dimension.dimensionKey, persistedValue)
      return
    }
    if (nextValue === dimension.effectiveValue) {
      restoreInputValue(dimension.dimensionKey, persistedValue)
      return
    }
    void onUpdate?.(dimension.dimensionKey, nextValue)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] divide-y divide-border text-left text-sm" aria-busy={busyDimensionKey !== null}>
        <caption className="sr-only">Límites del plan</caption>
        <thead className="bg-muted/40">
          <tr className="text-xs uppercase text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">Dimensión</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Valor</th>
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
            return (
              <tr key={dimension.dimensionKey} aria-busy={isBusy} className="align-top transition-colors hover:bg-muted/30">
                <th scope="row" className="max-w-[18rem] whitespace-normal break-words px-4 py-4 text-left font-medium text-foreground">{dimension.displayLabel}</th>
                <td className="w-40 px-4 py-4 text-right tabular-nums">
                  {editable ? (
                    <div>
                      <Input
                        className="ml-auto h-9 w-32 rounded-md text-right tabular-nums"
                        aria-label={`${dimension.displayLabel}: valor del límite`}
                        aria-describedby={isBusy ? `${helpId} ${statusId}` : helpId}
                        data-limit-input-dimension-key={dimension.dimensionKey}
                        type="number"
                        inputMode="numeric"
                        min={-1}
                        step={1}
                        value={inputValues[dimension.dimensionKey] ?? limitInputValue(dimension)}
                        disabled={isBusy}
                        onChange={(event) => {
                          const nextDraft = event.currentTarget.value
                          setInputValues((current) => ({ ...current, [dimension.dimensionKey]: nextDraft }))
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setInputValues((current) => ({ ...current, [dimension.dimensionKey]: limitInputValue(dimension) }))
                          }
                        }}
                        onBlur={(event) => {
                          const persistedValue = limitInputValue(dimension)
                          if (
                            resetIntentDimensionKey.current === dimension.dimensionKey
                          ) {
                            resetIntentDimensionKey.current = null
                            restoreInputValue(dimension.dimensionKey, persistedValue)
                            return
                          }

                          if (isResetControlForDimension(event.relatedTarget, dimension.dimensionKey)) {
                            const draftValue = event.currentTarget.value.trim()
                            const nextValue = Number(draftValue)
                            if (draftValue !== '' && !Number.isNaN(nextValue) && nextValue !== dimension.effectiveValue) {
                              keyboardResetFocusDimensionKey.current = dimension.dimensionKey
                              return
                            }
                            restoreInputValue(dimension.dimensionKey, persistedValue)
                            return
                          }

                          commitDraftValue(dimension, event.currentTarget.value)
                        }}
                      />
                      <span id={helpId} className="sr-only">Usa -1 para indicar sin límite. Los cambios se guardan cuando este campo pierde el foco.</span>
                      {isBusy ? (
                        <span id={statusId} className="sr-only" role="status" aria-live="polite">
                          Guardando límite de {dimension.displayLabel}.
                        </span>
                      ) : null}
                    </div>
                  ) : dimension.effectiveValue === -1 ? 'Sin límite' : String(dimension.effectiveValue)}
                </td>
                <td className="px-4 py-4 text-muted-foreground">{dimension.effectiveValue === -1 ? 'Sin límite' : formatLimitSource(dimension.source)}</td>
                <td className="px-4 py-4 text-muted-foreground">{dimension.unit ?? 'count'}</td>
                <td className="w-36 px-4 py-4 text-right">
                  {editable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-w-[7rem] whitespace-nowrap"
                      disabled={isBusy}
                      data-reset-dimension-key={dimension.dimensionKey}
                      aria-label={isBusy ? `Guardando límite de ${dimension.displayLabel}` : `Restablecer límite de ${dimension.displayLabel} al valor predeterminado`}
                      onPointerDown={() => {
                        resetIntentDimensionKey.current = dimension.dimensionKey
                      }}
                      onClick={() => {
                        resetIntentDimensionKey.current = null
                        keyboardResetFocusDimensionKey.current = null
                        void onRemove?.(dimension.dimensionKey)
                      }}
                      onBlur={(event) => {
                        if (keyboardResetFocusDimensionKey.current !== dimension.dimensionKey) return
                        keyboardResetFocusDimensionKey.current = null
                        if (isLimitInputForDimension(event.relatedTarget, dimension.dimensionKey)) return
                        commitDraftValue(dimension, inputValues[dimension.dimensionKey] ?? limitInputValue(dimension))
                      }}
                    >
                      {isBusy ? 'Guardando...' : 'Restablecer'}
                    </Button>
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

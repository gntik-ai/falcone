import { useId, type ChangeEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { ConsoleMetricRange } from '@/lib/console-metrics'
import { cn } from '@/lib/utils'

interface ConsoleTimeRangeSelectorProps {
  value: ConsoleMetricRange
  onChange: (value: ConsoleMetricRange) => void
  disabled?: boolean
  disabledReason?: string
}

export function ConsoleTimeRangeSelector({ value, onChange, disabled = false, disabledReason }: ConsoleTimeRangeSelectorProps) {
  const idBase = useId()
  const presetId = `${idBase}-preset`
  const descriptionId = disabledReason ? `${idBase}-description` : undefined

  function handlePresetChange(event: ChangeEvent<HTMLSelectElement>) {
    const preset = event.target.value as ConsoleMetricRange['preset']
    onChange({ preset })
  }

  return (
    <fieldset
      aria-describedby={descriptionId}
      aria-disabled={disabled ? 'true' : undefined}
      className={cn(
        'rounded-3xl border p-5 shadow-sm sm:p-6',
        disabled ? 'border-dashed border-border bg-card/40' : 'border-border bg-card/70'
      )}
      disabled={disabled}
    >
      <legend className="sr-only">Rango temporal</legend>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] md:items-start">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold tracking-tight text-foreground">Rango temporal</p>
            {disabled ? (
              <Badge variant="outline" className="border-border/80 bg-background/60 text-muted-foreground">
                No aplicable
              </Badge>
            ) : null}
          </div>
          {disabledReason ? (
            <p id={descriptionId} role="status" aria-live="polite" className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">
              {disabledReason}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={presetId}>Ventana de métricas</Label>
          <Select
            id={presetId}
            aria-describedby={descriptionId}
            value={value.preset}
            onChange={handlePresetChange}
            disabled={disabled}
            className={cn('min-w-0', disabled && 'disabled:opacity-70')}
          >
            {disabled ? (
              <option value={value.preset}>Sin ventana activa</option>
            ) : (
              <>
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
              </>
            )}
          </Select>
        </div>
      </div>
    </fieldset>
  )
}

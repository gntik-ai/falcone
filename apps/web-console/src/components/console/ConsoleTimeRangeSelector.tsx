import { useId, type ChangeEvent } from 'react'

import { Input } from '@/components/ui/input'
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
  const fromId = `${idBase}-from`
  const toId = `${idBase}-to`
  const descriptionId = disabledReason ? `${idBase}-description` : undefined

  function handlePresetChange(event: ChangeEvent<HTMLSelectElement>) {
    const preset = event.target.value as ConsoleMetricRange['preset']
    onChange({ preset, from: preset === 'custom' ? value.from : undefined, to: preset === 'custom' ? value.to : undefined })
  }

  return (
    <fieldset
      aria-describedby={descriptionId}
      aria-disabled={disabled ? 'true' : undefined}
      className={cn(
        'space-y-3 rounded-2xl border p-4',
        disabled ? 'border-dashed border-border bg-muted/20' : 'border-border bg-card/50'
      )}
      disabled={disabled}
    >
      <legend className="text-sm font-medium">Rango temporal</legend>
      {disabledReason ? (
        <p id={descriptionId} role="status" aria-live="polite" className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={presetId}>Ventana de métricas</Label>
        <Select
          id={presetId}
          aria-describedby={descriptionId}
          value={value.preset}
          onChange={handlePresetChange}
          disabled={disabled}
        >
          {disabled ? (
            <option value={value.preset}>Sin ventana activa</option>
          ) : (
            <>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="custom">custom</option>
            </>
          )}
        </Select>
      </div>
      {value.preset === 'custom' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={fromId}>Desde</Label>
            <Input
              id={fromId}
              aria-describedby={descriptionId}
              type="datetime-local"
              value={value.from ?? ''}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={toId}>Hasta</Label>
            <Input
              id={toId}
              aria-describedby={descriptionId}
              type="datetime-local"
              value={value.to ?? ''}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
              disabled={disabled}
            />
          </div>
        </div>
      ) : null}
    </fieldset>
  )
}

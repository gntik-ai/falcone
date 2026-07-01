import { type ChangeEvent } from 'react'

import type { ConsoleMetricRange } from '@/lib/console-metrics'

interface ConsoleTimeRangeSelectorProps {
  value: ConsoleMetricRange
  onChange: (value: ConsoleMetricRange) => void
  disabled?: boolean
  disabledReason?: string
}

export function ConsoleTimeRangeSelector({ value, onChange, disabled = false, disabledReason }: ConsoleTimeRangeSelectorProps) {
  function handlePresetChange(event: ChangeEvent<HTMLSelectElement>) {
    const preset = event.target.value as ConsoleMetricRange['preset']
    onChange({ preset, from: preset === 'custom' ? value.from : undefined, to: preset === 'custom' ? value.to : undefined })
  }

  const descriptionId = disabledReason ? 'console-time-range-selector-description' : undefined

  return (
    <fieldset
      aria-describedby={descriptionId}
      aria-disabled={disabled ? 'true' : undefined}
      className="space-y-3 rounded-2xl border border-border bg-card/50 p-4"
      disabled={disabled}
    >
      <legend className="text-sm font-medium">Rango temporal</legend>
      <label className="block text-sm">
        <span className="mb-1 block">Preset</span>
        <select
          aria-describedby={descriptionId}
          aria-label="Rango temporal"
          value={value.preset}
          onChange={handlePresetChange}
          disabled={disabled}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <option value="24h">24h</option>
          <option value="7d">7d</option>
          <option value="30d">30d</option>
          <option value="custom">custom</option>
        </select>
      </label>
      {disabledReason ? <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">{disabledReason}</p> : null}
      {value.preset === 'custom' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block">Desde</span>
            <input
              aria-label="Desde"
              type="datetime-local"
              value={value.from ?? ''}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
              disabled={disabled}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Hasta</span>
            <input
              aria-label="Hasta"
              type="datetime-local"
              value={value.to ?? ''}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
              disabled={disabled}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </label>
        </div>
      ) : null}
    </fieldset>
  )
}

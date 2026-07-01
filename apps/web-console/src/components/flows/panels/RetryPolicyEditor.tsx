// Retry-policy sub-form for task nodes (change: add-console-flow-designer).
//
// Controlled inputs with inline validation; an INVALID value is shown in the field with
// an inline error but is NOT written to the DSL model (per the property-panel spec).
import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RetryPolicy } from '@/types/flows'

const ISO8601_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?$/

interface RetryPolicyEditorProps {
  value: RetryPolicy | undefined
  onChange: (value: RetryPolicy | undefined) => void
}

interface FieldErrors {
  maxAttempts?: string
  backoffCoefficient?: string
  initialInterval?: string
}

export function RetryPolicyEditor({ value, onChange }: RetryPolicyEditorProps) {
  const idBase = useId()
  // Raw text mirrors what the user typed; the DSL only receives validated values.
  const [raw, setRaw] = useState<{ maxAttempts: string; backoffCoefficient: string; initialInterval: string }>({
    maxAttempts: value?.maxAttempts !== undefined ? String(value.maxAttempts) : '',
    backoffCoefficient: value?.backoffCoefficient !== undefined ? String(value.backoffCoefficient) : '',
    initialInterval: value?.initialInterval ?? ''
  })
  const [errors, setErrors] = useState<FieldErrors>({})

  const commit = (patch: Partial<RetryPolicy>, clear: (keyof RetryPolicy)[] = []) => {
    const next: RetryPolicy = { ...(value ?? {}), ...patch }
    for (const key of clear) delete next[key]
    onChange(Object.keys(next).length > 0 ? next : undefined)
  }

  const onMaxAttempts = (text: string) => {
    setRaw((current) => ({ ...current, maxAttempts: text }))
    if (text.trim() === '') {
      setErrors((current) => ({ ...current, maxAttempts: undefined }))
      commit({}, ['maxAttempts'])
      return
    }
    if (!/^\d+$/.test(text.trim()) || Number(text) < 1) {
      setErrors((current) => ({ ...current, maxAttempts: 'maxAttempts debe ser un entero positivo.' }))
      return
    }
    setErrors((current) => ({ ...current, maxAttempts: undefined }))
    commit({ maxAttempts: Number(text) })
  }

  const onBackoffCoefficient = (text: string) => {
    setRaw((current) => ({ ...current, backoffCoefficient: text }))
    if (text.trim() === '') {
      setErrors((current) => ({ ...current, backoffCoefficient: undefined }))
      commit({}, ['backoffCoefficient'])
      return
    }
    const parsed = Number(text)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrors((current) => ({ ...current, backoffCoefficient: 'backoffCoefficient debe ser un decimal positivo.' }))
      return
    }
    setErrors((current) => ({ ...current, backoffCoefficient: undefined }))
    commit({ backoffCoefficient: parsed })
  }

  const onInitialInterval = (text: string) => {
    setRaw((current) => ({ ...current, initialInterval: text }))
    if (text.trim() === '') {
      setErrors((current) => ({ ...current, initialInterval: undefined }))
      commit({}, ['initialInterval'])
      return
    }
    if (!ISO8601_DURATION.test(text.trim())) {
      setErrors((current) => ({
        ...current,
        initialInterval: 'initialInterval debe ser una duración ISO 8601 (por ejemplo, PT30S).'
      }))
      return
    }
    setErrors((current) => ({ ...current, initialInterval: undefined }))
    commit({ initialInterval: text.trim() })
  }

  return (
    <fieldset data-testid="retry-policy-editor" className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Política de reintentos
      </legend>
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-max`}>Intentos máximos</Label>
        <Input
          id={`${idBase}-max`}
          inputMode="numeric"
          value={raw.maxAttempts}
          onChange={(event) => onMaxAttempts(event.target.value)}
          aria-invalid={Boolean(errors.maxAttempts)}
          className={errors.maxAttempts ? 'border-destructive' : undefined}
        />
        {errors.maxAttempts ? (
          <p data-testid="retry-policy-error-maxAttempts" className="text-xs text-destructive">
            {errors.maxAttempts}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-backoff`}>Coeficiente de backoff</Label>
        <Input
          id={`${idBase}-backoff`}
          inputMode="decimal"
          value={raw.backoffCoefficient}
          onChange={(event) => onBackoffCoefficient(event.target.value)}
          aria-invalid={Boolean(errors.backoffCoefficient)}
          className={errors.backoffCoefficient ? 'border-destructive' : undefined}
        />
        {errors.backoffCoefficient ? (
          <p data-testid="retry-policy-error-backoffCoefficient" className="text-xs text-destructive">
            {errors.backoffCoefficient}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-interval`}>Intervalo inicial (ISO 8601)</Label>
        <Input
          id={`${idBase}-interval`}
          placeholder="PT30S"
          value={raw.initialInterval}
          onChange={(event) => onInitialInterval(event.target.value)}
          aria-invalid={Boolean(errors.initialInterval)}
          className={errors.initialInterval ? 'border-destructive font-mono' : 'font-mono'}
        />
        {errors.initialInterval ? (
          <p data-testid="retry-policy-error-initialInterval" className="text-xs text-destructive">
            {errors.initialInterval}
          </p>
        ) : null}
      </div>
    </fieldset>
  )
}

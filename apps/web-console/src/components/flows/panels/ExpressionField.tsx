// Expression input with inline FLW-E005 syntax validation (change: add-console-flow-designer).
//
// Uses the SAME expression engine (CEL via cel-js) as the shared validator, so the inline
// feedback agrees with the Problems panel and the server's validate endpoint.
import { useId } from 'react'

import { isExpressionParseable } from '@/components/flows/semanticValidation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ExpressionFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  description?: string
}

export function ExpressionField({ label, value, onChange, placeholder, description }: ExpressionFieldProps) {
  const id = useId()
  const invalid = value.length > 0 && !isExpressionParseable(value)
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {label} <span className="font-mono text-[10px] text-muted-foreground">(expression)</span>
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={invalid ? 'border-destructive font-mono' : 'font-mono'}
        aria-invalid={invalid}
      />
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {invalid ? (
        <p data-testid="expression-field-error" className="text-xs text-destructive">
          FLW-E005: expression is not parseable by the CEL engine.
        </p>
      ) : null}
    </div>
  )
}

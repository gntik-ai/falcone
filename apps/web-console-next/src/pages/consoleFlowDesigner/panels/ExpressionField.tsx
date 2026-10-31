import { useCopy } from '../copy'
// Expression input with inline FLW-E005 syntax validation (change: add-console-flow-designer).
//
// Uses the SAME expression engine (CEL via cel-js) as the shared validator, so the inline
// feedback agrees with the Problems panel and the server's validate endpoint.
import { useId } from 'react'

import { isExpressionParseable } from '../semanticValidation'
import { Input } from '@gntik-ai/ui'
import { Field, FieldLabel as Label } from '@gntik-ai/ui'

interface ExpressionFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  description?: string
}

export function ExpressionField({ label, value, onChange, placeholder, description }: ExpressionFieldProps) {
  const { t, i18n } = useCopy()
  const id = useId()
  const invalid = value.length > 0 && !isExpressionParseable(value)
  return (
    <Field invalid={false} className="space-y-1">
      <Label htmlFor={id}>
        {label} <span className="font-mono text-xs text-muted-foreground">{t('expression')}</span>
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
          {t('expressionError')}
        </p>
      ) : null}
    </Field>
  )
}

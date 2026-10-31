import { useCopy } from '../copy'
// Shared presentational chrome for canvas nodes (change: add-console-flow-designer).
//
// Purely presentational (no @xyflow/react imports) so it can be unit-tested without a
// ReactFlow store provider. Each node component wraps this shell with its Handles.
import type { LucideIcon } from 'lucide-react'

import { Badge } from '@gntik-ai/ui'
import { describeFlowValidationError } from '../validation-errors'
const cn = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ')
import type { ValidationError } from '../flows'

export interface NodeShellProps {
  typeLabel: string
  label: string
  icon?: LucideIcon
  selected?: boolean
  validationErrors?: ValidationError[]
  badges?: string[]
  children?: React.ReactNode
}

export function NodeShell({
  typeLabel,
  label,
  icon: Icon,
  selected,
  validationErrors = [],
  badges = [],
  children
}: NodeShellProps) {
  const { i18n } = useCopy()
  const errorCount = validationErrors.length
  return (
    <div
      data-testid="flow-node-shell"
      aria-description={validationErrors.map((error) => describeFlowValidationError(error, i18n.language)).join(". ")}
      className={cn(
        'relative min-w-44 max-w-64 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
        errorCount > 0 && 'border-destructive'
      )}
    >
      {errorCount > 0 ? (
        <span
          data-testid="flow-node-error-badge"
          title={validationErrors.map((error) => `${error.code}: ${describeFlowValidationError(error, i18n.language)}`).join('\n')}
          className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground"
        >
          {errorCount}
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        {Icon ? <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
        <span className="text-xs font-semibold text-muted-foreground">
          {typeLabel}
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-medium" title={label}>
        {label}
      </div>
      {badges.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {badges.map((text) => (
            <Badge key={text} tone="neutral" variant="outline" className="text-xs" data-testid="flow-node-badge">
              {text}
            </Badge>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  )
}

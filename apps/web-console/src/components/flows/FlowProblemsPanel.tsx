// Problems panel aggregating all validation findings (change: add-console-flow-designer).
//
// Shows client-side semantic errors (FLW-E001…FLW-E009), server 422 errors (node- and
// flow-level), and interaction-time connection-rule rejections. Hidden when empty.
import { AlertTriangle } from 'lucide-react'

import type { ValidationError } from '@/types/flows'

interface FlowProblemsPanelProps {
  problems: ValidationError[]
  onSelectNode?: (nodeId: string) => void
}

export function FlowProblemsPanel({ problems, onSelectNode }: FlowProblemsPanelProps) {
  if (problems.length === 0) {
    return null
  }
  return (
    <div
      data-testid="flow-problems-panel"
      className="max-h-44 overflow-y-auto border-t border-border bg-card px-3 py-2"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
        <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
        Problemas ({problems.length})
      </div>
      <ul className="space-y-1">
        {problems.map((problem, index) => (
          <li
            key={`${problem.code}-${problem.nodeId ?? 'flow'}-${index}`}
            data-testid="flow-problem-entry"
            className="flex items-start gap-2 text-xs"
          >
            <span className="shrink-0 rounded bg-destructive/10 px-1 font-mono font-semibold text-destructive">
              {problem.code}
            </span>
            {problem.nodeId ? (
              <button
                type="button"
                className="shrink-0 font-mono text-primary underline-offset-2 hover:underline"
                onClick={() => onSelectNode?.(problem.nodeId as string)}
              >
                {problem.nodeId}
              </button>
            ) : (
              <span className="shrink-0 font-mono text-muted-foreground">flow</span>
            )}
            <span className="text-muted-foreground">{problem.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

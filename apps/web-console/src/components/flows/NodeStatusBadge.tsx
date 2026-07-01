// Per-node run-status badge for the flow run view (change: add-console-flow-monitoring / #366).
//
// Purely presentational: renders the latest node-status snapshot as a labelled, colour-coded badge
// with the attempt number (when > 1) and the elapsed/total duration (derived from the SSE event
// timestamps). Used by the run-view canvas overlay and the node detail panel. Tested in isolation
// (NodeStatusBadge.test.tsx) for all six status values.
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { NodeStatus } from '@/services/flowsMonitoringApi'

interface StatusStyle {
  label: string
  className: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

// Each status maps to a distinct label + colour so the canvas overlay is legible at a glance.
const STATUS_STYLES: Record<NodeStatus, StatusStyle> = {
  scheduled: { label: 'Programado', variant: 'outline', className: 'border-slate-400 text-slate-600' },
  started: { label: 'En ejecución', variant: 'secondary', className: 'bg-sky-100 text-sky-800 border-sky-300' },
  retrying: { label: 'Reintentando', variant: 'secondary', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  completed: { label: 'Completado', variant: 'secondary', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  failed: { label: 'Fallido', variant: 'destructive', className: '' },
  skipped: { label: 'Omitido', variant: 'outline', className: 'border-slate-300 text-slate-400' },
  'waiting-approval': { label: 'Esperando aprobación', variant: 'secondary', className: 'bg-violet-100 text-violet-800 border-violet-300' }
}

// Human-readable duration between two timestamps (ms → "1.2s" / "340ms" / "2m 5s").
export function formatDuration(startedAt?: string | null, completedAt?: string | null): string | null {
  if (!startedAt) return null
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return null
  const end = completedAt ? Date.parse(completedAt) : Date.now()
  if (Number.isNaN(end)) return null
  const ms = Math.max(0, end - start)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export interface NodeStatusBadgeProps {
  status: NodeStatus
  attemptNumber?: number
  startedAt?: string | null
  completedAt?: string | null
  className?: string
}

export function NodeStatusBadge({
  status,
  attemptNumber,
  startedAt,
  completedAt,
  className
}: NodeStatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.scheduled
  const duration = formatDuration(startedAt, completedAt)
  return (
    <Badge
      variant={style.variant}
      data-testid="node-status-badge"
      data-status={status}
      className={cn('gap-1 text-[10px]', style.className, className)}
    >
      <span>{style.label}</span>
      {attemptNumber && attemptNumber > 1 ? (
        <span data-testid="node-status-attempt" className="opacity-80">
          · intento {attemptNumber}
        </span>
      ) : null}
      {duration ? (
        <span data-testid="node-status-duration" className="opacity-80">
          · {duration}
        </span>
      ) : null}
    </Badge>
  )
}

export { STATUS_STYLES }

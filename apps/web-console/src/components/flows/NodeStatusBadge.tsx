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
  scheduled: { label: 'Programado', variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' },
  started: { label: 'En ejecución', variant: 'outline', className: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  retrying: { label: 'Reintentando', variant: 'outline', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  completed: { label: 'Completado', variant: 'outline', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  failed: { label: 'Fallido', variant: 'destructive', className: '' },
  skipped: { label: 'Omitido', variant: 'outline', className: 'border-border bg-background text-muted-foreground' },
  'waiting-approval': { label: 'Esperando aprobación', variant: 'outline', className: 'border-violet-500/30 bg-violet-500/10 text-violet-300' }
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

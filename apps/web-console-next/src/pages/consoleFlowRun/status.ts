import type { JsonValue } from '@in-falcone/console-api/http'
import type { ExecutionDetail, NodeStatus } from './api'

export interface NodeStatusSnapshot {
  nodeId: string
  status: NodeStatus
  attemptNumber: number
  startedAt?: string | null
  completedAt?: string | null
  error?: { message: string; stack?: string } | null
}

// Static (persisted) per-node statuses of a run, seeded from its execution detail.
export function staticStatusesFromDetail(detail: ExecutionDetail | null): Map<string, NodeStatusSnapshot> {
  const map = new Map<string, NodeStatusSnapshot>()
  for (const node of detail?.nodes ?? []) {
    if (!node.status) continue
    map.set(node.nodeId, {
      nodeId: node.nodeId,
      status: node.status,
      attemptNumber: node.attempts?.at(-1)?.attemptNumber ?? 1,
      startedAt: node.attempts?.[0]?.startedAt ?? null,
      completedAt: node.attempts?.at(-1)?.completedAt ?? null,
      error: node.error ?? null,
    })
  }
  return map
}

// A live frame wins over the persisted status, per node.
export function mergeStatuses(persisted: Map<string, NodeStatusSnapshot>, live: Map<string, NodeStatusSnapshot>) {
  const merged = new Map(persisted)
  for (const [nodeId, snapshot] of live) merged.set(nodeId, snapshot)
  return merged
}

// Display-only cap: the full payload stays in memory, only the rendered text is cut.
export const PAYLOAD_DISPLAY_CAP = 4096
export function renderCappedPayload(value: JsonValue | null | undefined): { text: string; truncated: boolean } {
  if (value == null) return { text: '', truncated: false }
  let text: string
  try { text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
  catch { text = String(value) }
  if (text.length > PAYLOAD_DISPLAY_CAP) return { text: `${text.slice(0, PAYLOAD_DISPLAY_CAP)}…`, truncated: true }
  return { text, truncated: false }
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
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export const nodeStatuses: NodeStatus[] = ['scheduled', 'started', 'retrying', 'completed', 'failed', 'skipped', 'waiting-approval']
export const nodeStatusTones = {
  scheduled: 'neutral', started: 'info', retrying: 'warning', completed: 'success', failed: 'destructive', skipped: 'neutral', 'waiting-approval': 'violet',
} as const
// status-dot has no violet tone, so the attempt timeline shows a waiting approval in the primary tone.
export const attemptDotTones = { ...nodeStatusTones, 'waiting-approval': 'primary' } as const
export const runStatusTones = {
  Running: 'info', Completed: 'success', Failed: 'destructive', Canceled: 'neutral', Cancelled: 'neutral', Terminated: 'neutral', TimedOut: 'warning', unknown: 'neutral',
} as const

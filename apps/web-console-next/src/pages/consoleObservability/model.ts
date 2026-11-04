import type { AuditCollectionResponse, ExportResult, OverviewResponse, SeriesResponse, UsageResponse } from './api'

export interface Dimension {
  dimensionId: string; displayName: string; measuredValue: number; hardLimit: number | null; pctUsed: number | null
  policyMode: 'enforced' | 'unbounded' | 'not_enforced'; freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
  isWarning: boolean; isExceeded: boolean; unit?: string
}
export interface MetricsView {
  generatedAt: string; overallPosture: string | null; dimensions: Dimension[]; seriesPoints: Array<{ timestamp: string; value: number }>
}
export interface AuditRecord {
  eventId: string; eventTimestamp: string; correlationId: string | null
  actor: { actorId: string; actorType: string; displayName?: string }
  action: { actionId: string; category: string; subsystem?: string }
  resource: { resourceId: string; resourceType: string; workspaceId?: string } | null
  result: { outcome: string; failureCode?: string } | null
  origin: { ipAddress?: string; userAgent?: string; originSurface?: string } | null
  scope: Record<string, unknown> | null; metadata: Record<string, unknown> | null
}
export interface Manifest { exportId: string; status?: string; itemCount: number; maskedItemCount?: number; items: unknown[]; message?: string }

// Mirrors normalizeMetricsOverview in apps/web-console/src/lib/console-metrics.ts:127-182.
export function normalizeMetrics(overview: OverviewResponse | null | undefined, usage: UsageResponse | null | undefined, series?: SeriesResponse | null): MetricsView {
  const lookup = new Map((usage?.dimensions ?? []).map((dimension) => [dimension.dimensionId ?? dimension.metricKey ?? '', dimension]))
  const dimensions = (overview?.dimensions ?? []).map((dimension): Dimension => {
    const key = dimension.dimensionId ?? ''
    const used = lookup.get(key)
    const measuredValue = typeof dimension.measuredValue === 'number' ? dimension.measuredValue
      : typeof used?.measuredValue === 'number' ? used.measuredValue : typeof used?.value === 'number' ? used.value : 0
    const hardLimit = typeof dimension.hardLimit === 'number' ? dimension.hardLimit : null
    const pctUsed = hardLimit && hardLimit > 0 ? Math.round(measuredValue / hardLimit * 100) : null
    const isExceeded = (pctUsed ?? 0) >= 100
    return { dimensionId: key, displayName: dimension.displayName ?? key, measuredValue, hardLimit, pctUsed, policyMode: dimension.policyMode ?? 'enforced',
      freshnessStatus: dimension.freshnessStatus ?? 'fresh', isWarning: !isExceeded && (pctUsed ?? 0) >= 80, isExceeded, unit: dimension.unit }
  })
  // Empty series points fall back to the usage points, as the legacy page does.
  const seriesPoints = series?.points?.length
    ? series.points.map((point) => ({ timestamp: point.timestamp ?? '', value: point.value ?? 0 }))
    : (usage?.dimensions ?? []).flatMap((dimension) => (dimension.points ?? []).map((point) => ({ timestamp: point.timestamp ?? '', value: point.value ?? 0 })))
  return { generatedAt: overview?.generatedAt ?? usage?.measuredAt ?? '', overallPosture: overview?.overallPosture ?? null, dimensions, seriesPoints }
}

export function normalizeAuditRecord(record: Record<string, any>): AuditRecord {
  return {
    eventId: record.eventId ?? '', eventTimestamp: record.eventTimestamp ?? '', correlationId: record.correlationId ?? null,
    actor: { actorId: record.actor?.actorId ?? '', actorType: record.actor?.actorType ?? 'unknown', displayName: record.actor?.displayName },
    action: { actionId: record.action?.actionId ?? '', category: record.action?.category ?? 'unknown', subsystem: record.action?.subsystem },
    resource: record.resource ? { resourceId: record.resource.resourceId ?? '', resourceType: record.resource.resourceType ?? 'unknown', workspaceId: record.resource.workspaceId } : null,
    result: record.result ? { outcome: record.result.outcome ?? 'unknown', failureCode: record.result.failureCode } : null,
    origin: record.origin ? { ipAddress: record.origin.ipAddress, userAgent: record.origin.userAgent, originSurface: record.origin.originSurface } : null,
    scope: record.scope ?? null, metadata: record.metadata ?? null,
  }
}

export function normalizeAuditPage(response: AuditCollectionResponse | null | undefined) {
  const nextCursor = typeof response?.page?.nextCursor === 'string' && response.page.nextCursor ? response.page.nextCursor : null
  return { records: (response?.items ?? []).map(normalizeAuditRecord), nextCursor, hasMore: response?.page?.hasMore === true && nextCursor !== null }
}

// A manifest needs a non-empty exportId, a numeric itemCount and an items array.
export function isManifest(result: ExportResult): result is Manifest & Record<string, unknown> {
  return Boolean(result && typeof result === 'object' && typeof result.exportId === 'string' && result.exportId.length > 0 &&
    typeof result.itemCount === 'number' && Array.isArray(result.items))
}
export const exportStatus = (result: ExportResult) => result && typeof result === 'object' && typeof result.status === 'string' && result.status.trim() ? result.status.trim() : null
export const exportId = (result: ExportResult) => result && typeof result === 'object' && typeof result.exportId === 'string' && result.exportId.trim() ? result.exportId.trim() : null
export const exportMessage = (result: ExportResult) => result && typeof result === 'object' && typeof result.message === 'string' && result.message.trim() ? result.message.trim() : null

export function formatBytes(value: number) {
  if (Number.isNaN(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = value, index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++ }
  return `${index ? size.toFixed(size >= 10 ? 0 : 1) : size} ${units[index]}`
}
// Legacy fallback: bytes by unit, or by a dimension id ending in bytes when the unit is absent.
export function formatDimensionValue(value: number, dimension: Pick<Dimension, 'unit' | 'dimensionId'>) {
  return dimension.unit === 'bytes' || (!dimension.unit && /(?:^|[._])bytes$/i.test(dimension.dimensionId)) ? formatBytes(value) : String(value)
}
export function downloadName(id: string) { return `${id.replace(/[^a-zA-Z0-9_.-]/g, '-') || 'audit-export'}.json` }

// Local calendar days, as the legacy <input type="date"> produced and consumed them.
export function toDay(date: Date | null) {
  if (!date) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export function fromDay(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

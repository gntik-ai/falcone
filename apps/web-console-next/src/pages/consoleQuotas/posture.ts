import type { QuotaDimension, QuotaOverviewResponse, QuotaPostureResponse } from '@in-falcone/console-api/clients'

export interface Dimension extends QuotaDimension {
  dimensionId: string
  displayName: string
  hardLimit: number | null
  measuredValue: number
  pctUsed: number | null
  policyMode: 'enforced' | 'unbounded' | 'not_enforced'
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
  isWarning: boolean
  isExceeded: boolean
}
export function normalize(posture: QuotaPostureResponse, overview: QuotaOverviewResponse) {
  const breaches = [...new Set([...(posture.hardLimitBreaches ?? []), ...(overview.hardLimitDimensions ?? [])])]
  return {
    evaluatedAt: posture.evaluatedAt ?? null,
    overallPosture: overview.overallPosture ?? 'unknown',
    dimensions: (posture.dimensions ?? []).map((row): Dimension => {
      const hardLimit = typeof row.hardLimit === 'number' ? row.hardLimit : null
      const measuredValue = row.measuredValue ?? 0
      const pctUsed = hardLimit && hardLimit > 0 ? Math.round(measuredValue / hardLimit * 100) : null
      const isExceeded = (pctUsed ?? 0) >= 100 || breaches.includes(row.dimensionId ?? '')
      return { ...row, dimensionId: row.dimensionId ?? '', displayName: row.displayName ?? row.dimensionId ?? '',
        hardLimit, measuredValue, pctUsed, isExceeded, isWarning: !isExceeded && (pctUsed ?? 0) >= 80,
        policyMode: row.policyMode ?? 'enforced', freshnessStatus: row.freshnessStatus ?? 'fresh' }
    }),
  }
}
export type Posture = ReturnType<typeof normalize>
export function formatValue(value: number, row: Dimension) {
  if (row.unit !== 'bytes' && (row.unit || !/(?:^|[._])bytes$/i.test(row.dimensionId))) return String(value)
  if (Number.isNaN(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = value, index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++ }
  return `${index ? size.toFixed(size >= 10 ? 0 : 1) : size} ${units[index]}`
}

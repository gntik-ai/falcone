import type { AllocationDimension } from './api'

export function formatAllocationValue(value: number, row: Pick<AllocationDimension, 'unit' | 'dimensionKey'>, locale: string, unlimited: string) {
  if (value === -1) return unlimited
  const bytes = row.unit === 'bytes' || (!row.unit && /(?:^|[._])bytes$/i.test(row.dimensionKey))
  if (bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    let amount = value
    let index = 0
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++ }
    const digits = index > 0 && amount < 10 ? 1 : 0
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)} ${units[index]}`
  }
  const formatted = new Intl.NumberFormat(locale).format(value)
  return row.unit?.trim() ? `${formatted} ${row.unit.trim()}` : formatted
}

export function workspaceLabel(workspace: AllocationDimension['workspaces'][number], index: number, fallback: (number: number) => string) {
  const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  const label = [workspace.displayLabel, workspace.workspaceDisplayName, workspace.workspaceName, workspace.workspaceSlug, workspace.name, workspace.slug]
    .find((value) => value?.trim() && !uuid(value.trim()))
  return label?.trim() || (uuid(workspace.workspaceId) ? fallback(index + 1) : workspace.workspaceId)
}

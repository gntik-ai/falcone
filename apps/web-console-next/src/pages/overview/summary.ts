import type { TenantQuotaProfile, TenantInventoryResponse } from '@in-falcone/console-api/clients'

// Keep derivation identical to the legacy console context.
export type ConsoleQuotaSeverity = 'nominal' | 'warning' | 'blocked'

export interface ConsoleQuotaSummaryItem {
  metricKey: string
  scope: string
  used: number
  limit: number
  remaining: number
  utilizationPercent: number
  severity: ConsoleQuotaSeverity
  unit: string | null
}

export interface ConsoleQuotaSummary {
  totals: Record<ConsoleQuotaSeverity, number>
  items: ConsoleQuotaSummaryItem[]
}

export interface ConsoleInventoryWorkspaceSummary {
  workspaceId: string
  workspaceSlug: string
  environment: string | null
  state: string | null
  applicationCount: number
  serviceAccountCount: number
  managedResourceCount: number
}

export interface ConsoleTenantInventorySummary {
  tenantId: string
  workspaceCount: number
  applicationCount: number
  managedResourceCount: number
  serviceAccountCount: number
  workspaces: ConsoleInventoryWorkspaceSummary[]
}

export function summarizeTenantQuotaProfile(profile?: TenantQuotaProfile | null): ConsoleQuotaSummary | null {
  if (!profile) {
    return null
  }

  const items = Array.isArray(profile.limits)
    ? profile.limits.map((limit) => {
        const utilizationPercent = deriveUtilizationPercent(limit.limit, limit.used)
        const severity = deriveQuotaSeverity(limit.limit, limit.used, limit.remaining, utilizationPercent)

        return {
          metricKey: limit.metricKey,
          scope: limit.scope,
          used: limit.used,
          limit: limit.limit,
          remaining: limit.remaining,
          utilizationPercent,
          severity,
          unit: limit.unit?.trim() || null
        } satisfies ConsoleQuotaSummaryItem
      })
    : []

  const totals: Record<ConsoleQuotaSeverity, number> = {
    nominal: items.filter((item) => item.severity === 'nominal').length,
    warning: items.filter((item) => item.severity === 'warning').length,
    blocked: items.filter((item) => item.severity === 'blocked').length
  }

  return {
    totals,
    items: items.sort((left, right) => quotaSeverityRank(right.severity) - quotaSeverityRank(left.severity))
  }
}

export function normalizeTenantInventorySummary(summary?: TenantInventoryResponse | null): ConsoleTenantInventorySummary | null {
  if (!summary) {
    return null
  }

  return {
    tenantId: summary.tenantId,
    workspaceCount: summary.workspaceCount,
    applicationCount: summary.applicationCount,
    managedResourceCount: summary.managedResourceCount,
    serviceAccountCount: summary.serviceAccountCount,
    workspaces: Array.isArray(summary.workspaces)
      ? summary.workspaces.map((workspace) => ({
          workspaceId: workspace.workspaceId,
          workspaceSlug: workspace.workspaceSlug,
          environment: workspace.environment ?? null,
          state: workspace.state ?? null,
          applicationCount: workspace.applicationCount,
          serviceAccountCount: workspace.serviceAccountCount,
          managedResourceCount: workspace.managedResourceCount
        }))
      : []
  }
}

function deriveUtilizationPercent(limit: number, used: number): number {
  if (limit <= 0) {
    return used > 0 ? 100 : 0
  }

  return Math.round((used / limit) * 1000) / 10
}

function deriveQuotaSeverity(
  limit: number,
  used: number,
  remaining: number,
  utilizationPercent: number
): ConsoleQuotaSeverity {
  if (remaining <= 0 || (limit > 0 && used >= limit)) {
    return 'blocked'
  }

  if (utilizationPercent >= 80) {
    return 'warning'
  }

  return 'nominal'
}

function quotaSeverityRank(value: ConsoleQuotaSeverity): number {
  if (value === 'blocked') {
    return 3
  }

  if (value === 'warning') {
    return 2
  }

  return 1
}

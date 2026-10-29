import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

// Pinned to the legacy AllocationSummary contract until plans OpenAPI is published.
export interface AllocationDimension {
  dimensionKey: string
  displayLabel: string
  unit?: string | null
  tenantEffectiveValue: number
  totalAllocated: number
  unallocated: number | null
  workspaces: Array<{
    workspaceId: string
    allocatedValue: number
    displayLabel?: string | null
    workspaceDisplayName?: string | null
    workspaceName?: string | null
    workspaceSlug?: string | null
    name?: string | null
    slug?: string | null
  }>
  isFullyAllocated: boolean
}
export interface AllocationSummary { tenantId: string; dimensions: AllocationDimension[] }

export function getTenantAllocationSummary() {
  return requestConsoleSessionJson<AllocationSummary>('/v1/tenant/plan/allocation-summary', { method: 'GET' })
}

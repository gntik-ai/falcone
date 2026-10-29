import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived'
export interface PlanRecord {
  id: string
  slug: string
  displayName: string
  description?: string | null
  status: PlanStatus
  capabilities: Record<string, boolean>
  quotaDimensions: Record<string, number>
  assignedTenantCount?: number
  updatedAt?: string
}
export interface PlanQuery { status: PlanStatus | 'all'; page: number; pageSize: number }
export interface PlanPage { items: PlanRecord[]; total: number; page: number; pageSize: number }

export async function listPlans({ status, page = 1, pageSize = 20 }: PlanQuery) {
  const search = new URLSearchParams()
  if (status !== 'all') search.set('status', status)
  search.set('page', String(page))
  search.set('pageSize', String(pageSize))
  const response = await requestConsoleSessionJson<Partial<PlanPage> & { plans?: PlanRecord[] }>(`/v1/plans?${search}`, { method: 'GET' })
  const items = response.items ?? response.plans ?? []
  return { items, total: response.total ?? items.length, page: response.page ?? page, pageSize: response.pageSize ?? pageSize }
}

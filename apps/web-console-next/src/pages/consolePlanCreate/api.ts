import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export interface PlanCreateBody {
  slug: string
  displayName: string
  description: string
  capabilities: Record<string, never>
  quotaDimensions: Record<string, never>
}

export function createPlan(body: PlanCreateBody) {
  return requestConsoleSessionJson<{ id: string }>('/v1/plans', { method: 'POST', body: { ...body } })
}

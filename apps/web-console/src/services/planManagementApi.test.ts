import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@in-falcone/console-api/session', () => ({ requestConsoleSessionJson: vi.fn() }))

import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { getMyPlanHistory, getPlanLifecycleHistory, type PlanLifecycleHistoryEntry, type PaginationEnvelope } from './planManagementApi'

const request = vi.mocked(requestConsoleSessionJson)
const item = {
  assignmentId: 'assignment-current', planId: 'plan-starter', planSlug: 'starter',
  planDisplayName: 'Starter', planStatus: 'active',
  effectiveFrom: '2026-03-01T00:00:00Z', supersededAt: null
}

beforeEach(() => { request.mockReset() })

describe('getMyPlanHistory', () => {
  it('normalizes assignments from the self-history response and sends pagination only', async () => {
    request.mockResolvedValue({ tenantId: 'tenant-own', assignments: [item], total: 3, page: 2, pageSize: 2 })
    expect(await getMyPlanHistory({ page: 2, pageSize: 2 })).toEqual({ items: [item], total: 3, page: 2, pageSize: 2 })
    expect(request).toHaveBeenCalledWith('/v1/tenant/plan/history?page=2&pageSize=2', { method: 'GET', body: undefined })
  })

  it('defaults missing pagination from the request and total from the returned items', async () => {
    request.mockResolvedValue({ assignments: [item] })
    expect(await getMyPlanHistory({ page: 3, pageSize: 5 })).toEqual({ items: [item], total: 1, page: 3, pageSize: 5 })
  })

  it('uses page 1 and pageSize 20 by default and normalizes an empty response', async () => {
    request.mockResolvedValue({})
    expect(await getMyPlanHistory()).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    expect(request).toHaveBeenCalledWith('/v1/tenant/plan/history?page=1&pageSize=20', { method: 'GET', body: undefined })
  })

  it('prefers items when present and preserves zero totals', async () => {
    request.mockResolvedValue({ items: [], assignments: [item], total: 0, page: 2, pageSize: 10 })
    expect(await getMyPlanHistory()).toEqual({ items: [], total: 0, page: 2, pageSize: 10 })
  })
})

describe('getPlanLifecycleHistory', () => {
  it('requests the plan lifecycle route with pagination and preserves its typed envelope', async () => {
    const envelope: PaginationEnvelope<PlanLifecycleHistoryEntry> = {
      items: [{ id: 'event-1', planId: 'plan-a', previousStatus: null, newStatus: 'active', transitionedAt: '2026-02-01T00:00:00.000Z', actorId: 'admin-1', correlationId: 'request-1' }],
      total: 4, page: 2, pageSize: 3
    }
    request.mockResolvedValue(envelope)
    expect(await getPlanLifecycleHistory('plan-a', { page: 2, pageSize: 3 })).toEqual(envelope)
    expect(request).toHaveBeenCalledWith('/v1/plans/plan-a/lifecycle-history?page=2&pageSize=3', { method: 'GET', body: undefined })
  })

  it('uses the default pagination and propagates unavailable history', async () => {
    request.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' }))
    await expect(getPlanLifecycleHistory('plan-a')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(request).toHaveBeenCalledWith('/v1/plans/plan-a/lifecycle-history?page=1&pageSize=20', { method: 'GET', body: undefined })
  })
})

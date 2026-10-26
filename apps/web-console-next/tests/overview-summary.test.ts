import { expect, test } from 'vitest'
import { normalizeTenantInventorySummary, summarizeTenantQuotaProfile } from '../src/pages/overview/summary'
import { overviewTenant } from './parity/fixtures/overview'

test('matches the legacy nominal, warning, blocked totals, ordering and unit normalization', () => {
  expect(summarizeTenantQuotaProfile(overviewTenant.quotaProfile)).toEqual({
    totals: { nominal: 1, warning: 1, blocked: 1 }, items: [
      { metricKey: 'invocations_per_minute', scope: 'workspace', used: 1000, limit: 1000, remaining: 0, unit: 'rpm', utilizationPercent: 100, severity: 'blocked' },
      { metricKey: 'applications', scope: 'tenant', used: 80, limit: 100, remaining: 20, unit: null, utilizationPercent: 80, severity: 'warning' },
      { metricKey: 'workspaces', scope: 'tenant', used: 2, limit: 10, remaining: 8, unit: null, utilizationPercent: 20, severity: 'nominal' },
    ],
  })
})
test.each([
  [0, 0, 1, 0, 'nominal'], [0, 1, 1, 100, 'warning'], [0, 0, 0, 0, 'blocked'],
  [-1, 2, 1, 100, 'warning'], [1000, 799, 201, 79.9, 'nominal'], [1000, 800, 200, 80, 'warning'],
  [1000, 1001, 1, 100.1, 'blocked'], [1000, 1, -1, 0.1, 'blocked'], [3, 1, 2, 33.3, 'nominal'],
])('preserves legacy edge result for limit %s, used %s and remaining %s', (limit, used, remaining, utilizationPercent, severity) => {
  const profile = { limits: [{ metricKey: 'metric', scope: 'tenant', limit, used, remaining }] }
  expect(summarizeTenantQuotaProfile(profile)?.items[0]).toMatchObject({ utilizationPercent, severity })
})
test('distinguishes missing and empty quota profiles', () => {
  expect(summarizeTenantQuotaProfile()).toBeNull()
  expect(summarizeTenantQuotaProfile(null)).toBeNull()
  for (const profile of [{}, { limits: [] }]) expect(summarizeTenantQuotaProfile(profile)).toEqual({ totals: { nominal: 0, warning: 0, blocked: 0 }, items: [] })
})
test('normalizes inventory with and without workspace details as legacy does', () => {
  expect(normalizeTenantInventorySummary()).toBeNull()
  expect(normalizeTenantInventorySummary(null)).toBeNull()
  expect(normalizeTenantInventorySummary(overviewTenant.inventorySummary)).toEqual({
    ...overviewTenant.inventorySummary, workspaces: overviewTenant.inventorySummary.workspaces.map((item) => ({ ...item, environment: null, state: null })),
  })
  const { workspaces, ...summary } = overviewTenant.inventorySummary
  expect(normalizeTenantInventorySummary(summary)).toEqual({ ...summary, workspaces: [] })
  expect(normalizeTenantInventorySummary({ ...summary, workspaces: [{ ...workspaces[0], state: 'active', environment: 'prod' }] })?.workspaces[0]).toMatchObject({ state: 'active', environment: 'prod' })
})

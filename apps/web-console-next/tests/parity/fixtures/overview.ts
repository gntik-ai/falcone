import { buildTenantFixture, buildTenantCollectionFixture } from '@in-falcone/console-api/fixtures'

export const overviewTenant = {
  ...buildTenantFixture(),
  quotaProfile: { limits: [
    { metricKey: 'workspaces', scope: 'tenant', used: 2, limit: 10, remaining: 8, unit: ' ' },
    { metricKey: 'applications', scope: 'tenant', used: 80, limit: 100, remaining: 20 },
    { metricKey: 'invocations_per_minute', scope: 'workspace', used: 1000, limit: 1000, remaining: 0, unit: 'rpm' },
  ] },
  inventorySummary: {
    tenantId: 'synthetic-tenant', workspaceCount: 2, applicationCount: 12345, managedResourceCount: 19876, serviceAccountCount: 4321,
    workspaces: [
      { workspaceId: 'synthetic-workspace', workspaceSlug: 'workspace-prod', applicationCount: 12340, serviceAccountCount: 4320, managedResourceCount: 19865 },
      { workspaceId: 'synthetic-workspace-dev', workspaceSlug: 'workspace-dev', applicationCount: 5, serviceAccountCount: 1, managedResourceCount: 11 },
    ],
  },
}
export const overviewVariants = ['overview-summaries', 'overview-no-tenant', 'overview-multiple-tenants', 'overview-without-summaries', 'overview-empty-quotas', 'overview-no-workspaces'] as const
export type OverviewVariant = typeof overviewVariants[number]

export function overviewResponse(name: string, variant: OverviewVariant) {
  const tenant = structuredClone(overviewTenant)
  if (variant === 'overview-without-summaries') { delete (tenant as Partial<typeof tenant>).quotaProfile; delete (tenant as Partial<typeof tenant>).inventorySummary }
  if (variant === 'overview-empty-quotas') tenant.quotaProfile.limits = []
  if (variant === 'overview-no-workspaces') tenant.inventorySummary.workspaces = []
  if (name === 'tenant') return { status: 200, body: variant === 'overview-no-tenant' ? {} : tenant }
  const collection = buildTenantCollectionFixture()
  const items = variant === 'overview-no-tenant' ? [] : variant === 'overview-multiple-tenants'
    ? [tenant, { ...tenant, tenantId: 'synthetic-tenant-other', displayName: 'Synthetic Other Tenant', slug: 'synthetic-other' }] : [tenant]
  return { status: 200, body: { ...collection, items } }
}

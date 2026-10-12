import { getTenant, listTenants, listWorkspaces } from './clients'
import type { Tenant, TenantCollectionResponse, WorkspaceCollectionResponse } from './types'

// Fetch the list of tenants accessible to the current user.
// Platform users (superadmin / platform_admin / platform_operator): use the collection
// endpoint GET /v1/tenants. Tenant operators (tenant_owner / tenant_admin): use the
// own-scope singular endpoint GET /v1/tenants/{tenantId} per tenantId in their session —
// the collection endpoint is superadmin-only and 403s for them. A tenant operator with no
// tenantIds returns an empty collection rather than calling the superadmin endpoint. (#569)
export async function listAccessibleTenants(options: {
  isTenantOperator: boolean
  ownTenantIds: string[]
}): Promise<TenantCollectionResponse> {
  if (options.isTenantOperator) {
    if (options.ownTenantIds.length === 0) {
      return { items: [], page: { after: null } }
    }
    const responses = await Promise.all(
      options.ownTenantIds.map((tenantId) =>
        getTenant(tenantId)
      )
    )
    const items = responses
      .map((res) => (res.tenant ? res.tenant : (res as Tenant)))
      .filter((t): t is Tenant => Boolean(t?.tenantId))
    return { items, page: { after: null } }
  }
  return listTenants()
}

export async function listAccessibleWorkspaces(tenantId: string): Promise<WorkspaceCollectionResponse> {
  return listWorkspaces(tenantId)
}

import { requestConsoleSessionJson } from './session'
import type { Tenant, TenantCollectionResponse, WorkspaceCollectionResponse } from './types'

export type * from './types'
export {
  getConsoleSignupPolicy,
  createConsoleLoginSession,
  refreshConsoleLoginSession,
  terminateConsoleLoginSession,
  createConsoleSignup,
  createConsolePasswordRecoveryRequest,
  getConsoleAccountStatusView
} from './auth'

export function listTenants(signal?: AbortSignal): Promise<TenantCollectionResponse> {
  const searchParams = new URLSearchParams({ 'page[size]': '100', sort: 'displayName' })
  return requestConsoleSessionJson<TenantCollectionResponse>(`/v1/tenants?${searchParams.toString()}`, { signal })
}

export function getTenant(tenantId: string, signal?: AbortSignal): Promise<{ tenant?: Tenant } & Tenant> {
  return requestConsoleSessionJson<{ tenant?: Tenant } & Tenant>(`/v1/tenants/${tenantId}`, { signal })
}

export function listWorkspaces(tenantId: string, signal?: AbortSignal): Promise<WorkspaceCollectionResponse> {
  const searchParams = new URLSearchParams({ 'page[size]': '100', sort: 'displayName' })
  searchParams.set('filter[tenantId]', tenantId)
  return requestConsoleSessionJson<WorkspaceCollectionResponse>(`/v1/workspaces?${searchParams.toString()}`, { signal })
}

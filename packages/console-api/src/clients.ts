import { requestConsoleSessionJson } from './session'
import type {
  IamUserGroupMembershipResponse,
  IamUserRoleAssignmentResponse,
  IamUserRoleRemovalResponse,
  Tenant,
  TenantCollectionResponse,
  WorkspaceCollectionResponse
} from './types'

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

export function assignIamUserRoles(realmId: string, userId: string, roles: string[], signal?: AbortSignal): Promise<IamUserRoleAssignmentResponse> {
  return requestConsoleSessionJson<IamUserRoleAssignmentResponse>(
    `/v1/iam/realms/${encodeURIComponent(realmId)}/users/${encodeURIComponent(userId)}/role-assignments`,
    { method: 'POST', body: { roles }, signal }
  )
}

export function removeIamUserRoles(realmId: string, userId: string, roles: string[], signal?: AbortSignal): Promise<IamUserRoleRemovalResponse> {
  return requestConsoleSessionJson<IamUserRoleRemovalResponse>(
    `/v1/iam/realms/${encodeURIComponent(realmId)}/users/${encodeURIComponent(userId)}/role-assignments`,
    { method: 'DELETE', body: { roles }, signal }
  )
}

export function addIamUserToGroup(realmId: string, userId: string, groupId: string, signal?: AbortSignal): Promise<IamUserGroupMembershipResponse> {
  return requestConsoleSessionJson<IamUserGroupMembershipResponse>(
    `/v1/iam/realms/${encodeURIComponent(realmId)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'PUT', signal }
  )
}

export function removeIamUserFromGroup(realmId: string, userId: string, groupId: string, signal?: AbortSignal): Promise<IamUserGroupMembershipResponse> {
  return requestConsoleSessionJson<IamUserGroupMembershipResponse>(
    `/v1/iam/realms/${encodeURIComponent(realmId)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE', signal }
  )
}

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

// Quota page contracts are pinned to the legacy metrics and plan clients until publication.
export interface QuotaDimension {
  dimensionId?: string
  displayName?: string
  policyMode?: 'enforced' | 'unbounded' | 'not_enforced'
  hardLimit?: number | null
  softLimit?: number | null
  measuredValue?: number
  remainingToHardLimit?: number | null
  freshnessStatus?: 'fresh' | 'degraded' | 'unavailable'
  unit?: string
}
export interface QuotaPostureResponse {
  evaluatedAt?: string
  dimensions?: QuotaDimension[]
  hardLimitBreaches?: string[]
}
export interface QuotaOverviewResponse {
  generatedAt?: string
  overallPosture?: string
  hardLimitDimensions?: string[]
}
export interface QuotaTenantPlan {
  noAssignment?: boolean
  assignment?: { planId?: string }
  plan?: { id?: string; displayName?: string; status?: string }
}
export function getTenantQuotaPosture(tenantId: string) {
  return requestConsoleSessionJson<QuotaPostureResponse>(`/v1/metrics/tenants/${tenantId}/quotas`)
}
export function getTenantQuotaOverview(tenantId: string) {
  return requestConsoleSessionJson<QuotaOverviewResponse>(`/v1/metrics/tenants/${tenantId}/overview`)
}
export function getWorkspaceQuotaPosture(workspaceId: string) {
  return requestConsoleSessionJson<QuotaPostureResponse>(`/v1/metrics/workspaces/${workspaceId}/quotas`)
}
export function getWorkspaceQuotaOverview(workspaceId: string) {
  return requestConsoleSessionJson<QuotaOverviewResponse>(`/v1/metrics/workspaces/${workspaceId}/overview`)
}
export function getQuotaTenantPlan(tenantId: string) {
  return requestConsoleSessionJson<QuotaTenantPlan>(`/v1/tenants/${tenantId}/plan`)
}
export function setQuotaPlanLimit(planId: string, dimensionKey: string, value: number) {
  return requestConsoleSessionJson<{ planId: string; dimensionKey: string; newValue: number; source: string }>(
    `/v1/plans/${planId}/limits/${dimensionKey}`, { method: 'PUT', body: { value } })
}

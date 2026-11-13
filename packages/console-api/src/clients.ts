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

// Pinned to planManagementApi's workspace consumption contract until OpenAPI publication.
export interface WorkspaceConsumptionResponse {
  tenantId: string
  workspaceId: string
  snapshotAt: string
  dimensions: Array<{
    dimensionKey: string
    displayLabel: string
    unit?: string | null
    tenantEffectiveValue: number
    workspaceLimit: number | null
    workspaceSource: 'workspace_sub_quota' | 'tenant_shared_pool'
    currentUsage: number | null
    usageStatus: 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'
    usageUnknownReason?: string | null
  }>
  capabilities?: Array<{
    capabilityKey: string
    displayLabel?: string
    enabled: boolean
    source?: 'plan' | 'catalog_default'
  }>
}
export function getWorkspaceConsumption(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceConsumptionResponse> {
  return requestConsoleSessionJson<WorkspaceConsumptionResponse>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/consumption`, { method: 'GET', signal })
}

// Workspace database: identical to the legacy page requests, including empty mutation bodies.
export interface WorkspaceDatabaseRecord {
  id: string
  workspace_id: string
  tenant_id: string
  database_name: string
  engine: string
  mode: string
  username: string
  host: string
  port: number
  status: string
  created_at: string
}

export interface DatabaseConnection {
  mode: string
  engine: string
  database: string
  host: string
  port: number
  username: string
  password: string | null
  passwordHint: string | null
  dsn: string
  sslmode: string
}

export interface ProvisionResponse {
  database: WorkspaceDatabaseRecord
  connection: DatabaseConnection
  sagaId?: string
}

export interface GetResponse {
  database: WorkspaceDatabaseRecord
}

export interface RotateResponse {
  databaseId: string
  rotated: boolean
  reason?: string
  mode?: string
  database?: string
  username?: string
  password?: string
  dsn?: string
}

const workspaceDatabasePath = (workspaceId: string) => `/v1/workspaces/${encodeURIComponent(workspaceId)}/database`
export const getWorkspaceDatabase = (workspaceId: string) => requestConsoleSessionJson<GetResponse>(workspaceDatabasePath(workspaceId))
export const provisionWorkspaceDatabase = (workspaceId: string) => requestConsoleSessionJson<ProvisionResponse>(workspaceDatabasePath(workspaceId), { method: 'POST', body: {} })
export const rotateWorkspaceDatabaseCredential = (workspaceId: string) => requestConsoleSessionJson<RotateResponse>(`${workspaceDatabasePath(workspaceId)}/credential-rotations`, { method: 'POST', body: {} })

export interface TenantCollectionResponse {
  items: Tenant[]
  page: PageInfo
}

export interface WorkspaceCollectionResponse {
  items: Workspace[]
  page: PageInfo
}

export interface PageInfo {
  after?: string | null
}

export interface ProvisioningSummary {
  status?: string
}

export interface TenantGovernanceProfile {
  governanceStatus?: string
}

export interface TenantIdentityContext {
  consoleUserRealm?: string
}

export interface TenantQuotaLimit {
  metricKey: string
  scope: string
  limit: number
  used: number
  remaining: number
  unit?: string
}

export interface TenantQuotaProfile {
  governanceStatus?: string
  limits?: TenantQuotaLimit[]
}

export interface TenantInventoryWorkspaceSummary {
  workspaceId: string
  workspaceSlug: string
  environment?: string
  state?: string
  applicationCount: number
  serviceAccountCount: number
  managedResourceCount: number
}

export interface TenantInventoryResponse {
  tenantId: string
  workspaceCount: number
  applicationCount: number
  managedResourceCount: number
  serviceAccountCount: number
  workspaces?: TenantInventoryWorkspaceSummary[]
}

export interface Tenant {
  tenantId: string
  displayName: string
  slug: string
  state?: string
  governance?: TenantGovernanceProfile
  identityContext?: TenantIdentityContext
  provisioning?: ProvisioningSummary
  quotaProfile?: TenantQuotaProfile
  inventorySummary?: TenantInventoryResponse
}

export interface Workspace {
  workspaceId: string
  tenantId: string
  displayName: string
  slug: string
  environment?: string
  state?: string
  provisioning?: ProvisioningSummary
}

import { type Page, type Route } from '@playwright/test'

export interface E2ESession {
  sessionId: string
  principal: {
    userId: string
    platformRoles: string[]
    tenantIds: string[]
    workspaceIds: string[]
  }
}

export interface E2ETenant {
  tenantId: string
  displayName: string
  slug: string
  state: 'active' | 'suspended'
  identityContext?: { consoleUserRealm?: string }
  governance?: { governanceStatus: string }
}

export interface E2EWorkspace {
  workspaceId: string
  tenantId: string
  state: 'active' | 'provisioning'
  displayName: string
  slug: string
}

export interface E2EIamUser {
  userId: string
  realmId: string
  username: string
  email: string
  enabled: boolean
  state: string
  realmRoles: string[]
  requiredActions: string[]
}

export interface E2EIamRole {
  realmId: string
  roleName: string
  composite: boolean
  compositeRoles: string[]
}

export interface E2EIamScope {
  scopeName: string
  protocol: 'openid-connect' | 'saml'
  isDefault: boolean
  isOptional?: boolean
  includeInTokenScope?: boolean
  assignedClientIds?: string[]
}

export interface E2EIamClient {
  clientId: string
  protocol: 'openid-connect' | 'saml'
  accessType: 'public' | 'confidential' | 'bearer_only'
  enabled: boolean
  state: string
  redirectUris?: string[]
  defaultScopes?: string[]
  optionalScopes?: string[]
}

type ConsoleLoginSession = E2ESession & {
  authenticationState: 'active'
  statusView: 'login'
  issuedAt: string
  lastActivityAt: string
  expiresAt: string
  idleExpiresAt: string
  refreshExpiresAt: string
  sessionPolicy: {
    idleTimeout: string
    maxLifetime: string
    refreshTokenMaxAge: string
  }
  tokenSet: {
    accessToken: string
    expiresAt: string
    expiresIn: number
    refreshExpiresAt: string
    refreshExpiresIn: number
    refreshToken: string
    scope: string
    tokenType: 'Bearer'
  }
  principal: E2ESession['principal'] & {
    displayName: string
    primaryEmail: string
    state: 'active'
    username: string
  }
}

type MockInvitation = {
  invitationId: string
  tenantId: string
  email: string
  roleName: string
  state: 'pending' | 'revoked'
}

type ExternalApplication = {
  applicationId: string
  entityType: 'external_application'
  displayName: string
  slug: string
  protocol: 'oidc' | 'saml' | 'api_key'
  state: string
  authenticationFlows: string[]
  redirectUris: string[]
  scopes: Array<{ scopeName: string; consentRequired?: boolean; description?: string }>
  federatedProviders?: Array<{
    providerId: string
    alias: string
    displayName: string
    protocol: 'oidc' | 'saml'
    providerMode: 'metadata_url' | 'inline_metadata' | 'manual_endpoints'
    enabled?: boolean
  }>
  validation?: {
    status: 'valid' | 'warning' | 'invalid' | 'pending'
    checks?: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string }>
  }
  login?: {
    redirectUris?: string[]
  }
  logout?: {
    frontChannelLogoutUri?: string
  }
}

const IAM_COMPATIBILITY = {
  provider: 'keycloak' as const,
  contractVersion: '2026-03-29',
  supportedVersions: ['2026-03-29'],
  adminApiStability: 'stable_v1' as const
}

const PAGE_INFO = (size: number) => ({ size, number: 1, total: size, totalPages: 1 })

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function listResponse<T>(items: T[]) {
  return { items, page: PAGE_INFO(items.length) }
}

function iamListResponse<T>(items: T[]) {
  return { items, page: PAGE_INFO(items.length), compatibility: IAM_COMPATIBILITY }
}

function tenantPayload(tenant: E2ETenant) {
  return {
    tenantId: tenant.tenantId,
    displayName: tenant.displayName,
    slug: tenant.slug,
    state: tenant.state,
    identityContext: tenant.identityContext,
    governance: tenant.governance ?? { governanceStatus: tenant.state === 'suspended' ? 'restricted' : 'nominal' },
    provisioning: { status: tenant.state === 'suspended' ? 'restricted' : 'ready' },
    quotaProfile: { limits: { workspaces: 10, members: 25 } }
  }
}

function workspacePayload(workspace: E2EWorkspace) {
  return {
    workspaceId: workspace.workspaceId,
    tenantId: workspace.tenantId,
    displayName: workspace.displayName,
    slug: workspace.slug,
    state: workspace.state,
    environment: workspace.slug,
    provisioning: { status: workspace.state === 'provisioning' ? 'in_progress' : 'ready' }
  }
}

function invitationPayload(invitation: MockInvitation) {
  return {
    invitationId: invitation.invitationId,
    tenantId: invitation.tenantId,
    email: invitation.email,
    roleName: invitation.roleName,
    state: invitation.state
  }
}

export const SESSION_OPS_MULTI_TENANT: ConsoleLoginSession = {
  sessionId: 'ses_e2e_ctx_001',
  authenticationState: 'active',
  statusView: 'login',
  issuedAt: '2026-03-29T00:00:00.000Z',
  lastActivityAt: '2026-03-29T00:00:05.000Z',
  expiresAt: '2099-03-29T01:00:00.000Z',
  idleExpiresAt: '2099-03-29T00:30:00.000Z',
  refreshExpiresAt: '2099-03-30T00:00:00.000Z',
  sessionPolicy: {
    idleTimeout: 'PT30M',
    maxLifetime: 'PT12H',
    refreshTokenMaxAge: 'P1D'
  },
  tokenSet: {
    accessToken: 'access.console.ctx.token',
    expiresAt: '2099-03-29T01:00:00.000Z',
    expiresIn: 3600,
    refreshExpiresAt: '2099-03-30T00:00:00.000Z',
    refreshExpiresIn: 86400,
    refreshToken: 'refresh.console.ctx.token',
    scope: 'openid profile email',
    tokenType: 'Bearer'
  },
  principal: {
    displayName: 'Operaciones Plataforma',
    primaryEmail: 'ops@example.com',
    state: 'active',
    username: 'operaciones',
    userId: 'usr_ctx_ops_001',
    platformRoles: ['superadmin'],
    tenantIds: ['tenant_alpha', 'tenant_beta'],
    workspaceIds: []
  }
}

export const SESSION_RESTRICTED_USER: ConsoleLoginSession = {
  ...SESSION_OPS_MULTI_TENANT,
  sessionId: 'ses_e2e_ctx_002',
  principal: {
    ...SESSION_OPS_MULTI_TENANT.principal,
    displayName: 'Bob Restricted',
    primaryEmail: 'bob@alpha.example',
    username: 'bob',
    userId: 'usr_ctx_restricted_001',
    platformRoles: ['tenant_developer'],
    tenantIds: ['tenant_alpha'],
    workspaceIds: ['ws_alpha_prod']
  }
}

export const TENANT_ALPHA: E2ETenant = {
  tenantId: 'tenant_alpha',
  displayName: 'Alpha Corp',
  slug: 'alpha-corp',
  state: 'active',
  identityContext: { consoleUserRealm: 'realm-alpha' },
  governance: { governanceStatus: 'nominal' }
}

export const TENANT_BETA: E2ETenant = {
  tenantId: 'tenant_beta',
  displayName: 'Beta Systems',
  slug: 'beta-systems',
  state: 'active',
  identityContext: { consoleUserRealm: 'realm-beta' },
  governance: { governanceStatus: 'nominal' }
}

export const TENANT_GAMMA_SUSPENDED: E2ETenant = {
  tenantId: 'tenant_gamma',
  displayName: 'Gamma Suspended',
  slug: 'gamma-suspended',
  state: 'suspended'
}

export const WORKSPACE_ALPHA_PROD: E2EWorkspace = {
  workspaceId: 'ws_alpha_prod',
  tenantId: 'tenant_alpha',
  state: 'active',
  displayName: 'Production',
  slug: 'prod'
}

export const WORKSPACE_ALPHA_STAGING: E2EWorkspace = {
  workspaceId: 'ws_alpha_staging',
  tenantId: 'tenant_alpha',
  state: 'provisioning',
  displayName: 'Staging',
  slug: 'staging'
}

export const WORKSPACE_BETA_MAIN: E2EWorkspace = {
  workspaceId: 'ws_beta_main',
  tenantId: 'tenant_beta',
  state: 'active',
  displayName: 'Main',
  slug: 'main'
}

export const IAM_USERS_ALPHA: E2EIamUser[] = [
  {
    userId: 'iam_usr_001',
    realmId: 'realm-alpha',
    username: 'alice',
    email: 'alice@alpha.example',
    enabled: true,
    state: 'active',
    realmRoles: ['tenant_owner'],
    requiredActions: []
  },
  {
    userId: 'iam_usr_002',
    realmId: 'realm-alpha',
    username: 'bob',
    email: 'bob@alpha.example',
    enabled: true,
    state: 'active',
    realmRoles: ['tenant_developer'],
    requiredActions: ['UPDATE_PASSWORD']
  }
]

export const IAM_USERS_BETA: E2EIamUser[] = [
  {
    userId: 'iam_usr_101',
    realmId: 'realm-beta',
    username: 'bruno',
    email: 'bruno@beta.example',
    enabled: true,
    state: 'active',
    realmRoles: ['tenant_owner'],
    requiredActions: []
  },
  {
    userId: 'iam_usr_102',
    realmId: 'realm-beta',
    username: 'carol',
    email: 'carol@beta.example',
    enabled: true,
    state: 'active',
    realmRoles: ['tenant_analyst'],
    requiredActions: []
  }
]

export const IAM_ROLES_ALPHA: E2EIamRole[] = [
  { realmId: 'realm-alpha', roleName: 'tenant_owner', composite: false, compositeRoles: [] },
  { realmId: 'realm-alpha', roleName: 'tenant_developer', composite: false, compositeRoles: [] }
]

export const IAM_ROLES_BETA: E2EIamRole[] = [
  { realmId: 'realm-beta', roleName: 'tenant_owner', composite: false, compositeRoles: [] },
  { realmId: 'realm-beta', roleName: 'tenant_analyst', composite: false, compositeRoles: [] }
]

export const IAM_SCOPES_ALPHA: E2EIamScope[] = [
  { scopeName: 'openid', protocol: 'openid-connect', isDefault: true, isOptional: false, includeInTokenScope: true, assignedClientIds: ['console-alpha'] },
  { scopeName: 'profile', protocol: 'openid-connect', isDefault: true, isOptional: false, includeInTokenScope: true, assignedClientIds: ['console-alpha'] },
  { scopeName: 'alpha:read', protocol: 'openid-connect', isDefault: false, isOptional: true, includeInTokenScope: false, assignedClientIds: ['console-alpha'] }
]

export const IAM_CLIENTS_ALPHA: E2EIamClient[] = [
  {
    clientId: 'console-alpha',
    protocol: 'openid-connect',
    accessType: 'confidential',
    enabled: true,
    state: 'active',
    redirectUris: ['https://alpha.example/callback'],
    defaultScopes: ['openid', 'profile'],
    optionalScopes: ['alpha:read']
  }
]

const IAM_SCOPES_BETA: E2EIamScope[] = [
  { scopeName: 'openid', protocol: 'openid-connect', isDefault: true, isOptional: false, includeInTokenScope: true, assignedClientIds: ['console-beta'] },
  { scopeName: 'profile', protocol: 'openid-connect', isDefault: true, isOptional: false, includeInTokenScope: true, assignedClientIds: ['console-beta'] },
  { scopeName: 'beta:admin', protocol: 'openid-connect', isDefault: false, isOptional: true, includeInTokenScope: false, assignedClientIds: ['console-beta'] }
]

const IAM_CLIENTS_BETA: E2EIamClient[] = [
  {
    clientId: 'console-beta',
    protocol: 'openid-connect',
    accessType: 'confidential',
    enabled: true,
    state: 'active',
    redirectUris: ['https://beta.example/callback'],
    defaultScopes: ['openid', 'profile'],
    optionalScopes: ['beta:admin']
  }
]

const APPLICATIONS_BY_WORKSPACE: Record<string, ExternalApplication[]> = {
  [WORKSPACE_ALPHA_PROD.workspaceId]: [
    {
      applicationId: 'app_alpha_console',
      entityType: 'external_application',
      displayName: 'Alpha Console Portal',
      slug: 'alpha-console-portal',
      protocol: 'oidc',
      state: 'active',
      authenticationFlows: ['oidc_authorization_code_pkce'],
      redirectUris: ['https://console.alpha.example/callback'],
      scopes: [{ scopeName: 'alpha:read' }],
      validation: { status: 'valid', checks: [{ code: 'redirect_uris', severity: 'info', message: 'Redirect URIs válidas.' }] },
      federatedProviders: [
        {
          providerId: 'alpha-oidc',
          alias: 'alpha-google',
          displayName: 'Alpha Google',
          protocol: 'oidc',
          providerMode: 'manual_endpoints',
          enabled: true
        }
      ],
      login: { redirectUris: ['https://console.alpha.example/callback'] },
      logout: { frontChannelLogoutUri: 'https://console.alpha.example/logout' }
    }
  ],
  [WORKSPACE_ALPHA_STAGING.workspaceId]: [
    {
      applicationId: 'app_alpha_staging',
      entityType: 'external_application',
      displayName: 'Alpha Staging Portal',
      slug: 'alpha-staging-portal',
      protocol: 'oidc',
      state: 'provisioning',
      authenticationFlows: ['oidc_authorization_code_pkce'],
      redirectUris: ['https://staging.alpha.example/callback'],
      scopes: [{ scopeName: 'alpha:read' }],
      validation: { status: 'pending', checks: [{ code: 'provisioning', severity: 'warning', message: 'Provisioning en curso.' }] },
      login: { redirectUris: ['https://staging.alpha.example/callback'] },
      logout: { frontChannelLogoutUri: 'https://staging.alpha.example/logout' }
    }
  ],
  [WORKSPACE_BETA_MAIN.workspaceId]: [
    {
      applicationId: 'app_beta_dashboard',
      entityType: 'external_application',
      displayName: 'Beta Main Dashboard',
      slug: 'beta-main-dashboard',
      protocol: 'oidc',
      state: 'active',
      authenticationFlows: ['oidc_authorization_code_pkce'],
      redirectUris: ['https://dashboard.beta.example/callback'],
      scopes: [{ scopeName: 'beta:admin' }],
      validation: { status: 'valid', checks: [{ code: 'provider_sync', severity: 'info', message: 'Provider sincronizado.' }] },
      login: { redirectUris: ['https://dashboard.beta.example/callback'] },
      logout: { frontChannelLogoutUri: 'https://dashboard.beta.example/logout' }
    }
  ]
}

export type MockScenario =
  | 'multi_tenant_nominal'
  | 'tenant_switch_isolation'
  | 'members_cycle'
  | 'suspended_tenant'
  | 'workspace_provisioning'
  | 'restricted_user'
  | 'realm_not_configured'
  | 'network_error_members'
  | 'context_during_load'

function getTenantsForScenario(scenario: MockScenario): E2ETenant[] {
  if (scenario === 'suspended_tenant') {
    return [TENANT_ALPHA, TENANT_BETA, TENANT_GAMMA_SUSPENDED]
  }

  if (scenario === 'realm_not_configured') {
    return [{ ...TENANT_ALPHA, identityContext: {} }, TENANT_BETA]
  }

  return [TENANT_ALPHA, TENANT_BETA]
}

function getWorkspacesForTenant(tenantId: string | null, scenario: MockScenario): E2EWorkspace[] {
  if (!tenantId) return []

  if (tenantId === TENANT_ALPHA.tenantId) {
    if (scenario === 'workspace_provisioning') {
      return [WORKSPACE_ALPHA_STAGING, WORKSPACE_ALPHA_PROD]
    }

    return [WORKSPACE_ALPHA_PROD, WORKSPACE_ALPHA_STAGING]
  }

  if (tenantId === TENANT_BETA.tenantId) {
    return [WORKSPACE_BETA_MAIN]
  }

  return []
}

function getUsersForRealm(realmId: string, scenario: MockScenario): E2EIamUser[] {
  if (scenario === 'tenant_switch_isolation' && realmId === 'realm-beta') {
    return []
  }

  if (realmId === 'realm-alpha') return clone(IAM_USERS_ALPHA)
  if (realmId === 'realm-beta') return clone(IAM_USERS_BETA)
  return []
}

function getRolesForRealm(realmId: string, scenario: MockScenario): E2EIamRole[] {
  if (scenario === 'tenant_switch_isolation' && realmId === 'realm-beta') {
    return []
  }

  if (realmId === 'realm-alpha') return clone(IAM_ROLES_ALPHA)
  if (realmId === 'realm-beta') return clone(IAM_ROLES_BETA)
  return []
}

function getScopesForRealm(realmId: string, scenario: MockScenario): E2EIamScope[] {
  if (scenario === 'tenant_switch_isolation' && realmId === 'realm-beta') {
    return []
  }

  if (realmId === 'realm-alpha') return clone(IAM_SCOPES_ALPHA)
  if (realmId === 'realm-beta') return clone(IAM_SCOPES_BETA)
  return []
}

function getClientsForRealm(realmId: string, scenario: MockScenario): E2EIamClient[] {
  if (scenario === 'tenant_switch_isolation' && realmId === 'realm-beta') {
    return []
  }

  if (realmId === 'realm-alpha') return clone(IAM_CLIENTS_ALPHA)
  if (realmId === 'realm-beta') return clone(IAM_CLIENTS_BETA)
  return []
}

function getApplicationsForWorkspace(workspaceId: string | null, scenario: MockScenario): ExternalApplication[] {
  if (!workspaceId) return []

  if (scenario === 'tenant_switch_isolation' && workspaceId === WORKSPACE_BETA_MAIN.workspaceId) {
    return []
  }

  return clone(APPLICATIONS_BY_WORKSPACE[workspaceId] ?? [])
}

function getSessionForScenario(scenario: MockScenario): ConsoleLoginSession {
  if (scenario === 'restricted_user') {
    return clone(SESSION_RESTRICTED_USER)
  }

  if (scenario === 'suspended_tenant') {
    return {
      ...clone(SESSION_OPS_MULTI_TENANT),
      principal: {
        ...clone(SESSION_OPS_MULTI_TENANT).principal,
        tenantIds: ['tenant_alpha', 'tenant_beta', 'tenant_gamma']
      }
    }
  }

  return clone(SESSION_OPS_MULTI_TENANT)
}

function isInvitationMutationBlocked(scenario: MockScenario) {
  return scenario === 'restricted_user'
}

function match(pathname: string, expression: RegExp) {
  return expression.exec(pathname)
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

async function fulfillEmpty(route: Route, status: number): Promise<void> {
  await route.fulfill({ status, body: '' })
}

async function maybeDelay(scenario: MockScenario): Promise<void> {
  if (scenario === 'context_during_load') {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

export async function installContextAuthMocks(page: Page, scenario: MockScenario): Promise<void> {
  const invitationsByTenant: Record<string, MockInvitation[]> = {
    [TENANT_ALPHA.tenantId]: [],
    [TENANT_BETA.tenantId]: []
  }

  const applicationsByWorkspace = clone(APPLICATIONS_BY_WORKSPACE)
  const session = getSessionForScenario(scenario)

  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const method = request.method()

    if (method === 'GET' && pathname === '/v1/auth/signups/policy') {
      await fulfillJson(route, 200, {
        allowSignups: false,
        allowed: false,
        approvalRequired: false,
        effectiveMode: 'disabled',
        globalMode: 'disabled',
        environmentModes: {},
        planModes: {}
      })
      return
    }

    if (method === 'POST' && pathname === '/v1/auth/login-sessions') {
      await fulfillJson(route, 200, session)
      return
    }

    if (method === 'DELETE' && pathname === `/v1/auth/login-sessions/${session.sessionId}`) {
      await fulfillEmpty(route, 204)
      return
    }

    if (method === 'POST' && pathname === `/v1/auth/login-sessions/${session.sessionId}/refresh`) {
      await fulfillJson(route, 200, session)
      return
    }

    if (method === 'GET' && pathname === '/v1/tenants') {
      const items = getTenantsForScenario(scenario).map(tenantPayload)
      await fulfillJson(route, 200, listResponse(items))
      return
    }

    if (method === 'GET' && pathname === '/v1/workspaces') {
      const tenantId = url.searchParams.get('filter[tenantId]')
      const items = getWorkspacesForTenant(tenantId, scenario).map(workspacePayload)
      await fulfillJson(route, 200, listResponse(items))
      return
    }

    const realmUsersMatch = match(pathname, /^\/v1\/iam\/realms\/([^/]+)\/users$/)
    if (method === 'GET' && realmUsersMatch) {
      if (scenario === 'network_error_members') {
        await fulfillJson(route, 503, { message: 'Servicio IAM temporalmente no disponible.' })
        return
      }

      if (scenario === 'context_during_load') {
        await maybeDelay(scenario)
      }

      const realmId = realmUsersMatch[1]
      await fulfillJson(route, 200, iamListResponse(getUsersForRealm(realmId, scenario)))
      return
    }

    const realmRolesMatch = match(pathname, /^\/v1\/iam\/realms\/([^/]+)\/roles$/)
    if (method === 'GET' && realmRolesMatch) {
      const realmId = realmRolesMatch[1]
      await fulfillJson(route, 200, iamListResponse(getRolesForRealm(realmId, scenario)))
      return
    }

    const realmScopesMatch = match(pathname, /^\/v1\/iam\/realms\/([^/]+)\/scopes$/)
    if (method === 'GET' && realmScopesMatch) {
      const realmId = realmScopesMatch[1]
      await fulfillJson(route, 200, iamListResponse(getScopesForRealm(realmId, scenario)))
      return
    }

    const realmClientsMatch = match(pathname, /^\/v1\/iam\/realms\/([^/]+)\/clients$/)
    if (method === 'GET' && realmClientsMatch) {
      const realmId = realmClientsMatch[1]
      await fulfillJson(route, 200, iamListResponse(getClientsForRealm(realmId, scenario)))
      return
    }

    const workspaceApplicationsMatch = match(pathname, /^\/v1\/workspaces\/([^/]+)\/applications$/)
    if (workspaceApplicationsMatch && method === 'GET') {
      const workspaceId = workspaceApplicationsMatch[1]
      const items = scenario === 'tenant_switch_isolation' && workspaceId === WORKSPACE_BETA_MAIN.workspaceId ? [] : applicationsByWorkspace[workspaceId] ?? []
      await fulfillJson(route, 200, { items: clone(items) })
      return
    }

    if (workspaceApplicationsMatch && method === 'POST') {
      const workspaceId = workspaceApplicationsMatch[1]
      const payload = (request.postDataJSON() ?? {}) as Partial<ExternalApplication>
      const nextApplication: ExternalApplication = {
        applicationId: `app_${workspaceId}_${(applicationsByWorkspace[workspaceId]?.length ?? 0) + 1}`,
        entityType: 'external_application',
        displayName: payload.displayName ?? 'Nueva aplicación',
        slug: payload.slug ?? 'nueva-aplicacion',
        protocol: payload.protocol ?? 'oidc',
        state: 'active',
        authenticationFlows: payload.authenticationFlows ?? [],
        redirectUris: payload.redirectUris ?? [],
        scopes: payload.scopes ?? [],
        federatedProviders: payload.federatedProviders ?? [],
        validation: { status: 'valid' }
      }
      applicationsByWorkspace[workspaceId] = [...(applicationsByWorkspace[workspaceId] ?? []), nextApplication]
      await fulfillJson(route, 202, { status: 'accepted' })
      return
    }

    const workspaceApplicationMutationMatch = match(pathname, /^\/v1\/workspaces\/([^/]+)\/applications\/([^/]+)(?:\/federation\/providers(?:\/([^/]+))?)?$/)
    if (workspaceApplicationMutationMatch && (method === 'PUT' || method === 'POST')) {
      await fulfillJson(route, 202, { status: 'accepted' })
      return
    }

    const tenantMembersMatch = match(pathname, /^\/v1\/tenants\/([^/]+)\/members$/)
    if (method === 'GET' && tenantMembersMatch) {
      const tenantId = tenantMembersMatch[1]
      const items = tenantId === TENANT_ALPHA.tenantId ? getUsersForRealm('realm-alpha', scenario) : tenantId === TENANT_BETA.tenantId ? getUsersForRealm('realm-beta', scenario) : []
      await fulfillJson(route, 200, listResponse(items.map((member) => ({
        memberId: member.userId,
        email: member.email,
        displayName: member.username,
        roleName: member.realmRoles[0] ?? 'member',
        state: member.state
      }))))
      return
    }

    const tenantInvitationsMatch = match(pathname, /^\/v1\/tenants\/([^/]+)\/invitations$/)
    if (tenantInvitationsMatch && method === 'GET') {
      const tenantId = tenantInvitationsMatch[1]
      const items = invitationsByTenant[tenantId] ?? []
      await fulfillJson(route, 200, listResponse(items.map(invitationPayload)))
      return
    }

    if (tenantInvitationsMatch && method === 'POST') {
      if (isInvitationMutationBlocked(scenario)) {
        await fulfillJson(route, 403, { message: 'No tienes permisos para invitar miembros.' })
        return
      }

      const tenantId = tenantInvitationsMatch[1]
      const payload = (request.postDataJSON() ?? {}) as { email?: string; roleName?: string }
      const nextInvitation: MockInvitation = {
        invitationId: `inv_${tenantId}_${(invitationsByTenant[tenantId]?.length ?? 0) + 1}`,
        tenantId,
        email: payload.email ?? 'newmember@example.com',
        roleName: payload.roleName ?? 'tenant_developer',
        state: 'pending'
      }
      invitationsByTenant[tenantId] = [...(invitationsByTenant[tenantId] ?? []), nextInvitation]
      await fulfillJson(route, 201, invitationPayload(nextInvitation))
      return
    }

    const tenantInvitationDeleteMatch = match(pathname, /^\/v1\/tenants\/([^/]+)\/invitations\/([^/]+)$/)
    if (tenantInvitationDeleteMatch && method === 'DELETE') {
      if (isInvitationMutationBlocked(scenario)) {
        await fulfillJson(route, 403, { message: 'No tienes permisos para revocar invitaciones.' })
        return
      }

      const tenantId = tenantInvitationDeleteMatch[1]
      const invitationId = tenantInvitationDeleteMatch[2]
      invitationsByTenant[tenantId] = (invitationsByTenant[tenantId] ?? []).filter((invitation) => invitation.invitationId !== invitationId)
      await fulfillEmpty(route, 204)
      return
    }

    await route.abort('failed')
  })
}

import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'

// Synthetic values only: no real realm, client, URL or secret appears in any fixture. The client
// secret below is obviously fake and not key-shaped; the page must never show it.
export const tenantId = 'synthetic-tenant'
export const workspaceId = 'synthetic-workspace'
export const realmId = 'synthetic-auth-realm'
export const syntheticSecret = 'synthetic-client-secret-not-real'
export const requestId = 'req_synthetic_console_auth'
export const realmPath = (section: string) => `/v1/iam/realms/${realmId}/${section}`
// The client sends literal brackets and a browser may or may not percent-encode them, so requests are compared
// by path plus decoded, sorted query pairs instead of by raw string.
export const canonicalPath = (raw: string) => {
  const url = new URL(raw, 'http://synthetic.test')
  const pairs = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`)
  return pairs.length ? `${url.pathname}?${pairs.join('&')}` : url.pathname
}
export const realmGet = (section: string) => `${realmPath(section)}?page[size]=100`
export const applicationsPath = `/v1/workspaces/${workspaceId}/applications`
export const applicationsGet = `${applicationsPath}?limit=100`
export const applicationPath = (id: string) => `${applicationsPath}/${id}`
export const providersPath = (id: string) => `${applicationPath(id)}/federation/providers`
export const iamClientsPath = `/v1/workspaces/${workspaceId}/iam/clients`

export const tenant = { ...buildTenantCollectionFixture().items[0], tenantId, displayName: 'Synthetic Tenant', identityContext: { consoleUserRealm: realmId } }
export const workspace = { ...buildWorkspaceCollectionFixture().items[0], workspaceId, tenantId }

export const users = [{ userId: 'synthetic-user-1' }, { userId: 'synthetic-user-2' }, { userId: 'synthetic-user-3' }]
export const roles = [{ roleName: 'synthetic-admin' }, { roleName: 'synthetic-viewer' }]
export const scopes = [
  { scopeName: 'openid', protocol: 'openid-connect', isDefault: true, isOptional: false, includeInTokenScope: true, assignedClientIds: ['console-web'] },
  { scopeName: 'profile', protocol: 'openid-connect', isDefault: false, isOptional: true, includeInTokenScope: true, assignedClientIds: ['console-web', 'partner-api'] },
]
export const clients = [
  { clientId: 'console-web', protocol: 'openid-connect', accessType: 'public', enabled: true, state: 'active', redirectUris: ['https://console.example.test/callback'], defaultScopes: ['openid'], optionalScopes: ['profile'] },
  { clientId: 'partner-api', protocol: 'openid-connect', accessType: 'confidential', enabled: false, state: 'provisioning', redirectUris: [], defaultScopes: [], optionalScopes: [] },
]
const provider = { providerId: 'corp-oidc', alias: 'Corp OIDC', displayName: 'Corporate OIDC', protocol: 'oidc', providerMode: 'manual_endpoints', enabled: true, authorizationUrl: 'https://id.example.test/auth', tokenUrl: 'https://id.example.test/token', userInfoUrl: 'https://id.example.test/userinfo', requestedScopes: ['openid', 'profile'] }
export const portal = {
  applicationId: 'app_alpha', entityType: 'external_application', displayName: 'Portal Clientes', slug: 'portal-clientes', protocol: 'oidc', state: 'active',
  redirectUris: ['https://portal.example.test/callback'], scopes: [{ scopeName: 'openid' }], authenticationFlows: ['oidc_authorization_code_pkce'], federatedProviders: [provider],
  metadata: { managedBy: 'seed' }, login: { redirectUris: ['https://portal.example.test/callback'], defaultRedirectUri: 'https://portal.example.test/callback' },
  logout: { frontChannelLogoutUri: 'https://portal.example.test/logout', postLogoutRedirectUris: ['https://portal.example.test/logout'] }, validation: { status: 'valid' },
}
export const webhook = { applicationId: 'app_beta', entityType: 'external_application', displayName: 'Webhook Gateway', slug: 'webhook-gateway', protocol: 'api_key', state: 'active', redirectUris: [], scopes: [], authenticationFlows: [], federatedProviders: [] }
export const retired = { ...portal, applicationId: 'app_retired', displayName: 'Legacy Portal', slug: 'legacy-portal', state: 'soft_deleted', federatedProviders: [] }
export const portalWithoutProviders = { ...portal, federatedProviders: [] }
export const collection = (items: unknown[]) => ({ items, page: { size: 100, after: null } })

const failure = (status: number, extra: Record<string, unknown> = {}): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId, ...extra } })
const accepted: EndpointResponse = { status: 202, body: { status: 'accepted' } }
const realmFixtures = (name: string, ok: unknown[]): Record<string, EndpointResponse | EndpointResponse[]> => ({
  success: { body: collection(ok) }, [`iam.realm.${name}.success`]: { body: collection(ok) }, [`iam.realm.${name}.empty`]: { body: collection([]) },
  [`iam.realm.${name}.400`]: failure(400), [`iam.realm.${name}.401`]: failure(401), [`iam.realm.${name}.403`]: failure(403), [`iam.realm.${name}.404`]: failure(404), [`iam.realm.${name}.500`]: failure(500),
  [`iam.realm.${name}.500-then-success`]: [failure(500), { body: collection(ok) }], [`iam.realm.${name}.network`]: { network: true },
  [`iam.realm.${name}.delayed`]: { body: collection(ok), delayMs: 700 },
})
const writes = (okName: string, ok: EndpointResponse, extra: Record<string, EndpointResponse> = {}): Record<string, EndpointResponse> => ({
  success: ok, [okName]: ok, '401': failure(401), '403': failure(403), '404': failure(404), '409': failure(409), '500': failure(500), network: { network: true }, ...extra,
})
export const endpoints: Record<string, PageEndpoint> = {
  authUsers: { method: 'GET', path: realmPath('users'), fixtures: realmFixtures('users', users) },
  authRoles: { method: 'GET', path: realmPath('roles'), fixtures: realmFixtures('roles', roles) },
  authScopes: { method: 'GET', path: realmPath('scopes'), fixtures: realmFixtures('scopes', scopes) },
  authClients: { method: 'GET', path: realmPath('clients'), fixtures: realmFixtures('clients', clients) },
  authApplications: {
    method: 'GET', path: applicationsPath, fixtures: {
      success: { body: collection([portal, webhook, retired]) }, 'workspace.applications.success': { body: collection([portal, webhook, retired]) },
      'workspace.applications.empty': { body: collection([]) }, 'workspace.applications.no-providers': { body: collection([portalWithoutProviders, webhook]) },
      'workspace.applications.400': failure(400), 'workspace.applications.403': failure(403), 'workspace.applications.404': failure(404), 'workspace.applications.500': failure(500),
      'workspace.applications.network': { network: true }, 'workspace.applications.400-then-success': [failure(400), { body: collection([portal, webhook, retired]) }],
      'workspace.applications.delayed': { body: collection([portal, webhook, retired]), delayMs: 700 },
    },
  },
  authApplicationCreate: { method: 'POST', path: applicationsPath, fixtures: writes('workspace.applications.post.accepted', accepted, { 'workspace.applications.post.500': failure(500) }) },
  authApplicationUpdate: { method: 'PUT', path: applicationPath(portal.applicationId), fixtures: writes('workspace.applications.put.accepted', accepted, { 'workspace.applications.put.500': failure(500) }) },
  authProviderCreate: { method: 'POST', path: providersPath(portal.applicationId), fixtures: writes('federation.providers.post.accepted', accepted) },
  authProviderUpdate: { method: 'PUT', path: `${providersPath(portal.applicationId)}/${provider.providerId}`, fixtures: writes('federation.providers.put.accepted', accepted) },
  authIamClient: {
    method: 'POST', path: iamClientsPath, fixtures: writes('iam-clients.post.201', { status: 201, body: { iamClientId: 'new-client', clientSecret: syntheticSecret } }, { 'iam-clients.post.500': failure(500) }),
  },
}
const manifest: ParityManifest = {
  route: '/console/auth', roles: ['superadmin'], endpoints,
  fixtures: [...new Set(Object.values(endpoints).flatMap((endpoint) => Object.keys(endpoint.fixtures))), 'shell.superadmin', 'shell.tenant-owner', 'shell.no-tenant', 'shell.tenant-without-realm', 'shell.no-workspace', 'shell.superadmin-without-manage-iam', 'shell.session-expired'],
  sources: ['src/pages/consoleAuth.tsx', 'src/pages/consoleAuth'],
  data: [{ name: 'IAM client row', locator: 'td:has-text("console-web")' }], actions: [], states: [],
}
export default manifest

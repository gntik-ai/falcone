import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'

const tenant = 'synthetic-tenant'
export const configPath = `/v1/tenants/${tenant}/auth-config`
export const providerPath = (alias: string) => `${configPath}/identity-providers/${alias}`
// Synthetic only. It may appear in the create request body and nowhere else.
export const syntheticSecret = 'synthetic-client-secret-0001'
export const callbackUrl = 'https://synthetic-id.example.test/realms/synthetic-realm/broker/google/endpoint'
const google = { alias: 'google', providerId: 'google', enabled: true, displayName: 'Google', clientId: 'synthetic-google-client', defaultScope: 'openid email', clientSecretSet: true, callbackUrl }
const gitlab = { alias: 'gitlab', providerId: 'gitlab', enabled: false, displayName: 'GitLab', clientId: 'synthetic-gitlab-client', defaultScope: '', clientSecretSet: false, callbackUrl: null }
const github = { alias: 'github', providerId: 'github', enabled: true, displayName: 'GitHub', clientId: 'synthetic-github-client', defaultScope: 'user:email', clientSecretSet: true, callbackUrl: null }
export const providers = { google, gitlab, github }
export const config = {
  tenantId: 'synthetic-tenant', realm: 'synthetic-realm', registrationAllowed: false, loginWithEmailAllowed: true, resetPasswordAllowed: true, rememberMe: false, verifyEmail: false,
  identityProviders: [google, gitlab],
}
export const noProviders = { ...config, identityProviders: [] }
const failure = (status: number, requestId: string, extra: Record<string, unknown> = {}): EndpointResponse => ({ status, body: { status, code: `HTTP_${status}`, message: 'synthetic-error', requestId, ...extra } })
// The raw backend reason must never reach the page.
export const forbiddenReason = 'requires superadmin or the tenant owner/admin of this project'

type Body = Record<string, unknown> | undefined
const reflect = (body: Body) => (body ?? {}) as Record<string, unknown>
const configFixtures: Record<string, EndpointResponse> = {
  'success-two-providers': { body: config },
  'no-providers': { body: noProviders },
  'after-delete': { body: { ...config, identityProviders: [gitlab] } },
  'two-flags-changed': { body: { ...config, registrationAllowed: true, rememberMe: true } },
  '401': { status: 401, body: { status: 401, code: 'HTTP_401', message: 'synthetic-error' } },
  '403': failure(403, 'req_synthetic_auth_config_403', { message: forbiddenReason }),
  '404': failure(404, 'req_synthetic_auth_config_404'),
  '500': failure(500, 'req_synthetic_auth_config_500'),
  network: { network: true },
}
const putFixtures: Record<string, EndpointResponse | ((role: string, body?: unknown) => EndpointResponse)> = {
  success: (_role, body) => ({ body: { ...config, ...reflect(body as Body) } }),
  '403': failure(403, 'req_synthetic_auth_config_put_403'),
  '500': failure(500, 'req_synthetic_auth_config_put_500'),
}
const createFixtures: Record<string, EndpointResponse> = {
  'create-success': { body: { identityProviders: [google, gitlab, github] } },
  '409': failure(409, 'req_synthetic_idp_create_409'),
  '403': failure(403, 'req_synthetic_idp_create_403'),
  '500': failure(500, 'req_synthetic_idp_create_500'),
}
const googleFixtures: Record<string, EndpointResponse | ((role: string, body?: unknown) => EndpointResponse)> = {
  // Edit (a config object is present) or toggle (providerId and enabled only).
  success: (_role, body) => {
    const sent = reflect(body as Body), changed = sent.config as Record<string, unknown> | undefined
    return { body: { identityProviders: [{ ...google, ...(typeof sent.enabled === 'boolean' ? { enabled: sent.enabled } : {}), ...(typeof sent.displayName === 'string' ? { displayName: sent.displayName } : {}), ...(changed?.clientId ? { clientId: changed.clientId } : {}) }, gitlab] } }
  },
  '409': failure(409, 'req_synthetic_idp_409'),
  '403': failure(403, 'req_synthetic_idp_403'),
  '500': failure(500, 'req_synthetic_idp_500'),
}
const deleteFixtures: Record<string, EndpointResponse> = {
  success: { body: { deleted: true } },
  '500': failure(500, 'req_synthetic_idp_delete_500'),
}
export const authConfigEndpoints: Record<string, PageEndpoint> = {
  'auth-config-get': { method: 'GET', path: configPath, fixtures: configFixtures },
  'auth-config-put': { method: 'PUT', path: configPath, fixtures: putFixtures },
  'auth-config-idp-create': { method: 'PUT', path: providerPath('github'), fixtures: createFixtures },
  'auth-config-idp-google': { method: 'PUT', path: providerPath('google'), fixtures: googleFixtures },
  'auth-config-idp-delete': { method: 'DELETE', path: providerPath('google'), fixtures: deleteFixtures },
}
// The default `success` of the read endpoint is the two-provider fixture.
configFixtures.success = configFixtures['success-two-providers']
createFixtures.success = createFixtures['create-success']

const manifest: ParityManifest = {
  route: '/console/auth-config', roles: ['tenant_owner', 'tenant_viewer'], endpoints: authConfigEndpoints,
  fixtures: [
    ...Object.keys(configFixtures).map((key) => `auth-config.get.${key}`),
    ...Object.keys(putFixtures).map((key) => `auth-config.put.${key}`),
    ...Object.keys(createFixtures).map((key) => `auth-config.idp.put.${key}`),
    ...Object.keys(googleFixtures).map((key) => `auth-config.idp.put.google.${key}`),
    ...Object.keys(deleteFixtures).map((key) => `auth-config.idp.delete.${key}`),
    'shell.no-tenant', 'shell.tenant-owner', 'shell.tenant-viewer',
  ],
  sources: ['src/pages/consoleAuthConfig.tsx', 'src/pages/consoleAuthConfig'],
  data: [{ name: 'realm', locator: '[data-testid="console-auth-config-page"] dd:text-is("synthetic-realm")' }],
  actions: [],
  states: [
    { fixture: 'auth-config-get', variant: '403', locator: { es: 'h2:text-is("Sin permiso para esta organización")', en: 'h2:text-is("No access to this organization")' } },
    { fixture: 'auth-config-get', variant: '404', locator: { es: 'h2:text-is("No se encontró la organización")', en: 'h2:text-is("Organization not found")' } },
    { fixture: 'auth-config-get', variant: '500', locator: { es: 'h2:text-is("No se pudo cargar la configuración")', en: 'h2:text-is("Could not load the settings")' } },
    { fixture: 'auth-config-get', variant: 'network', locator: { es: 'h2:text-is("No se pudo cargar la configuración")', en: 'h2:text-is("Could not load the settings")' } },
  ],
}
export default manifest

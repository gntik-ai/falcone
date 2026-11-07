import type { EndpointFixture, EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'

// Synthetic metadata only. The secret values are obviously fake and not key-shaped, so the
// repository secret scan accepts them.
export const workspaceId = 'synthetic-workspace'
export const otherWorkspaceId = 'synthetic-other-workspace'
export const tenantBId = 'synthetic-tenant-b'
export const tenantBWorkspaceId = 'synthetic-workspace-b'
export const syntheticSecret = 'synthetic-secret-not-real'
export const rotatedSecret = 'synthetic-rotated-not-real'
export const requestId = 'req_synthetic_service_accounts'
export const base = (workspace = workspaceId) => `/v1/workspaces/${workspace}/service-accounts`
export const accountPath = (id: string, workspace = workspaceId) => `${base(workspace)}/${id}`
export const issuancePath = (id: string) => `${accountPath(id)}/credential-issuance`
export const rotationPath = (id: string) => `${accountPath(id)}/credential-rotations`
export const revocationPath = (id: string) => `${accountPath(id)}/credential-revocations`

const credential = (state: string) => ({ state, issuedAt: '2026-03-01T00:00:00Z', expiresAt: null, lastUsedAt: null })
const projection = (effectiveAccess: string, clientState: string, credentialState: string) => ({ effectiveAccess, blockedByTenantSuspension: false, clientState, credentialState })
export const active = { serviceAccountId: 'synthetic-sa-active', displayName: 'Billing service', entityType: 'service_account', desiredState: 'active', expiresAt: null, credentialStatus: credential('active'), accessProjection: projection('read_write', 'enabled', 'active') }
export const revoked = { serviceAccountId: 'synthetic-sa-revoked', displayName: 'Legacy importer', entityType: 'service_account', desiredState: 'active', expiresAt: null, credentialStatus: credential('revoked'), accessProjection: projection('denied', 'disabled', 'revoked') }
export const expiring = { serviceAccountId: 'synthetic-sa-expiring', displayName: 'Nightly export', entityType: 'service_account', desiredState: 'active', expiresAt: '2026-07-01T09:30:00Z', credentialStatus: credential('rotated'), accessProjection: projection('read_only', 'enabled', 'rotated') }
export const mixed = [active, revoked, expiring]
export const other = [{ ...active, serviceAccountId: 'synthetic-sa-other', displayName: 'Other workspace service' }]
export const list = (items: unknown[]) => ({ items })
export const issued = { credentialId: 'synthetic-credential-1', secret: syntheticSecret, expiresAt: '2026-09-01T00:00:00Z' }
export const rotated = { credentialId: 'synthetic-credential-2', secret: rotatedSecret, expiresAt: '2026-10-01T00:00:00Z' }

const failure = (status: number, extra: Record<string, unknown> = {}): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId, ...extra } })
// Mutation variants shared by the five write endpoints. Success statuses follow the API:
// create, issuance and rotation answer 201; revocation and delete answer 200.
function writes(ok: EndpointResponse, extra: Record<string, EndpointFixture | EndpointFixture[]> = {}): Record<string, EndpointFixture | EndpointFixture[]> {
  return {
    success: ok, ok,
    delayed: { ...ok, delayMs: 700 },
    '401': failure(401), '403': failure(403), '404': failure(404), '409': failure(409), '429': failure(429), '500': failure(500), '503': failure(503), network: { network: true },
    // 401 refresh-ok: the shared client refreshes once and resends once.
    'refresh-ok': [failure(401), ok],
    'retry-200': [failure(500), ok],
    'network-then-200': [{ network: true }, ok],
    ...extra,
  }
}
export const createdBody = { serviceAccountId: 'synthetic-sa-created', displayName: 'Created service', entityType: 'service_account' }
const listFixtures: Record<string, EndpointFixture | EndpointFixture[]> = {
  success: { body: list(mixed) }, 'service-accounts-list-mixed': { body: list(mixed) },
  'service-accounts-list-other-workspace': { body: list(other) },
  'service-accounts-empty': { body: list([]) },
  'service-accounts-loading-delayed': { body: list(mixed), delayMs: 700 },
  'service-accounts-401': failure(401), 'service-accounts-403': failure(403), 'service-accounts-404': failure(404), 'service-accounts-500': failure(500), 'service-accounts-network': { network: true },
  'service-accounts-422': failure(422), 'service-accounts-429': failure(429),
  // After the first read, the account is gone (deleted elsewhere or by an applied retry).
  'without-active': { body: list([revoked, expiring]) },
  'active-then-without': [{ body: list(mixed) }, { body: list([revoked, expiring]) }],
  'active-then-revoked': [{ body: list(mixed) }, { body: list([{ ...active, credentialStatus: credential('revoked'), accessProjection: projection('denied', 'disabled', 'revoked') }, revoked, expiring]) }],
  'unknown-credential-status': { body: list([{ ...active, credentialStatus: credential('suspended-by-policy') }]) },
}
export const endpoints: Record<string, PageEndpoint> = {
  serviceAccountsList: { method: 'GET', path: base(), fixtures: listFixtures },
  serviceAccountsOtherList: { method: 'GET', path: base(otherWorkspaceId), fixtures: { success: { body: list(other) } } },
  serviceAccountsTenantBList: { method: 'GET', path: base(tenantBWorkspaceId), fixtures: { success: { body: list(other) } } },
  serviceAccountsCreate: { method: 'POST', path: base(), fixtures: writes({ status: 201, body: createdBody }, { 'create-404-workspace': failure(404) }) },
  serviceAccountsIssue: { method: 'POST', path: issuancePath(active.serviceAccountId), fixtures: writes({ status: 201, body: issued }, { '409-revoked': failure(409, { code: 'CREDENTIAL_REVOKED' }) }) },
  serviceAccountsRotate: { method: 'POST', path: rotationPath(active.serviceAccountId), fixtures: writes({ status: 201, body: rotated }) },
  serviceAccountsRevoke: { method: 'POST', path: revocationPath(active.serviceAccountId), fixtures: writes({ status: 200, body: {} }) },
  serviceAccountsDelete: { method: 'DELETE', path: accountPath(active.serviceAccountId), fixtures: writes({ status: 200, body: {} }) },
  serviceAccountsDeleteRevoked: { method: 'DELETE', path: accountPath(revoked.serviceAccountId), fixtures: writes({ status: 200, body: {} }) },
}
const manifest: ParityManifest = {
  route: '/console/service-accounts', roles: ['tenant_owner', 'tenant_viewer'], endpoints,
  fixtures: ['shell-tenant-owner-active-workspace', 'service-accounts-list-mixed', 'service-accounts-list-other-workspace', 'service-account-issuance-201', 'service-account-rotation-201', 'service-account-revocation-200', 'service-account-delete-200', 'service-account-create-201',
    'service-account-mutation-errors', 'service-account-mutation-delayed', 'service-account-mutation-retry-200', 'service-account-mutation-after-network-applied', 'service-account-issuance-409-revoked', 'service-accounts-empty', 'service-accounts-loading-delayed',
    'service-accounts-401', 'service-accounts-403', 'service-accounts-404', 'service-accounts-500', 'service-accounts-network', 'shell-tenant-viewer', 'shell-tenant-suspended', 'shell-no-tenant', 'shell-no-workspace', 'clipboard-api-unavailable'],
  sources: ['src/pages/consoleServiceAccounts.tsx', 'src/pages/consoleServiceAccounts'],
  data: [{ name: 'active account', locator: 'td:text-is("Billing service")' }], actions: [], states: [],
}
export default manifest

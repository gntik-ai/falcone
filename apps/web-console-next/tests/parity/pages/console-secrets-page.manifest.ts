import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { SecretRow } from '../../../src/pages/consoleSecrets/api'

// Synthetic metadata only; these contain no secret values. tenant-a is the approved binding fixture.
export const boundTenantId = 'tenant-a'
export const platformRow: SecretRow = { name: 'app-password', domain: 'platform', tenantId: null, path: 'platform/app-password', currentVersion: { vaultVersion: 2, state: 'active', activatedAt: '2026-03-31T00:00:00Z' }, requiresForce: false }
export const tenantRow: SecretRow = { name: 'db-password', domain: 'tenant', tenantId: boundTenantId, path: `tenant/${boundTenantId}/db-password`, currentVersion: { vaultVersion: 1, state: 'grace', activatedAt: '2026-03-30T12:00:00Z' }, requiresForce: true }
export const inventoryBody = (secrets: SecretRow[]) => ({ secrets, offset: 0, limit: 50 })
export const platformGet = '/v1/secrets/inventory?domain=platform'
export const tenantGet = `/v1/secrets/inventory?domain=tenant&tenantId=${boundTenantId}`
export const revokePath = (row: SecretRow) => `/v1/platform/secrets/${row.domain}/${row.name}/versions/${row.currentVersion!.vaultVersion}/revoke`
const failure = (status: number): EndpointResponse => ({ status, body: { code: status === 404 ? 'VERSION_NOT_FOUND' : `HTTP_${status}`, requestId: 'req_synthetic_secrets', message: 'synthetic-error' } })
export const inventoryFixtures = (row: SecretRow): Record<string, EndpointResponse> => ({
  'platform-secrets-static-inventory': { body: inventoryBody([row]) },
  'platform-secrets-loading-delayed': { body: inventoryBody([row]), delayMs: 700 },
  'platform-secrets-empty': { body: inventoryBody([]) },
  '50-rows': { body: inventoryBody(Array.from({ length: 50 }, (_, index) => ({ ...row, name: `${row.name}-${index}`, path: `${row.path}-${index}` }))) },
  unbound: { body: inventoryBody([{ ...row, path: row.domain === 'platform' ? 'platform/postgresql/app-password' : 'tenant/tenant-b/db-password', tenantId: row.domain === 'tenant' ? 'tenant-b' : null }]) },
  'null-version': { body: inventoryBody([{ ...row, currentVersion: null }]) },
  '403': failure(403), '404': failure(404), '500': failure(500), network: { network: true },
})
export const revokeFixtures: Record<string, EndpointResponse> = {
  success: { body: { revokedVersion: 1, effectiveAt: '2026-06-01T12:00:00Z' } },
  'secret-revoke-200': { body: { revokedVersion: 1, effectiveAt: '2026-06-01T12:00:00Z' } },
  'secret-revoke-delayed': { body: { revokedVersion: 1, effectiveAt: '2026-06-01T12:00:00Z' }, delayMs: 700 },
  'secret-revoke-401': failure(401), 'secret-revoke-403': failure(403), 'secret-revoke-404-not-found': failure(404),
  'secret-revoke-409': failure(409), 'secret-revoke-500': failure(500), 'secret-revoke-503': failure(503), 'secret-revoke-network': { network: true },
}
export const secretsEndpoints: Record<string, PageEndpoint> = {
  revokeTenant: { method: 'POST', path: revokePath(tenantRow), fixtures: revokeFixtures },
  revokePlatform: { method: 'POST', path: revokePath(platformRow), fixtures: revokeFixtures },
}
const manifest: ParityManifest = {
  route: '/console/secrets', roles: ['superadmin', 'tenant_owner'], endpoints: secretsEndpoints,
  fixtures: ['shell-superadmin', ...Object.keys(inventoryFixtures(platformRow)), ...Object.keys(revokeFixtures)],
  sources: ['src/pages/consoleSecrets.tsx', 'src/pages/consoleSecrets'],
  data: [{ name: 'secret', locator: 'td:text-is("app-password")' }], actions: [], states: [],
}
export default manifest

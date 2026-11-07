import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import type { IamRole, IamUser, Invitation } from '../../../src/pages/consoleMembers/api'

export const tenantId = 'synthetic-tenant'
export const workspaceId = 'synthetic-workspace'
export const realmId = 'synthetic-realm'
export const usersPath = `/v1/iam/realms/${realmId}/users`
export const rolesPath = `/v1/iam/realms/${realmId}/roles`
export const invitationsPath = `/v1/tenants/${tenantId}/invitations`
export const firstUsers = `${usersPath}?page%5Bsize%5D=100`
export const nextUsers = `${firstUsers}&page%5Bafter%5D=synthetic-cursor`
export const rolesGet = `${rolesPath}?page%5Bsize%5D=100`
export const tenant = { ...buildTenantCollectionFixture().items[0], tenantId: 'synthetic-tenant', identityContext: { consoleUserRealm: 'synthetic-realm' } }
export const workspace = { ...buildWorkspaceCollectionFixture().items[0], workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant' }
// The legacy context-auth journey's alice/bob and tenant_owner/tenant_developer data,
// with synthetic identifiers and example.test addresses for the offline parity harness.
export const users: IamUser[] = [
  { userId: 'synthetic-alice', username: 'alice', email: 'alice@example.test', enabled: true, state: 'active', realmRoles: ['tenant_owner'], requiredActions: [] },
  { userId: 'synthetic-bob', username: 'bob', email: 'bob@example.test', enabled: true, state: 'active', realmRoles: ['tenant_developer'], requiredActions: ['UPDATE_PASSWORD'] },
  { userId: 'synthetic-bruno', username: 'bruno', enabled: false, state: 'suspended', realmRoles: [], requiredActions: [] },
  { userId: 'synthetic-carol', username: 'carol', enabled: true, realmRoles: [], requiredActions: [] },
]
export const roles: IamRole[] = [
  { roleName: 'tenant_owner', description: 'synthetic-description', composite: true, compositeRoles: ['tenant_developer'] },
  { roleName: 'tenant_developer', composite: false, compositeRoles: [] },
  { roleName: 'default-roles-synthetic-realm', composite: false, compositeRoles: [] },
]
export const manyUsers = Array.from({ length: 150 }, (_, index) => ({ ...users[0], userId: `synthetic-user-${index}`, username: `synthetic-user-${index}` }))
export const collection = (items: unknown[], after: string | null = null) => ({ items, page: { size: 100, after } })
export const pending: Invitation = { id: 'synthetic-invitation', role: 'workspace_developer', workspaceId: 'synthetic-workspace', status: 'pending', expiresAt: '2099-04-01T00:00:00Z' }
export const accepted: Invitation = { ...pending, id: 'synthetic-accepted', status: 'accepted' }
export const proof = { ...pending, token: 'synthetic-once-only-proof-0001' }
const failure = (status: number): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId: 'synthetic-members-request' } })
export const listFixtures: Record<string, EndpointResponse | EndpointResponse[]> = {
  success: { body: collection(users) }, 'members:realm-users-4': { body: collection(users) }, 'members:realm-users-empty': { body: collection([]) },
  'members:realm-users-150-two-pages': [{ body: collection(manyUsers.slice(0, 100), 'synthetic-cursor') }, { body: collection(manyUsers.slice(99)) }],
  'members:realm-users-150-delayed-continuation': [{ body: collection(manyUsers.slice(0, 100), 'synthetic-cursor') }, { body: collection(manyUsers.slice(99)), delayMs: 800 }],
  'members:users-repeated-cursor': [{ body: collection(users, 'synthetic-cursor') }, { body: collection(users, 'synthetic-cursor') }],
  'members:users-page-2-500': [{ body: collection(manyUsers.slice(0, 100), 'synthetic-cursor') }, failure(500)],
  'members:users-page-2-network': [{ body: collection(manyUsers.slice(0, 100), 'synthetic-cursor') }, { network: true }],
  'members:users-401': failure(401), 'members:users-403': failure(403), 'members:realm-404': failure(404), 'members:users-500': failure(500), 'members:users-network': { network: true },
}
const roleFixtures = { success: { body: collection(roles) }, 'members:realm-roles-3': { body: collection(roles) }, 'members:realm-roles-empty': { body: collection([]) }, 'members:roles-403': failure(403), 'members:realm-404': failure(404), 'members:roles-500': failure(500), 'members:roles-network': { network: true } }
const invitationFixtures = { success: { body: { items: [pending, accepted] } }, 'members:invitations-mixed': { body: { items: [pending, accepted] } }, 'members:invitations-empty': { body: { items: [] } }, 'members:invitations-500': failure(500), 'members:invitations-network': { network: true } }
const quotaFixtures = { success: { body: { dimensions: [] } }, 'members:quotas-available': { body: { dimensions: [] } }, 'members:quotas-pending': { body: { dimensions: [] }, delayMs: 1500 }, 'members:quotas-exhausted': { body: { dimensions: [{ dimensionId: 'members.count', hardLimit: 1, measuredValue: 1 }] } }, 'members:quotas-500': failure(500) }
export const endpoints: Record<string, PageEndpoint> = {
  membersUsers: { method: 'GET', path: usersPath, fixtures: listFixtures }, membersRoles: { method: 'GET', path: rolesPath, fixtures: roleFixtures },
  membersCreate: { method: 'POST', path: `/v1/tenants/${tenantId}/users`, fixtures: { success: { body: {} }, 'members:create-user-ok': { body: {} }, 'members:create-user-403': failure(403), 'members:create-user-500': failure(500), 'members:create-user-network': { network: true } } },
  membersInvitations: { method: 'GET', path: invitationsPath, fixtures: invitationFixtures },
  membersInvite: { method: 'POST', path: invitationsPath, fixtures: { success: { body: proof }, 'members:invitation-accepted': { body: proof }, 'members:invitation-500': failure(500), 'members:invitation-network': { network: true } } },
  membersRevoke: { method: 'POST', path: `${invitationsPath}/${pending.id}/revocation`, fixtures: { success: { body: {} }, 'members:invitation-revoke-ok': { body: {} }, 'members:invitation-revoke-500': failure(500) } },
  membersResend: { method: 'POST', path: `${invitationsPath}/${pending.id}/resend`, fixtures: { success: { body: proof }, 'members:invitation-resend-ok': { body: proof }, 'members:invitation-resend-500': failure(500) } },
  membersTenantQuotas: { method: 'GET', path: `/v1/metrics/tenants/${tenantId}/quotas`, fixtures: quotaFixtures },
  membersTenantOverview: { method: 'GET', path: `/v1/metrics/tenants/${tenantId}/overview`, fixtures: { success: { body: { hardLimitDimensions: [] } } } },
  membersWorkspaceQuotas: { method: 'GET', path: `/v1/metrics/workspaces/${workspaceId}/quotas`, fixtures: quotaFixtures },
  membersWorkspaceOverview: { method: 'GET', path: `/v1/metrics/workspaces/${workspaceId}/overview`, fixtures: { success: { body: { hardLimitDimensions: [] } } } },
}
const manifest: ParityManifest = {
  route: '/console/members', roles: ['tenant_owner', 'tenant_viewer'], endpoints,
  fixtures: [...new Set(Object.values(endpoints).flatMap((endpoint) => Object.keys(endpoint.fixtures))) , 'shell:tenant-with-realm', 'shell:tenant-none', 'shell:tenant-without-realm', 'members:role-tenant-owner', 'members:role-tenant-viewer', 'members:invite-permission-denied'],
  sources: ['src/pages/consoleMembers.tsx', 'src/pages/consoleMembers'],
  data: [{ name: 'legacy user', locator: 'td:text-is("alice")' }], actions: [], states: [],
}
export default manifest

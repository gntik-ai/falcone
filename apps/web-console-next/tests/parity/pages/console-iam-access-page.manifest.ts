import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import { buildTenantFixture } from '@in-falcone/console-api/fixtures'
import type { IamGroup, IamRole, IamUser } from '@in-falcone/console-api/iam'

// The realm is the active tenant id, so every IAM path below is scoped to the shell fixture tenant.
export const realmId = 'synthetic-tenant'
export const tenant = { ...buildTenantFixture(), tenantId: realmId }
export const base = `/v1/iam/realms/${realmId}`
export const usersPath = `${base}/users`
export const rolesPath = `${base}/roles`
export const groupsPath = `${base}/groups`
export const firstUsers = `${usersPath}?page%5Bsize%5D=200`
export const nextUsers = `${firstUsers}&page%5Bafter%5D=synthetic-cursor`
export const adaId = 'synthetic-ada'
export const secondPageUser = 'zed-second-page'
export const userPath = (id: string) => `${usersPath}/${id}`

const user = (index: number): IamUser => ({ id: `synthetic-user-${String(index).padStart(3, '0')}`, userId: `synthetic-user-${String(index).padStart(3, '0')}`, username: `user-${String(index).padStart(3, '0')}`, email: index % 2 ? `user-${index}@example.test` : null, enabled: true, state: 'active' })
export const ada: IamUser = { id: adaId, userId: adaId, username: 'ada', email: 'ada@example.test', enabled: true, state: 'active' }
export const suspendedUser: IamUser = { id: 'synthetic-sam', userId: 'synthetic-sam', username: 'sam', email: null, enabled: false, state: 'suspended' }
export const users23: IamUser[] = [ada, ...Array.from({ length: 22 }, (_, index) => user(index + 1))]
export const users250: IamUser[] = [ada, ...Array.from({ length: 248 }, (_, index) => user(index + 1)), { ...user(999), username: secondPageUser, userId: 'synthetic-zed', id: 'synthetic-zed' }]
export const roles4: IamRole[] = [
  { id: 'role-default', name: 'default-roles-synthetic-tenant', roleName: 'default-roles-synthetic-tenant', description: null },
  { id: 'role-editor', name: 'editor', roleName: 'editor', description: null },
  { id: 'role-viewer', name: 'viewer', roleName: 'viewer', description: null },
  { id: 'role-admin', name: 'tenant_admin', roleName: 'tenant_admin', description: null },
]
export const groups3: IamGroup[] = [{ id: 'synthetic-group-a', name: 'group-a', path: '/group-a' }, { id: 'synthetic-group-support', name: 'support', path: '/support' }, { id: 'synthetic-group-ops', name: 'ops', path: '/ops' }]
export const adaRoles: IamRole[] = [roles4[0], roles4[2]]
export const adaGroups: IamGroup[] = [groups3[1]]
export const listOf = (items: unknown[], after: string | null = null) => ({ items, total: items.length, page: { after } })
const failure = (status: number): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId: 'synthetic-iam-request' } })
const membershipFailure: EndpointResponse = { status: 500, body: { code: 'IAM_ASSIGN_ROLE_FAILED', message: 'synthetic-backend-message', requestId: 'synthetic-iam-request' } }

const usersFixtures: Record<string, EndpointResponse | EndpointResponse[]> = {
  success: { body: listOf(users23) }, 'iam:realm-users-23': { body: listOf(users23) }, 'iam:realm-users-empty': { body: listOf([]) },
  'iam:realm-users-250-two-pages': [{ body: { items: users250.slice(0, 200), total: 250, page: { after: 'synthetic-cursor' } } }, { body: { items: users250.slice(200), total: 250, page: { after: null } } }],
  'iam:realm-users-page-2-500': [{ body: { items: users250.slice(0, 200), total: 250, page: { after: 'synthetic-cursor' } } }, failure(500)],
  'iam:realm-users-page-2-502': [{ body: { items: users250.slice(0, 200), total: 250, page: { after: 'synthetic-cursor' } } }, failure(502)],
  'iam:realm-users-page-2-network': [{ body: { items: users250.slice(0, 200), total: 250, page: { after: 'synthetic-cursor' } } }, { network: true }],
  'iam:users-401': failure(401), 'iam:users-403': failure(403), 'iam:users-500': failure(500), 'iam:users-network': { network: true },
}
export const endpoints: Record<string, PageEndpoint> = {
  iamUsers: { method: 'GET', path: usersPath, fixtures: usersFixtures },
  iamRoles: { method: 'GET', path: rolesPath, fixtures: { success: { body: listOf(roles4) }, 'iam:realm-roles-4': { body: listOf(roles4) } } },
  iamGroups: { method: 'GET', path: groupsPath, fixtures: { success: { body: listOf(groups3) }, 'iam:realm-groups-3': { body: listOf(groups3) } } },
  iamUserRoles: { method: 'GET', path: `${userPath(adaId)}/roles`, fixtures: { success: { body: listOf(adaRoles) }, 'iam:user-roles-groups': { body: listOf(adaRoles) }, 'iam:user-404': failure(404), 'iam:detail-500': failure(500) } },
  iamUserGroups: { method: 'GET', path: `${userPath(adaId)}/groups`, fixtures: { success: { body: listOf(adaGroups) }, 'iam:user-roles-groups': { body: listOf(adaGroups) }, 'iam:user-404': failure(404), 'iam:detail-500': failure(500) } },
  iamCreateUser: { method: 'POST', path: usersPath, fixtures: { success: { status: 201, body: { userId: 'synthetic-new' } }, 'iam:create-user-ok': { status: 201, body: { userId: 'synthetic-new' } }, 'iam:create-user-409': failure(409) } },
  iamCreateRole: { method: 'POST', path: rolesPath, fixtures: { success: { status: 201, body: { roleName: 'support' } }, 'iam:create-role-ok': { status: 201, body: { roleName: 'support' } } } },
  iamCreateGroup: { method: 'POST', path: groupsPath, fixtures: { success: { status: 201, body: { id: 'synthetic-group-new', name: 'team' } }, 'iam:create-group-ok': { status: 201, body: { id: 'synthetic-group-new', name: 'team' } } } },
  iamStatus: { method: 'PATCH', path: `${userPath(adaId)}/status`, fixtures: { success: { body: { userId: adaId, enabled: false } }, 'iam:status-ok': { body: { userId: adaId, enabled: false } } } },
  iamDelete: { method: 'DELETE', path: userPath(adaId), fixtures: { success: { body: { userId: adaId, deleted: true } }, 'iam:delete-user-ok': { body: { userId: adaId, deleted: true } }, 'iam:membership-500': membershipFailure } },
  iamAssignRole: { method: 'POST', path: `${userPath(adaId)}/role-assignments`, fixtures: { success: { status: 201, body: { userId: adaId, realm: realmId, assigned: ['editor'] } }, 'iam:assign-role-ok': { status: 201, body: { userId: adaId, realm: realmId, assigned: ['editor'] } }, 'iam:membership-500': membershipFailure } },
  iamRemoveRole: { method: 'DELETE', path: `${userPath(adaId)}/role-assignments`, fixtures: { success: { body: { userId: adaId, realm: realmId, removed: ['viewer'] } }, 'iam:remove-role-ok': { body: { userId: adaId, realm: realmId, removed: ['viewer'] } }, 'iam:membership-500': membershipFailure } },
  iamAddGroup: { method: 'PUT', path: `${userPath(adaId)}/groups/synthetic-group-a`, fixtures: { success: { status: 201, body: { userId: adaId, groupId: 'synthetic-group-a', realm: realmId, member: true } }, 'iam:add-group-ok': { status: 201, body: { userId: adaId, groupId: 'synthetic-group-a', realm: realmId, member: true } }, 'iam:membership-500': membershipFailure } },
  iamRemoveGroup: { method: 'DELETE', path: `${userPath(adaId)}/groups/synthetic-group-support`, fixtures: { success: { body: { userId: adaId, groupId: 'synthetic-group-support', realm: realmId, member: false } }, 'iam:remove-group-ok': { body: { userId: adaId, groupId: 'synthetic-group-support', realm: realmId, member: false } }, 'iam:membership-500': membershipFailure } },
}
const manifest: ParityManifest = {
  route: '/console/iam-access', roles: ['superadmin'], endpoints,
  fixtures: [...new Set(Object.values(endpoints).flatMap((endpoint) => Object.keys(endpoint.fixtures))), 'shell:tenant-none', 'shell:role-superadmin', 'shell:role-tenant-operator'],
  sources: ['src/pages/consoleIamAccess.tsx', 'src/pages/consoleIamAccess'],
  data: [{ name: 'first user row', locator: 'td:text-is("ada")' }], actions: [], states: [],
}
export default manifest

import { requestConsoleSessionJson } from './session'
import type { JsonValue } from './http'

// Superadmin IAM access page contracts (legacy ConsoleIamAccessPage). Membership clients stay in ./clients.
export interface IamUser {
  id?: string
  userId?: string
  username: string
  email: string | null
  enabled: boolean
  state?: 'active' | 'suspended' | 'disabled' | string | null
}
export interface IamRole {
  id?: string
  name?: string
  roleName?: string
  description?: string | null
}
export interface IamGroup {
  id: string
  name: string
  path?: string | null
}
export interface IamUsersPage {
  items: IamUser[]
  total?: number
  page?: { after?: string | null }
}
export interface IamUsers {
  items: IamUser[]
  total: number
}
export interface IamRolesResponse {
  items: IamRole[]
  total?: number
}
export interface IamGroupsResponse {
  items: IamGroup[]
  total?: number
}
export interface IamCreateUserResponse {
  id?: string
  userId?: string
}
export interface IamCreateUserInput {
  username: string
  email?: string
  temporaryPassword?: string
  role?: string
}

export const IAM_USERS_PAGE_SIZE = 200

const realmBase = (realmId: string) => `/v1/iam/realms/${encodeURIComponent(realmId)}`
const userBase = (realmId: string, userId: string) => `${realmBase(realmId)}/users/${encodeURIComponent(userId)}`

export function listIamRealmUsersPage(realmId: string, after?: string | null, signal?: AbortSignal): Promise<IamUsersPage> {
  const query = new URLSearchParams({ 'page[size]': String(IAM_USERS_PAGE_SIZE) })
  if (after) query.set('page[after]', after)
  return requestConsoleSessionJson<IamUsersPage>(`${realmBase(realmId)}/users?${query.toString()}`, { signal })
}

// Follows page.after until it is null. Any failed response rejects the whole load, so a partial collection never
// reaches the caller, and a cursor that repeats cannot loop forever.
export async function listAllIamRealmUsers(realmId: string, signal?: AbortSignal): Promise<IamUsers> {
  const items: IamUser[] = []
  const cursors = new Set<string>()
  let total: number | undefined
  let after: string | null = null
  do {
    const page: IamUsersPage = await listIamRealmUsersPage(realmId, after, signal)
    items.push(...(page.items ?? []))
    total = page.total ?? total
    after = page.page?.after ?? null
    if (after && cursors.has(after)) throw Object.assign(new Error('Repeated users cursor'), { code: 'IAM_USERS_CURSOR_REPEATED' })
    if (after) cursors.add(after)
  } while (after)
  return { items, total: Math.max(total ?? 0, items.length) }
}

export function listIamRealmRoles(realmId: string, signal?: AbortSignal): Promise<IamRolesResponse> {
  return requestConsoleSessionJson<IamRolesResponse>(`${realmBase(realmId)}/roles`, { signal })
}

export function listIamRealmGroups(realmId: string, signal?: AbortSignal): Promise<IamGroupsResponse> {
  return requestConsoleSessionJson<IamGroupsResponse>(`${realmBase(realmId)}/groups`, { signal })
}

export function listIamUserRoles(realmId: string, userId: string, signal?: AbortSignal): Promise<IamRolesResponse> {
  return requestConsoleSessionJson<IamRolesResponse>(`${userBase(realmId, userId)}/roles`, { signal })
}

export function listIamUserGroups(realmId: string, userId: string, signal?: AbortSignal): Promise<IamGroupsResponse> {
  return requestConsoleSessionJson<IamGroupsResponse>(`${userBase(realmId, userId)}/groups`, { signal })
}

export function createIamUser(realmId: string, input: IamCreateUserInput, signal?: AbortSignal): Promise<IamCreateUserResponse> {
  const body: { [key: string]: JsonValue } = { enabled: true, emailVerified: true, username: input.username }
  if (input.email) body.email = input.email
  if (input.temporaryPassword) body.bootstrapCredentials = { temporaryPassword: input.temporaryPassword }
  if (input.role) body.realmRoles = [input.role]
  return requestConsoleSessionJson<IamCreateUserResponse>(`${realmBase(realmId)}/users`, { method: 'POST', body, signal })
}

export function createIamRole(realmId: string, roleName: string, signal?: AbortSignal): Promise<unknown> {
  return requestConsoleSessionJson(`${realmBase(realmId)}/roles`, { method: 'POST', body: { roleName }, signal })
}

export function createIamGroup(realmId: string, name: string, signal?: AbortSignal): Promise<unknown> {
  return requestConsoleSessionJson(`${realmBase(realmId)}/groups`, { method: 'POST', body: { name }, signal })
}

export function setIamUserStatus(realmId: string, userId: string, enabled: boolean, signal?: AbortSignal): Promise<unknown> {
  return requestConsoleSessionJson(`${userBase(realmId, userId)}/status`, { method: 'PATCH', body: { enabled }, signal })
}

export function deleteIamUser(realmId: string, userId: string, signal?: AbortSignal): Promise<unknown> {
  return requestConsoleSessionJson(userBase(realmId, userId), { method: 'DELETE', signal })
}

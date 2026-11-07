import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { createRequestId, type ApiError } from '@in-falcone/console-api/http'

export interface IamUser { userId: string; username: string; email?: string; enabled: boolean; state?: string; realmRoles?: string[]; requiredActions?: string[] }
export interface IamRole { roleName: string; description?: string; composite: boolean; compositeRoles: string[] }
export interface Invitation { id: string; role: string; workspaceId: string | null; status: 'pending' | 'accepted' | 'revoked' | 'expired'; expiresAt: string }
export interface Proof { id?: string; entityId?: string; invitationId?: string; token: string; expiresAt: string }
export interface InviteData { workspaceId: string; email: string; role: string }
export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId }
}
export async function listUsers(realmId: string, signal: AbortSignal): Promise<IamUser[]> {
  const users = new Map<string, IamUser>(), cursors = new Set<string>()
  let after: string | null = null
  do {
    const query = new URLSearchParams({ 'page[size]': '100' })
    if (after) query.set('page[after]', after)
    const response: { items: IamUser[]; page?: { after?: string | null } } = await requestConsoleSessionJson(`/v1/iam/realms/${realmId}/users?${query}`, { method: 'GET', signal })
    for (const user of response.items) users.set(user.userId, user)
    after = response.page?.after ?? null
    if (after && cursors.has(after)) throw new Error('Repeated users cursor')
    if (after) cursors.add(after)
  } while (after)
  return [...users.values()]
}
export async function listRoles(realmId: string, signal: AbortSignal) {
  const query = new URLSearchParams({ 'page[size]': '100' })
  return (await requestConsoleSessionJson<{ items: IamRole[] }>(`/v1/iam/realms/${realmId}/roles?${query}`, { method: 'GET', signal })).items
}
export function createUser(tenantId: string, data: { username: string; password: string; email: string; role: string }) {
  return requestConsoleSessionJson(`/v1/tenants/${encodeURIComponent(tenantId)}/users`, { method: 'POST', body: {
    username: data.username.trim(), password: data.password.trim(), ...(data.email.trim() ? { email: data.email.trim() } : {}), ...(data.role ? { roles: [data.role] } : {}),
  } })
}
export function invite(tenantId: string, data: InviteData) {
  return requestConsoleSessionJson<Proof>(`/v1/tenants/${tenantId}/invitations`, { method: 'POST', body: { email: data.email, role: data.role, workspaceId: data.workspaceId }, idempotent: true, headers: { 'X-Request-Id': createRequestId('wiz') } })
}
const invitationsPath = (tenantId: string) => `/v1/tenants/${encodeURIComponent(tenantId)}/invitations`
export async function listInvitations(tenantId: string, signal: AbortSignal) {
  return (await requestConsoleSessionJson<{ items: Invitation[] }>(invitationsPath(tenantId), { method: 'GET', signal })).items
}
export function revokeInvitation(tenantId: string, id: string) {
  return requestConsoleSessionJson(`${invitationsPath(tenantId)}/${encodeURIComponent(id)}/revocation`, { method: 'POST', body: {} })
}
export function resendInvitation(tenantId: string, id: string, email: string) {
  return requestConsoleSessionJson<Proof>(`${invitationsPath(tenantId)}/${encodeURIComponent(id)}/resend`, { method: 'POST', body: { email } })
}
interface Quotas { dimensions?: { dimensionId: string; hardLimit?: number | null; measuredValue?: number }[]; hardLimitBreaches?: string[] }
interface Overview { hardLimitDimensions?: string[] }
export async function membersQuota(tenantId: string, workspaceId: string, signal: AbortSignal): Promise<boolean> {
  // Preserve legacy ordering and fail-open behaviour when metrics are unavailable.
  await Promise.all([
    requestConsoleSessionJson(`/v1/metrics/tenants/${tenantId}/quotas`, { method: 'GET', signal }),
    requestConsoleSessionJson(`/v1/metrics/tenants/${tenantId}/overview`, { method: 'GET', signal }),
  ])
  if (!workspaceId) return true
  const [quotas, overview] = await Promise.all([
    requestConsoleSessionJson<Quotas>(`/v1/metrics/workspaces/${workspaceId}/quotas`, { method: 'GET', signal }),
    requestConsoleSessionJson<Overview>(`/v1/metrics/workspaces/${workspaceId}/overview`, { method: 'GET', signal }),
  ])
  if (tenantId === 'platform') return true
  const dimension = quotas.dimensions?.find((item) => item.dimensionId === 'members.count')
  return !dimension || !((dimension.hardLimit && dimension.hardLimit > 0 && Math.round((dimension.measuredValue ?? 0) / dimension.hardLimit * 100) >= 100) || [...(quotas.hardLimitBreaches ?? []), ...(overview.hardLimitDimensions ?? [])].includes('members.count'))
}
export const invitationLink = (tenantId: string, proof: Proof) => `${window.location.origin}/invitations/${encodeURIComponent(tenantId)}/${encodeURIComponent(proof.id ?? proof.entityId ?? '')}#token=${encodeURIComponent(proof.token)}`

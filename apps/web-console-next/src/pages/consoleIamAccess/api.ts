import type { ApiError } from '@in-falcone/console-api/http'
import type { IamGroup, IamRole, IamUser } from '@in-falcone/console-api/iam'

export type { IamGroup, IamRole, IamUser }
export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId' | 'code'>

export const USERS_PAGE_SIZE = 10
export const IAM_ERROR_CODES = [
  'IAM_ASSIGN_ROLE_FAILED', 'IAM_REMOVE_ROLE_FAILED', 'IAM_GROUP_ADD_FAILED', 'IAM_GROUP_REMOVE_FAILED', 'IAM_CREATE_USER_FAILED',
  'SET_USER_STATUS_FAILED', 'DELETE_USER_FAILED', 'IAM_CREATE_ROLE_FAILED', 'IAM_CREATE_GROUP_FAILED', 'IAM_LIST_USERS_FAILED',
  'IAM_LIST_ROLES_FAILED', 'IAM_LIST_GROUPS_FAILED', 'IAM_LIST_CLIENTS_FAILED', 'IAM_GET_USER_FAILED', 'IAM_GET_ROLE_FAILED',
  'IAM_LIST_USER_ROLES_FAILED', 'IAM_LIST_USER_GROUPS_FAILED', 'IAM_LIST_GROUP_MEMBERS_FAILED', 'UNSUPPORTED_FIELD',
] as const

export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' ? error.code.trim() : undefined,
    requestId: error.requestId ?? error.correlationId,
  }
}

// Legacy errMsg: a mapped IAM code first, then the status wording, then the caller's fallback. The raw backend message never shows.
export function errorKey(failure: Failure, fallback: string): string {
  if (failure.code && (IAM_ERROR_CODES as readonly string[]).includes(failure.code)) return `errors.codes.${failure.code}`
  const status = failure.status
  if (status && [401, 403, 404, 409, 429].includes(status)) return `errors.status.${status}`
  if (status && status >= 500) return 'errors.status.5xx'
  return `errors.fallback.${fallback}`
}

export const userIdOf = (user: IamUser) => user.userId ?? user.id ?? user.username
export const roleNameOf = (role: IamRole) => role.roleName ?? role.name ?? ''
export const isDefaultRole = (name: string) => name.startsWith('default-roles')
export const isSuspended = (user: IamUser) => user.enabled === false || user.state === 'suspended' || user.state === 'disabled'
export const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

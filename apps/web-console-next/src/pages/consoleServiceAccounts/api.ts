import type { ApiError } from '@in-falcone/console-api/http'
import { readConsoleShellSession, requestConsoleSessionJson } from '@in-falcone/console-api/session'

// The six legacy calls (apps/web-console/src/lib/console-service-accounts.ts) keep their method,
// path and payload shape field for field; every request goes through the shared session client.
export interface CredentialReference { credentialId: string; issuedAt: string | null; expiresAt: string | null; status: 'active' | 'rotated' | 'revoked' | null }
export interface IssuedCredential { credentialId: string; secret: string; expiresAt: string | null }
export interface ServiceAccount {
  serviceAccountId: string
  displayName: string | null
  entityType: 'service_account'
  desiredState: 'active' | 'suspended' | null
  expiresAt: string | null
  credentialStatus: { state: string | null; issuedAt: string | null; expiresAt: string | null; lastUsedAt: string | null } | null
  accessProjection: { effectiveAccess: string; blockedByTenantSuspension: boolean; clientState: string; credentialState: string } | null
  credentials: CredentialReference[]
}
export type Action = 'create' | 'issue' | 'rotate' | 'revoke' | 'delete'
export interface Failure { status?: number; code?: string; requestId?: string }

type Raw = Record<string, any>
export function normalizeServiceAccount(input: Raw): ServiceAccount {
  const status = input.status ?? input.desiredState ?? input.state ?? null
  const createdAt = input.created_at ?? input.createdAt ?? null
  const clientId = input.kc_client_id ?? input.clientId ?? input.iamBinding?.clientId ?? ''
  return {
    serviceAccountId: input.serviceAccountId ?? input.id ?? '',
    displayName: input.displayName ?? input.display_name ?? null,
    entityType: 'service_account',
    desiredState: input.desiredState ?? (status === 'active' ? 'active' : status ? 'suspended' : null),
    expiresAt: input.expiresAt ?? input.expires_at ?? null,
    credentialStatus: input.credentialStatus
      ? { state: input.credentialStatus.state ?? null, issuedAt: input.credentialStatus.issuedAt ?? null, expiresAt: input.credentialStatus.expiresAt ?? null, lastUsedAt: input.credentialStatus.lastUsedAt ?? null }
      : status ? { state: status === 'revoked' ? 'revoked' : 'active', issuedAt: createdAt, expiresAt: null, lastUsedAt: null } : null,
    accessProjection: input.accessProjection
      ? {
        effectiveAccess: input.accessProjection.effectiveAccess ?? 'unknown', blockedByTenantSuspension: Boolean(input.accessProjection.blockedByTenantSuspension),
        clientState: input.accessProjection.clientState ?? 'unknown', credentialState: input.accessProjection.credentialState ?? 'unknown',
      }
      : status ? { effectiveAccess: status === 'active' ? 'granted' : 'blocked', blockedByTenantSuspension: false, clientState: status === 'active' ? 'enabled' : 'disabled', credentialState: status === 'revoked' ? 'revoked' : 'active' } : null,
    credentials: Array.isArray(input.credentials)
      ? input.credentials.map((credential: Raw) => ({ credentialId: credential.credentialId ?? '', issuedAt: credential.issuedAt ?? null, expiresAt: credential.expiresAt ?? null, status: credential.status ?? null }))
      : clientId ? [{ credentialId: clientId, issuedAt: createdAt, expiresAt: null, status }] : [],
  }
}

export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    requestId: error.requestId ?? error.correlationId,
  }
}
export const isNetwork = (failure: Failure) => failure.status === undefined
export const isRevoked = (account: ServiceAccount) => account.credentialStatus?.state === 'revoked' || account.accessProjection?.credentialState === 'revoked'
export const accountName = (account: ServiceAccount) => account.displayName ?? account.serviceAccountId
export const accessToken = () => readConsoleShellSession()?.tokenSet?.accessToken ?? null
export const principalUserId = () => readConsoleShellSession()?.principal?.userId ?? 'unknown-user'

const base = (workspaceId: string) => `/v1/workspaces/${workspaceId}/service-accounts`
export async function listServiceAccounts(workspaceId: string, signal?: AbortSignal): Promise<ServiceAccount[]> {
  const response = await requestConsoleSessionJson<{ items?: Raw[] }>(base(workspaceId), { signal })
  return Array.isArray(response?.items) ? response.items.map(normalizeServiceAccount) : []
}
export async function createServiceAccount(workspaceId: string, displayName: string): Promise<{ serviceAccountId: string }> {
  const response = await requestConsoleSessionJson<{ serviceAccountId?: string }>(base(workspaceId), {
    method: 'POST', body: { displayName, entityType: 'service_account', desiredState: 'active' }, idempotent: true,
  })
  return { serviceAccountId: response?.serviceAccountId ?? `sa_${Date.now()}` }
}
const credentialOf = (response: Raw | null): IssuedCredential => ({
  credentialId: response?.credentialId ?? `cred_${Date.now()}`, secret: response?.secret ?? 'secret-unavailable', expiresAt: response?.expiresAt ?? null,
})
export async function issueCredential(workspaceId: string, serviceAccountId: string): Promise<IssuedCredential> {
  return credentialOf(await requestConsoleSessionJson<Raw>(`${base(workspaceId)}/${serviceAccountId}/credential-issuance`, {
    method: 'POST', body: { requestedByUserId: principalUserId() }, idempotent: true,
  }))
}
export async function rotateCredential(workspaceId: string, serviceAccountId: string): Promise<IssuedCredential> {
  return credentialOf(await requestConsoleSessionJson<Raw>(`${base(workspaceId)}/${serviceAccountId}/credential-rotations`, {
    method: 'POST', body: { reason: 'Console rotate' }, idempotent: true,
  }))
}
export async function revokeCredential(workspaceId: string, serviceAccountId: string): Promise<void> {
  await requestConsoleSessionJson(`${base(workspaceId)}/${serviceAccountId}/credential-revocations`, { method: 'POST', body: { reason: 'Console revoke' }, idempotent: true })
}
export async function deleteServiceAccount(workspaceId: string, serviceAccountId: string): Promise<void> {
  await requestConsoleSessionJson(`${base(workspaceId)}/${serviceAccountId}`, { method: 'DELETE', idempotent: true })
}

// After a network failure the write may or may not have reached the server.
export function alreadyApplied(action: 'revoke' | 'delete', rows: ServiceAccount[], serviceAccountId: string): boolean {
  const row = rows.find((account) => account.serviceAccountId === serviceAccountId)
  return !row || (action === 'revoke' && isRevoked(row))
}

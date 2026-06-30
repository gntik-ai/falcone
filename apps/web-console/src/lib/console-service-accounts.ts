import { useCallback, useEffect, useState } from 'react'

import { requestConsoleSessionJson } from '@/lib/console-session'

const STORAGE_PREFIX = 'in-falcone.console-service-account-index:'

export interface ConsoleCredentialReference {
  credentialId: string
  issuedAt: string | null
  expiresAt: string | null
  status: 'active' | 'rotated' | 'revoked' | null
}

export interface ConsoleIssuedCredential {
  credentialId: string
  secret: string
  expiresAt: string | null
}

export interface ConsoleServiceAccount {
  serviceAccountId: string
  displayName: string | null
  entityType: 'service_account'
  desiredState: 'active' | 'suspended' | null
  expiresAt: string | null
  iamBinding: { realm: string; clientId: string; credentialRef: string } | null
  credentialStatus: {
    state: 'active' | 'rotated' | 'revoked' | null
    issuedAt: string | null
    expiresAt: string | null
    lastUsedAt: string | null
  } | null
  accessProjection: {
    effectiveAccess: string
    blockedByTenantSuspension: boolean
    clientState: string
    credentialState: string
  } | null
  credentials: ConsoleCredentialReference[]
}

export interface ConsoleServiceAccountWriteRequest {
  displayName: string
  entityType: 'service_account'
  desiredState?: 'active'
  expiresAt?: string
}

export interface ConsoleCredentialIssuanceRequest {
  requestedByUserId: string
  requestedTtl?: string
  revokeOutstandingCredentials?: boolean
  reason?: string
}

export interface ConsoleCredentialRevocationRequest {
  reason?: string
}

export interface ConsoleCredentialRotationRequest {
  reason?: string
}

interface MutationAccepted {
  serviceAccountId?: string
  credentialId?: string
  secret?: string
  expiresAt?: string | null
}

interface ConsoleServiceAccountListResponse {
  items?: Record<string, any>[]
}

function getStorageKey(workspaceId: string) {
  return `${STORAGE_PREFIX}${workspaceId}`
}

export function readKnownServiceAccountIds(workspaceId: string | null): string[] {
  if (!workspaceId || typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(getStorageKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0) : []
  } catch {
    return []
  }
}

export function persistKnownServiceAccountId(workspaceId: string, serviceAccountId: string) {
  const existing = new Set(readKnownServiceAccountIds(workspaceId))
  existing.add(serviceAccountId)
  window.sessionStorage.setItem(getStorageKey(workspaceId), JSON.stringify([...existing]))
}

// Preserve the local index for compatibility with create/delete flows that still record recently
// touched ids; the list view itself is loaded from the backend collection endpoint.
export function forgetKnownServiceAccountId(workspaceId: string, serviceAccountId: string) {
  if (typeof window === 'undefined') return
  const existing = new Set(readKnownServiceAccountIds(workspaceId))
  if (!existing.delete(serviceAccountId)) return
  window.sessionStorage.setItem(getStorageKey(workspaceId), JSON.stringify([...existing]))
}

export function normalizeServiceAccount(input: Record<string, any>): ConsoleServiceAccount {
  const status = input.status ?? input.desiredState ?? input.state ?? null
  const createdAt = input.created_at ?? input.createdAt ?? null
  const clientId = input.kc_client_id ?? input.clientId ?? input.iamBinding?.clientId ?? ''
  const iamRealm = input.iam_realm ?? input.iamRealm ?? input.iamBinding?.realm ?? ''

  return {
    serviceAccountId: input.serviceAccountId ?? input.id ?? '',
    displayName: input.displayName ?? input.display_name ?? null,
    entityType: 'service_account',
    desiredState: input.desiredState ?? (status === 'active' ? 'active' : status ? 'suspended' : null),
    expiresAt: input.expiresAt ?? input.expires_at ?? null,
    iamBinding: input.iamBinding
      ? {
          realm: input.iamBinding.realm ?? '',
          clientId: input.iamBinding.clientId ?? '',
          credentialRef: input.iamBinding.credentialRef ?? ''
        }
      : clientId
        ? {
            realm: iamRealm,
            clientId,
            credentialRef: clientId
          }
      : null,
    credentialStatus: input.credentialStatus
      ? {
          state: input.credentialStatus.state ?? null,
          issuedAt: input.credentialStatus.issuedAt ?? null,
          expiresAt: input.credentialStatus.expiresAt ?? null,
          lastUsedAt: input.credentialStatus.lastUsedAt ?? null
        }
      : status
        ? {
            state: status === 'revoked' ? 'revoked' : 'active',
            issuedAt: createdAt,
            expiresAt: null,
            lastUsedAt: null
          }
      : null,
    accessProjection: input.accessProjection
      ? {
          effectiveAccess: input.accessProjection.effectiveAccess ?? 'unknown',
          blockedByTenantSuspension: Boolean(input.accessProjection.blockedByTenantSuspension),
          clientState: input.accessProjection.clientState ?? 'unknown',
          credentialState: input.accessProjection.credentialState ?? 'unknown'
        }
      : status
        ? {
            effectiveAccess: status === 'active' ? 'granted' : 'blocked',
            blockedByTenantSuspension: false,
            clientState: status === 'active' ? 'enabled' : 'disabled',
            credentialState: status === 'revoked' ? 'revoked' : 'active'
          }
      : null,
    credentials: Array.isArray(input.credentials)
      ? input.credentials.map((credential: Record<string, any>) => ({
          credentialId: credential.credentialId ?? '',
          issuedAt: credential.issuedAt ?? null,
          expiresAt: credential.expiresAt ?? null,
          status: credential.status ?? null
        }))
      : clientId
        ? [{ credentialId: clientId, issuedAt: createdAt, expiresAt: null, status }]
      : []
  }
}

function toErrorMessage(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
  if (status === 403) return 'Acceso denegado para gestionar service accounts.'
  if (error instanceof Error && error.message) return error.message
  return 'No se pudo completar la operación.'
}

export function useConsoleServiceAccounts(workspaceId: string | null) {
  const [accounts, setAccounts] = useState<ConsoleServiceAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!workspaceId) {
        setAccounts([])
        setError(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      setAccounts([])

      try {
        const response = await requestConsoleSessionJson<ConsoleServiceAccountListResponse>(`/v1/workspaces/${workspaceId}/service-accounts`)
        const loaded = Array.isArray(response.items) ? response.items.map((item) => normalizeServiceAccount(item)) : []
        if (!cancelled) setAccounts(loaded)
      } catch (error) {
        if (!cancelled) {
          setError(toErrorMessage(error))
          setAccounts([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadToken])

  return { accounts, loading, error, reload, knownIds: readKnownServiceAccountIds(workspaceId) }
}

export async function createServiceAccount(workspaceId: string, payload: ConsoleServiceAccountWriteRequest): Promise<{ serviceAccountId: string }> {
  const response = await requestConsoleSessionJson<MutationAccepted>(`/v1/workspaces/${workspaceId}/service-accounts`, {
    method: 'POST',
    body: payload as any,
    idempotent: true
  })
  const serviceAccountId = response.serviceAccountId ?? `sa_${Date.now()}`
  persistKnownServiceAccountId(workspaceId, serviceAccountId)
  return { serviceAccountId }
}

export async function issueServiceAccountCredential(
  workspaceId: string,
  serviceAccountId: string,
  payload: ConsoleCredentialIssuanceRequest
): Promise<ConsoleIssuedCredential> {
  const response = await requestConsoleSessionJson<MutationAccepted>(
    `/v1/workspaces/${workspaceId}/service-accounts/${serviceAccountId}/credential-issuance`,
    { method: 'POST', body: payload as any, idempotent: true }
  )
  return {
    credentialId: response.credentialId ?? `cred_${Date.now()}`,
    secret: response.secret ?? 'secret-unavailable',
    expiresAt: response.expiresAt ?? null
  }
}

export async function revokeServiceAccountCredential(
  workspaceId: string,
  serviceAccountId: string,
  payload: ConsoleCredentialRevocationRequest
): Promise<void> {
  await requestConsoleSessionJson(`/v1/workspaces/${workspaceId}/service-accounts/${serviceAccountId}/credential-revocations`, {
    method: 'POST',
    body: payload as any,
    idempotent: true
  })
}

export async function rotateServiceAccountCredential(
  workspaceId: string,
  serviceAccountId: string,
  payload: ConsoleCredentialRotationRequest
): Promise<ConsoleIssuedCredential> {
  const response = await requestConsoleSessionJson<MutationAccepted>(
    `/v1/workspaces/${workspaceId}/service-accounts/${serviceAccountId}/credential-rotations`,
    { method: 'POST', body: payload as any, idempotent: true }
  )
  return {
    credentialId: response.credentialId ?? `cred_${Date.now()}`,
    secret: response.secret ?? 'secret-unavailable',
    expiresAt: response.expiresAt ?? null
  }
}

// Fully delete a service account — its Keycloak client AND its persistence row (#687). Revoke only
// disables the credential; this removes the account entirely. Idempotent on the server (a 2nd
// delete → 404). Drops it from the local index so it disappears from list results immediately.
export async function deleteServiceAccount(workspaceId: string, serviceAccountId: string): Promise<void> {
  await requestConsoleSessionJson(`/v1/workspaces/${workspaceId}/service-accounts/${serviceAccountId}`, {
    method: 'DELETE',
    idempotent: true
  })
  forgetKnownServiceAccountId(workspaceId, serviceAccountId)
}

export { toErrorMessage as consoleServiceAccountsErrorMessage }

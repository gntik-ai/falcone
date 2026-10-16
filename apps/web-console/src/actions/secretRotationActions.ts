import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export type InitiateRotationInput = {
  gracePeriodSeconds: number
  justification: string
  newValue: string
}

export type RotationResult = {
  rotationId: string
  vaultVersionNew: number
  vaultVersionOld?: number | null
  gracePeriodSeconds: number
  graceExpiresAt?: string | null
}

export type RevokeInput = {
  justification: string
  forceRevoke?: boolean
}

export type RevokeResult = {
  revokedVersion: number
  effectiveAt: string
}

export type PaginationInput = {
  limit?: number
  offset?: number
}

export type RotationHistoryPage = {
  items: Array<Record<string, unknown>>
  total: number
}

export type ConsumerStatusPage = {
  consumers: Array<{
    consumer_id: string
    reload_mechanism: string
    state: string
    confirmedAt?: string | null
    timeoutAt?: string | null
  }>
}

function parseSecretPath(secretPath: string) {
  const parts = secretPath.split('/')
  const domain = parts[0]
  const secretName = parts[parts.length - 1]
  const validShape = domain === 'tenant'
    ? parts.length === 3 && parts[1].length > 0
    : ['platform', 'gateway', 'iam', 'functions'].includes(domain) && parts.length === 2
  if (!validShape || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(secretName)) {
    throw new Error('INVALID_SECRET_PATH')
  }
  return { domain, secretName }
}

export async function initiateRotation(secretPath: string, { gracePeriodSeconds, justification, newValue }: InitiateRotationInput): Promise<RotationResult> {
  const { domain, secretName } = parseSecretPath(secretPath)
  return requestConsoleSessionJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/rotate`, {
    method: 'POST',
    body: { gracePeriodSeconds, justification, newValue }
  })
}

export async function revokeSecretVersion(secretPath: string, vaultVersion: number, { justification, forceRevoke }: RevokeInput): Promise<RevokeResult> {
  const { domain, secretName } = parseSecretPath(secretPath)
  return requestConsoleSessionJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/versions/${vaultVersion}/revoke`, {
    method: 'POST',
    body: { justification, forceRevoke }
  })
}

export async function listRotationHistory(secretPath: string, { limit = 20, offset = 0 }: PaginationInput): Promise<RotationHistoryPage> {
  const { domain, secretName } = parseSecretPath(secretPath)
  return requestConsoleSessionJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/history?limit=${limit}&offset=${offset}`)
}

export async function getConsumerStatus(secretPath: string, vaultVersion?: number): Promise<ConsumerStatusPage> {
  const { domain, secretName } = parseSecretPath(secretPath)
  const suffix = typeof vaultVersion === 'number' ? `?vaultVersion=${vaultVersion}` : ''
  return requestConsoleSessionJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/consumer-status${suffix}`)
}

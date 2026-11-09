import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

// Mirror the legacy action module, including tenant path parsing.
export interface SecretRotationInput {
  gracePeriodSeconds: number
  justification: string
  newValue: string
}
export interface SecretRotationResult {
  rotationId: string
  vaultVersionNew: number
  vaultVersionOld?: number | null
  gracePeriodSeconds: number
  graceExpiresAt?: string | null
}
export interface SecretRotationHistory {
  items: Array<Record<string, unknown>>
  total: number
}
export interface SecretConsumerStatus {
  consumers: Array<{ consumer_id: string; reload_mechanism: string; state: string; confirmedAt?: string | null; timeoutAt?: string | null }>
}
export function parseRotationSecretPath(secretPath: string) {
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
function rotationBase(secretPath: string) {
  const { domain, secretName } = parseRotationSecretPath(secretPath)
  return `/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}`
}
export function initiateSecretRotation(secretPath: string, { gracePeriodSeconds, justification, newValue }: SecretRotationInput) {
  return requestConsoleSessionJson<SecretRotationResult>(`${rotationBase(secretPath)}/rotate`, {
    method: 'POST', body: { gracePeriodSeconds, justification, newValue },
  })
}
export function listSecretRotationHistory(secretPath: string, { limit = 20, offset = 0 }: { limit?: number; offset?: number }, signal?: AbortSignal) {
  return requestConsoleSessionJson<SecretRotationHistory>(`${rotationBase(secretPath)}/history?limit=${limit}&offset=${offset}`, { signal })
}
export function getSecretConsumerStatus(secretPath: string, signal?: AbortSignal) {
  return requestConsoleSessionJson<SecretConsumerStatus>(`${rotationBase(secretPath)}/consumer-status`, { signal })
}

import { readConsoleShellSession, requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'
import type { KafkaInventory, KafkaTopicDetail, KafkaAccessPolicy, KafkaMetadata, KafkaBridge, KafkaPublishRequest, KafkaPublishAccepted } from './types'

// Paths and the literal inventory query match ConsoleKafkaPage.tsx:406-641.
// Only these Kafka requests opt out of invalidation after the one shared refresh/replay.
const options = (signal: AbortSignal) => ({ method: 'GET' as const, signal, suppressUnauthorizedInvalidation: true })
export const inventory = (workspaceId: string, signal: AbortSignal) => requestConsoleSessionJson<KafkaInventory>(`/v1/events/workspaces/${workspaceId}/inventory?page[size]=100`, options(signal))
export const bridge = (workspaceId: string, bridgeId: string, signal: AbortSignal) => requestConsoleSessionJson<KafkaBridge>(`/v1/events/workspaces/${workspaceId}/bridges/${bridgeId}`, options(signal))
export const detail = (resourceId: string, signal: AbortSignal) => requestConsoleSessionJson<KafkaTopicDetail>(`/v1/events/topics/${resourceId}`, options(signal))
export const access = (resourceId: string, signal: AbortSignal) => requestConsoleSessionJson<KafkaAccessPolicy>(`/v1/events/topics/${resourceId}/access`, options(signal))
export async function metadata(resourceId: string, signal: AbortSignal): Promise<KafkaMetadata> {
  const raw = await requestConsoleSessionJson<KafkaMetadata>(`/v1/events/topics/${resourceId}/metadata`, options(signal))
  return { ...raw,
    lag: raw.lag ? { ...raw.lag, totalLag: raw.lag.totalLag ?? raw.lag.maxMessagesBehind, maxPartitionLag: raw.lag.maxPartitionLag ?? raw.lag.maxMessagesBehind } : undefined,
    retention: raw.retention ? { ...raw.retention, retentionHours: raw.retention.retentionHours ?? raw.retention.hours, retentionBytes: raw.retention.retentionBytes ?? raw.retention.retentionMs, effectivePolicy: raw.retention.effectivePolicy ?? 'provider_managed' } : undefined,
  }
}
export function publishBody(form: { payload: string; eventType: string; key: string; contentType: string }): KafkaPublishRequest {
  let payload: unknown = form.payload
  try { payload = form.payload.trim() ? JSON.parse(form.payload) : form.payload } catch { /* Raw text is valid legacy input. */ }
  return { payload, eventType: form.eventType || undefined, key: form.key || undefined, contentType: form.contentType || undefined }
}
export const publish = (resourceId: string, body: KafkaPublishRequest, signal: AbortSignal) => requestConsoleSessionJson<KafkaPublishAccepted>(`/v1/events/topics/${resourceId}/publish`, { method: 'POST', body: body as never, signal, suppressUnauthorizedInvalidation: true })
export const streamToken = () => readConsoleShellSession()?.tokenSet?.accessToken?.trim()
// Raw fetch deliberately does not refresh or invalidate the session on an SSE 401.
export const stream = (resourceId: string, token: string, signal: AbortSignal) => fetch(`/v1/events/topics/${resourceId}/stream`, { headers: { Authorization: `Bearer ${token}` }, signal })
export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId }
}

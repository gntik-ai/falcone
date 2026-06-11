// Events (Kafka) data client for the console (change: add-console-events-data-editor).
// Calls the control-plane executor's event routes exactly: topic list/create, publish, consume.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export interface TopicRecord {
  topic: string
  partitions?: number
}

export interface EventMessage {
  key?: string | null
  value: JsonValue
  partition?: number
  offset?: string | number
  timestamp?: string
}

const topicsBase = (workspaceId: string) => `/v1/events/workspaces/${enc(workspaceId)}/topics`

export function listTopics(workspaceId: string): Promise<{ items: TopicRecord[] }> {
  return requestConsoleSessionJson<{ items: TopicRecord[] }>(topicsBase(workspaceId))
}

export function createTopic(
  workspaceId: string,
  topic: string,
  options: { partitions?: number } = {}
): Promise<{ topic: string }> {
  return requestConsoleSessionJson<{ topic: string }>(topicsBase(workspaceId), {
    method: 'POST',
    body: { topic, ...options }
  })
}

export function publishMessage(
  workspaceId: string,
  topic: string,
  message: { key?: string; value: JsonValue }
): Promise<{ partition?: number; offset?: string | number }> {
  return requestConsoleSessionJson<{ partition?: number; offset?: string | number }>(
    `${topicsBase(workspaceId)}/${enc(topic)}/publish`,
    { method: 'POST', body: message as unknown as JsonValue }
  )
}

export function consumeMessages(
  workspaceId: string,
  topic: string,
  options: { maxMessages?: number; timeoutMs?: number } = {}
): Promise<{ items: EventMessage[] }> {
  const params = new URLSearchParams()
  if (options.maxMessages != null) params.set('maxMessages', String(options.maxMessages))
  if (options.timeoutMs != null) params.set('timeoutMs', String(options.timeoutMs))
  const qs = params.toString()
  return requestConsoleSessionJson<{ items: EventMessage[] }>(
    `${topicsBase(workspaceId)}/${enc(topic)}/messages${qs ? `?${qs}` : ''}`
  )
}

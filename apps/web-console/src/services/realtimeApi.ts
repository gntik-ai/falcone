// Realtime change-stream client for the console (change: add-realtime-gateway-console).
// Subscribes to a collection's tenant-scoped changes via Server-Sent Events. A browser
// EventSource cannot set headers, so the anon key is passed as ?apikey= (the gateway routes
// it to the executor, which verifies the key). URL matches the executor's SSE route exactly.
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export interface RealtimeChange {
  type: string
  documentId: JsonValue
  document: Record<string, JsonValue> | null
}

export interface RealtimeSubscription {
  close: () => void
}

const CHANGE_EVENTS = ['insert', 'update', 'replace']

export function realtimeChangesUrl(params: {
  workspaceId: string
  databaseName: string
  collectionName: string
  apiKey: string
  origin?: string
}): string {
  const base = `${params.origin ?? ''}/v1/realtime/workspaces/${enc(params.workspaceId)}/data/${enc(params.databaseName)}/collections/${enc(params.collectionName)}/changes`
  return `${base}?apikey=${enc(params.apiKey)}`
}

export function subscribeRealtimeChanges(params: {
  workspaceId: string
  databaseName: string
  collectionName: string
  apiKey: string
  onChange: (change: RealtimeChange) => void
  onError?: (event: Event) => void
  origin?: string
}): RealtimeSubscription {
  const source = new EventSource(realtimeChangesUrl(params))
  for (const type of CHANGE_EVENTS) {
    source.addEventListener(type, (event) => {
      try {
        params.onChange(JSON.parse((event as MessageEvent).data) as RealtimeChange)
      } catch {
        /* ignore malformed frame */
      }
    })
  }
  if (params.onError) source.addEventListener('error', params.onError)
  return { close: () => source.close() }
}

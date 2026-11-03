import type { RealtimeChange, RealtimeTarget } from './stream'

// Legacy RealtimeConsole.tsx:41 keeps the 100 newest changes.
export const MAX_CHANGES = 100
export type Source = 'mongo' | 'postgres'
export type ChangeLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ChangeEntry {
  id: string
  type: string
  // The type is one of the four stream events, so it can label a log level.
  known: boolean
  level: ChangeLevel
  json: string
  document: unknown
  receivedAt: string
}

// log-viewer filters by level, so each change type takes one level and the filter becomes a type filter.
export const levelByType: Record<string, ChangeLevel> = { insert: 'info', update: 'warn', replace: 'debug', delete: 'error' }
export const typeByLevel: Record<ChangeLevel, string> = { info: 'insert', warn: 'update', debug: 'replace', error: 'delete' }

const pad = (value: number, width = 2) => String(value).padStart(width, '0')
export const formatReceivedAt = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`

export function toEntry(change: unknown, eventName: string, id: string, receivedAt: Date): ChangeEntry {
  const frame = (change && typeof change === 'object' ? change : {}) as Partial<RealtimeChange>
  const type = typeof frame.type === 'string' && frame.type !== '' ? frame.type : eventName
  const document = frame.document === undefined ? null : frame.document
  return {
    id, type, known: type in levelByType, level: levelByType[type] ?? 'info',
    json: JSON.stringify(document) ?? 'null', document, receivedAt: formatReceivedAt(receivedAt),
  }
}

// Newest first, capped at the 100 newest.
export const pushChange = (list: ChangeEntry[], entry: ChangeEntry): ChangeEntry[] => [entry, ...list].slice(0, MAX_CHANGES)

// Without an explicit selection the viewer follows the newest change; an evicted selection returns to it.
export const resolveSelected = (list: ChangeEntry[], selectedId: string | null): ChangeEntry | null =>
  list.find((entry) => entry.id === selectedId) ?? list[0] ?? null

export interface RealtimeForm { source: Source; database: string; collection: string; schema: string; table: string; apiKey: string }

// Legacy RealtimeConsole.tsx:43-61: values are trimmed and a blank schema defaults to public.
export function buildTarget(form: RealtimeForm): { target: RealtimeTarget; apiKey: string } | null {
  const databaseName = form.database.trim()
  const apiKey = form.apiKey.trim()
  if (databaseName === '' || apiKey === '') return null
  if (form.source === 'mongo') {
    const collectionName = form.collection.trim()
    return collectionName === '' ? null : { target: { source: 'mongo', databaseName, collectionName }, apiKey }
  }
  const tableName = form.table.trim()
  return tableName === '' ? null : { target: { source: 'postgres', databaseName, schemaName: form.schema.trim() || 'public', tableName }, apiKey }
}

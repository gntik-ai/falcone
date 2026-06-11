// Realtime console (changes: add-realtime-gateway-console, add-realtime-unify).
// Subscribes to a tenant-scoped change stream via SSE (anon key as ?apikey=, exactly as a
// frontend app would) for EITHER a Mongo collection or a Postgres table, and shows changes
// streaming in live.
import { useEffect, useRef, useState } from 'react'

import {
  subscribeRealtimeChanges,
  type RealtimeChange,
  type RealtimeSubscription,
  type RealtimeTarget
} from '@/services/realtimeApi'

export interface RealtimeConsoleProps {
  workspaceId: string
}

export function RealtimeConsole({ workspaceId }: RealtimeConsoleProps) {
  const [source, setSource] = useState<'mongo' | 'postgres'>('mongo')
  const [databaseName, setDatabaseName] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [schemaName, setSchemaName] = useState('public')
  const [tableName, setTableName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [changes, setChanges] = useState<RealtimeChange[]>([])
  const [subscribed, setSubscribed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const subRef = useRef<RealtimeSubscription | null>(null)

  function stop() {
    subRef.current?.close()
    subRef.current = null
    setSubscribed(false)
  }

  // Always tear down the stream on unmount.
  useEffect(() => () => subRef.current?.close(), [])

  function buildTarget(): RealtimeTarget | null {
    if (databaseName.trim() === '') return null
    if (source === 'mongo') {
      if (collectionName.trim() === '') return null
      return { source: 'mongo', databaseName: databaseName.trim(), collectionName: collectionName.trim() }
    }
    if (tableName.trim() === '') return null
    return { source: 'postgres', databaseName: databaseName.trim(), schemaName: schemaName.trim() || 'public', tableName: tableName.trim() }
  }

  function start() {
    setError(null)
    const target = buildTarget()
    if (!target || apiKey.trim() === '') {
      setError(source === 'mongo'
        ? 'Database, collection, and an anon key are required'
        : 'Database, table, and an anon key are required')
      return
    }
    stop()
    setChanges([])
    subRef.current = subscribeRealtimeChanges({
      workspaceId,
      target,
      apiKey: apiKey.trim(),
      onChange: (change) => setChanges((prev) => [change, ...prev].slice(0, 100)),
      onError: () => setError('Stream error — check the key, target, and that the workspace backend supports change streams')
    })
    setSubscribed(true)
  }

  return (
    <section aria-label="Realtime console">
      {error ? <p role="alert">{error}</p> : null}

      <div>
        <label htmlFor="rt-source">Source</label>
        <select id="rt-source" value={source} onChange={(event) => setSource(event.target.value as 'mongo' | 'postgres')}>
          <option value="mongo">Mongo collection</option>
          <option value="postgres">Postgres table</option>
        </select>
        <label htmlFor="rt-db">Database</label>
        <input id="rt-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
        {source === 'mongo' ? (
          <>
            <label htmlFor="rt-collection">Collection</label>
            <input id="rt-collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
          </>
        ) : (
          <>
            <label htmlFor="rt-schema">Schema</label>
            <input id="rt-schema" value={schemaName} onChange={(event) => setSchemaName(event.target.value)} />
            <label htmlFor="rt-table">Table</label>
            <input id="rt-table" value={tableName} onChange={(event) => setTableName(event.target.value)} />
          </>
        )}
        <label htmlFor="rt-key">Anon key</label>
        <input id="rt-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="flc_anon_…" />
      </div>
      {subscribed ? (
        <button type="button" onClick={stop}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={start}>
          Subscribe
        </button>
      )}

      <h3>Live changes{changes.length > 0 ? ` (${changes.length})` : ''}</h3>
      {subscribed && changes.length === 0 ? <p>Listening… write to the {source === 'mongo' ? 'collection' : 'table'} to see changes.</p> : null}
      <ul>
        {changes.map((change, index) => (
          <li key={`${String(change.documentId)}-${index}`}>
            <strong>{change.type}</strong> <code>{JSON.stringify(change.document)}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}

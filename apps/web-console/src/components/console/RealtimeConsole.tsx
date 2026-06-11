// Realtime console (change: add-realtime-gateway-console).
// Subscribes to a collection's tenant-scoped change stream via SSE (using an anon key as
// ?apikey=, exactly as a frontend app would) and shows changes streaming in live.
import { useEffect, useRef, useState } from 'react'

import {
  subscribeRealtimeChanges,
  type RealtimeChange,
  type RealtimeSubscription
} from '@/services/realtimeApi'

export interface RealtimeConsoleProps {
  workspaceId: string
}

export function RealtimeConsole({ workspaceId }: RealtimeConsoleProps) {
  const [databaseName, setDatabaseName] = useState('')
  const [collectionName, setCollectionName] = useState('')
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

  function start() {
    setError(null)
    if (databaseName.trim() === '' || collectionName.trim() === '' || apiKey.trim() === '') {
      setError('Database, collection, and an anon key are required')
      return
    }
    stop()
    setChanges([])
    subRef.current = subscribeRealtimeChanges({
      workspaceId,
      databaseName: databaseName.trim(),
      collectionName: collectionName.trim(),
      apiKey: apiKey.trim(),
      onChange: (change) => setChanges((prev) => [change, ...prev].slice(0, 100)),
      onError: () => setError('Stream error — check the key, collection, and that the workspace has a replica set')
    })
    setSubscribed(true)
  }

  return (
    <section aria-label="Realtime console">
      {error ? <p role="alert">{error}</p> : null}

      <div>
        <label htmlFor="rt-db">Database</label>
        <input id="rt-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
        <label htmlFor="rt-collection">Collection</label>
        <input id="rt-collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
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
      {subscribed && changes.length === 0 ? <p>Listening… write to the collection to see changes.</p> : null}
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

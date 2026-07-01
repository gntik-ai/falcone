// Realtime console (changes: add-realtime-gateway-console, add-realtime-unify).
// Subscribes to a tenant-scoped change stream via SSE (anon key as ?apikey=, exactly as a
// frontend app would) for EITHER a Mongo collection or a Postgres table, and shows changes
// streaming in live.
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
        ? 'Base de datos, colección y clave anónima son obligatorias'
        : 'Base de datos, tabla y clave anónima son obligatorias')
      return
    }
    stop()
    setChanges([])
    subRef.current = subscribeRealtimeChanges({
      workspaceId,
      target,
      apiKey: apiKey.trim(),
      onChange: (change) => setChanges((prev) => [change, ...prev].slice(0, 100)),
      onError: () => setError('Error del flujo: revisa la clave, el destino y que el servidor del área de trabajo soporte flujos de cambios')
    })
    setSubscribed(true)
  }

  return (
    <section aria-label="Consola de tiempo real" className="space-y-4">
      {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}

      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-source">Origen</Label>
          <Select id="rt-source" value={source} onChange={(event) => setSource(event.target.value as 'mongo' | 'postgres')}>
            <option value="mongo">Colección Mongo</option>
            <option value="postgres">Tabla Postgres</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-db">Base de datos</Label>
          <Input id="rt-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
        </div>
        {source === 'mongo' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rt-collection">Colección</Label>
            <Input id="rt-collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rt-schema">Esquema</Label>
              <Input id="rt-schema" value={schemaName} onChange={(event) => setSchemaName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rt-table">Tabla</Label>
              <Input id="rt-table" value={tableName} onChange={(event) => setTableName(event.target.value)} />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-key">Clave anónima</Label>
          <Input id="rt-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="flc_anon_…" />
        </div>
      </div>
      {subscribed ? (
        <Button type="button" variant="outline" onClick={stop}>
          Detener
        </Button>
      ) : (
        <Button type="button" onClick={start}>
          Suscribirse
        </Button>
      )}

      <h3 className="text-base font-semibold text-foreground">Cambios en vivo{changes.length > 0 ? ` (${changes.length})` : ''}</h3>
      {subscribed && changes.length === 0 ? <p>Escuchando… escribe en la {source === 'mongo' ? 'colección' : 'tabla'} para ver cambios.</p> : null}
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

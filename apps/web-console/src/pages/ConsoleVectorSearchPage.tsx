// Console page: Vector search (change: add-vector-search-console).
// Supplies the active workspace + a database/schema/table selection to the
// VectorSearchConsole (KNN search, vector-index management, embedding-provider config).
import { useState } from 'react'

import { VectorSearchConsole } from '@/components/console/VectorSearchConsole'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleVectorSearchPage() {
  const { activeWorkspaceId } = useConsoleContext()
  const [databaseName, setDatabaseName] = useState('')
  const [schemaName, setSchemaName] = useState('public')
  const [tableName, setTableName] = useState('')

  if (!activeWorkspaceId) {
    return <p>Select a workspace to run vector-search operations.</p>
  }

  const ready = databaseName.trim() !== '' && tableName.trim() !== ''

  return (
    <div>
      <h1>Vector search</h1>
      <p>Run KNN similarity searches, manage vector indexes, and configure the embedding provider.</p>
      <div>
        <label htmlFor="vs-db">Database</label>
        <input id="vs-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
        <label htmlFor="vs-schema">Schema</label>
        <input id="vs-schema" value={schemaName} onChange={(event) => setSchemaName(event.target.value)} />
        <label htmlFor="vs-table">Table</label>
        <input id="vs-table" value={tableName} onChange={(event) => setTableName(event.target.value)} />
      </div>
      {ready ? (
        <VectorSearchConsole
          workspaceId={activeWorkspaceId}
          databaseName={databaseName.trim()}
          schemaName={schemaName.trim() || 'public'}
          tableName={tableName.trim()}
        />
      ) : (
        <p>Enter a database and table to begin.</p>
      )}
    </div>
  )
}

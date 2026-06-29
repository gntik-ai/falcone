// Console page: Postgres data editor (change: add-console-postgres-data-editor).
// Supplies the active workspace + a database/schema/table selection to the
// PostgresDataEditor (row CRUD + API-key panel).
import { useState } from 'react'

import { PostgresDataEditor } from '@/components/console/PostgresDataEditor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConsoleContext } from '@/lib/console-context'

export function ConsolePostgresDataPage() {
  const { activeWorkspaceId } = useConsoleContext()
  const [databaseName, setDatabaseName] = useState('')
  const [schemaName, setSchemaName] = useState('public')
  const [tableName, setTableName] = useState('')

  if (!activeWorkspaceId) {
    return <p>Select a workspace to edit data.</p>
  }

  const ready = databaseName.trim() !== '' && tableName.trim() !== ''

  return (
    <div>
      <h1>Data editor</h1>
      <p>Query and edit table rows, and mint API keys for your apps.</p>
      <div>
        <Label htmlFor="pg-db">Database</Label>
        <Input id="pg-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
        <Label htmlFor="pg-schema">Schema</Label>
        <Input id="pg-schema" value={schemaName} onChange={(event) => setSchemaName(event.target.value)} />
        <Label htmlFor="pg-table">Table</Label>
        <Input id="pg-table" value={tableName} onChange={(event) => setTableName(event.target.value)} />
      </div>
      {ready ? (
        <PostgresDataEditor
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

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
    return <p className="text-sm text-muted-foreground">Select a workspace to edit data.</p>
  }

  const ready = databaseName.trim() !== '' && tableName.trim() !== ''

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Data editor</h1>
        <p className="mt-2 text-sm text-muted-foreground">Query and edit table rows, and mint API keys for your apps.</p>
        <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-db">Database</Label>
            <Input id="pg-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} placeholder="app_db" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-schema">Schema</Label>
            <Input id="pg-schema" value={schemaName} onChange={(event) => setSchemaName(event.target.value)} placeholder="public" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pg-table">Table</Label>
            <Input id="pg-table" value={tableName} onChange={(event) => setTableName(event.target.value)} placeholder="accounts" />
          </div>
        </div>
      </header>
      {ready ? (
        <PostgresDataEditor
          workspaceId={activeWorkspaceId}
          databaseName={databaseName.trim()}
          schemaName={schemaName.trim() || 'public'}
          tableName={tableName.trim()}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Enter a database and table to begin.</p>
      )}
    </section>
  )
}

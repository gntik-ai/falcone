// Console page: Mongo data editor (change: add-console-mongo-data-editor).
// Supplies the active workspace + a database/collection selection to the MongoDataEditor.
import { useState } from 'react'

import { MongoDataEditor } from '@/components/console/MongoDataEditor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleMongoDataPage() {
  const { activeWorkspaceId } = useConsoleContext()
  const [databaseName, setDatabaseName] = useState('')
  const [collectionName, setCollectionName] = useState('')

  if (!activeWorkspaceId) {
    return <p>Select a workspace to edit data.</p>
  }

  const ready = databaseName.trim() !== '' && collectionName.trim() !== ''

  return (
    <div>
      <h1>Mongo data editor</h1>
      <p>Query and edit documents in a collection.</p>
      <div>
        <Label htmlFor="mongo-db">Database</Label>
        <Input id="mongo-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
        <Label htmlFor="mongo-collection">Collection</Label>
        <Input id="mongo-collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} />
      </div>
      {ready ? (
        <MongoDataEditor
          workspaceId={activeWorkspaceId}
          databaseName={databaseName.trim()}
          collectionName={collectionName.trim()}
        />
      ) : (
        <p>Enter a database and collection to begin.</p>
      )}
    </div>
  )
}

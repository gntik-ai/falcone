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
    return <p className="text-sm text-muted-foreground">Selecciona un área de trabajo para editar datos.</p>
  }

  const ready = databaseName.trim() !== '' && collectionName.trim() !== ''

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Editor de datos Mongo</h1>
        <p className="mt-2 text-sm text-muted-foreground">Consulta y edita documentos en una colección.</p>
        <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mongo-db">Base de datos</Label>
            <Input id="mongo-db" value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} placeholder="catalog" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mongo-collection">Colección</Label>
            <Input id="mongo-collection" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="orders" />
          </div>
        </div>
      </header>
      {ready ? (
        <MongoDataEditor
          workspaceId={activeWorkspaceId}
          databaseName={databaseName.trim()}
          collectionName={collectionName.trim()}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Introduce una base de datos y una colección para comenzar.</p>
      )}
    </section>
  )
}

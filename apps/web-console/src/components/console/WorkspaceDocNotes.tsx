import { useMemo, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { WorkspaceDocNote } from '@/lib/console-workspace-docs'

interface Props {
  notes: WorkspaceDocNote[]
  workspaceId: string
  canManageNotes: boolean
  onCreate?: (content: string) => Promise<void>
  onUpdate?: (noteId: string, content: string) => Promise<void>
  onDelete?: (noteId: string) => Promise<void>
}

type PendingNoteAction =
  | { type: 'create' }
  | { type: 'update'; noteId: string }

export function WorkspaceDocNotes({ notes, workspaceId, canManageNotes, onCreate, onUpdate, onDelete }: Props) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [pendingAction, setPendingAction] = useState<PendingNoteAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const destructiveOp = useDestructiveOp()
  const orderedNotes = useMemo(() => [...notes], [notes])
  const isInlineBusy = pendingAction !== null

  async function handleCreateNote() {
    if (!draft.trim() || !onCreate) return

    setActionError(null)
    setPendingAction({ type: 'create' })
    try {
      await onCreate(draft)
      setDraft('')
    } catch (error) {
      setActionError(getWorkspaceNoteActionErrorMessage('create', error))
    } finally {
      setPendingAction(null)
    }
  }

  async function handleUpdateNote(noteId: string, content: string) {
    if (!onUpdate) return

    setActionError(null)
    setPendingAction({ type: 'update', noteId })
    try {
      await onUpdate(noteId, content)
      setEditing((current) => {
        const next = { ...current }
        delete next[noteId]
        return next
      })
    } catch (error) {
      setActionError(getWorkspaceNoteActionErrorMessage('update', error))
    } finally {
      setPendingAction(null)
    }
  }

  function openDeleteDialog(note: WorkspaceDocNote) {
    if (!onDelete) return

    setActionError(null)
    destructiveOp.openDialog({
      level: 'WARNING',
      operationId: `delete-workspace-doc-note-${note.noteId}`,
      resourceName: note.noteId,
      resourceType: 'nota personalizada',
      impactDescription: `La nota se quitará de la documentación del área de trabajo ${workspaceId}.`,
      onConfirm: () => onDelete(note.noteId)
    })
  }

  return (
    <section aria-label="Notas del área de trabajo" className="space-y-4 rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Notas personalizadas</h2>
      {!canManageNotes ? (
        <p className="text-sm text-muted-foreground">Estas notas están en modo solo lectura para tu rol.</p>
      ) : null}
      {canManageNotes ? (
        <form onSubmit={(event) => {
          event.preventDefault()
          void handleCreateNote()
        }} className="space-y-3 rounded-2xl border border-border/70 bg-background/60 p-4"
        >
          <Textarea
            aria-label="Nota nueva"
            aria-describedby={actionError ? 'workspace-doc-note-action-error' : undefined}
            className="min-h-24"
            placeholder="Agrega una nota para esta área de trabajo"
            value={draft}
            disabled={isInlineBusy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={!draft.trim() || !onCreate || isInlineBusy}
            aria-busy={pendingAction?.type === 'create'}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {pendingAction?.type === 'create' ? 'Agregando...' : 'Agregar nota'}
          </Button>
        </form>
      ) : null}
      {actionError ? (
        <p id="workspace-doc-note-action-error" role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
      <div className="space-y-3">
        {orderedNotes.map((note) => {
          const current = editing[note.noteId] ?? note.content
          const isUpdatePending = pendingAction?.type === 'update' && pendingAction.noteId === note.noteId
          return (
            <article key={note.noteId} className="space-y-3 rounded-2xl border border-border/70 bg-background/60 p-4">
              {canManageNotes ? (
                <Textarea
                  aria-label={`Editar ${note.noteId}`}
                  className="min-h-24"
                  value={current}
                  disabled={isInlineBusy}
                  onChange={(event) => setEditing((prev) => ({ ...prev, [note.noteId]: event.target.value }))}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{note.content}</p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Autor: <span className="font-mono text-foreground">{note.authorId}</span>
                </p>
                {canManageNotes ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!onUpdate || isInlineBusy}
                      aria-busy={isUpdatePending}
                      onClick={() => void handleUpdateNote(note.noteId, current)}
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                      {isUpdatePending ? 'Guardando...' : 'Guardar'}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={!onDelete || isInlineBusy}
                      aria-haspopup="dialog"
                      onClick={() => openDeleteDialog(note)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Eliminar
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
        {orderedNotes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
            No hay notas todavía.
          </p>
        ) : null}
      </div>
      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}

function getWorkspaceNoteActionErrorMessage(action: 'create' | 'update', error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return action === 'create'
    ? 'No se pudo agregar la nota. Inténtalo de nuevo.'
    : 'No se pudo guardar la nota. Inténtalo de nuevo.'
}

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { WorkspaceDocAuthSection } from '@/components/console/WorkspaceDocAuthSection'
import { WorkspaceDocNotes } from '@/components/console/WorkspaceDocNotes'
import { WorkspaceDocSections } from '@/components/console/WorkspaceDocSections'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  canManageWorkspaceDocNotes,
  createDocNote,
  deleteDocNote,
  fetchWorkspaceDocs,
  updateDocNote,
  type WorkspaceDocNote,
  type WorkspaceDocsResponse
} from '@/lib/console-workspace-docs'
import { readConsoleShellSession } from '@/lib/console-session'

export function ConsoleDocsPage() {
  const { workspaceId = '' } = useParams()
  const [notesOverride, setNotesOverride] = useState<WorkspaceDocNote[] | null>(null)
  const [data, setData] = useState<WorkspaceDocsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const canManageNotes = canManageWorkspaceDocNotes(readConsoleShellSession()?.principal?.platformRoles)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetchWorkspaceDocs(workspaceId)
      .then((result) => {
        if (cancelled) return
        setData(result)
      })
      .catch(() => {
        if (cancelled) return
        setIsError(true)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadKey])

  const notes = useMemo(() => notesOverride ?? data?.customNotes ?? [], [notesOverride, data])

  if (isLoading) {
    return (
      <section
        data-testid="docs-loading"
        role="status"
        aria-busy="true"
        className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm"
      >
        <p className="text-sm text-muted-foreground">Loading workspace docs…</p>
      </section>
    )
  }

  if (isError || !data) {
    return (
      <Alert
        data-testid="docs-error"
        variant="destructive"
        className="border-destructive/30 bg-destructive/5 text-foreground"
      >
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/20 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <AlertTitle className="text-base">No se pudo cargar la documentación.</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              No se pudo cargar la documentación del workspace.
            </AlertDescription>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Volver a intentar
            </Button>
          </div>
        </div>
      </Alert>
    )
  }

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="workspace-docs-heading">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-4">
            <nav aria-label="Breadcrumb" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <ol className="flex flex-wrap items-center gap-2">
                <li>
                  <Link className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" to="/console/overview">
                    Console
                  </Link>
                </li>
                <li aria-hidden="true" className="text-border">/</li>
                <li>
                  <Link className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" to="/console/workspaces">
                    Workspaces
                  </Link>
                </li>
                <li aria-hidden="true" className="text-border">/</li>
                <li className="max-w-full truncate font-mono normal-case tracking-normal">
                  <Link className="rounded-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" to={`/console/workspaces/${encodeURIComponent(workspaceId)}`}>
                    {workspaceId}
                  </Link>
                </li>
                <li aria-hidden="true" className="text-border">/</li>
                <li aria-current="page" className="text-foreground">Documentation</li>
              </ol>
            </nav>

            <div className="space-y-2">
              <h1 id="workspace-docs-heading" className="text-2xl font-semibold tracking-tight">Documentación del workspace</h1>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <p className="break-all rounded-2xl border border-border/70 bg-background/60 p-3 font-mono text-foreground">
                  {`Base URL: ${data.baseUrl}`}
                </p>
                <p className="rounded-2xl border border-border/70 bg-background/60 p-3 text-muted-foreground">
                  {`Última generación: ${new Date(data.generatedAt).toLocaleString()}`}
                </p>
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            aria-label="Refresh workspace documentation"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      <WorkspaceDocAuthSection authInstructions={data.authInstructions} />
      <WorkspaceDocSections enabledServices={data.enabledServices} />
      <WorkspaceDocNotes
        workspaceId={workspaceId}
        notes={notes}
        canManageNotes={canManageNotes}
        onCreate={async (content) => {
          const created = await createDocNote(workspaceId, content)
          setNotesOverride([...(notesOverride ?? data.customNotes), created])
        }}
        onUpdate={async (noteId, content) => {
          const updated = await updateDocNote(workspaceId, noteId, content)
          setNotesOverride((notesOverride ?? data.customNotes).map((note) => note.noteId === noteId ? updated : note))
        }}
        onDelete={async (noteId) => {
          await deleteDocNote(workspaceId, noteId)
          setNotesOverride((notesOverride ?? data.customNotes).filter((note) => note.noteId !== noteId))
        }}
      />
    </main>
  )
}

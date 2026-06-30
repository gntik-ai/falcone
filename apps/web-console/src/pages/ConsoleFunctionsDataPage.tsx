// Console page: Functions console (change: add-console-functions-data-editor).
// Supplies the active workspace to the FunctionsConsole (list/deploy/invoke).
import { FunctionsConsole } from '@/components/console/FunctionsConsole'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleFunctionsDataPage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()

  if (!activeTenantId) {
    return (
      <p role="status" className="rounded-sm border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Select a tenant to use functions.
      </p>
    )
  }

  if (!activeWorkspaceId) {
    return (
      <p role="status" className="rounded-sm border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Select a workspace to use functions.
      </p>
    )
  }

  return (
    <section className="space-y-5" aria-labelledby="functions-data-title">
      <header className="max-w-3xl space-y-1.5">
        <h1 id="functions-data-title" className="text-2xl font-semibold text-foreground">Data: Functions</h1>
        <p className="text-sm leading-6 text-muted-foreground">Deploy functions and invoke them against the workspace runtime.</p>
      </header>
      <FunctionsConsole tenantId={activeTenantId} workspaceId={activeWorkspaceId} />
    </section>
  )
}

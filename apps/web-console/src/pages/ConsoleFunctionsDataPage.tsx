// Console page: Functions console (change: add-console-functions-data-editor).
// Supplies the active workspace to the FunctionsConsole (list/deploy/invoke).
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { FunctionsConsole } from '@/components/console/FunctionsConsole'
import { Badge } from '@/components/ui/badge'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleFunctionsDataPage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()

  if (!activeTenantId) {
    return (
      <ConsolePageState
        kind="blocked"
        title="Funciones bloqueadas"
        description="Selecciona una organización para usar funciones."
      />
    )
  }

  if (!activeWorkspaceId) {
    return (
      <ConsolePageState
        kind="blocked"
        title="Funciones bloqueadas"
        description="Selecciona un área de trabajo para usar funciones."
      />
    )
  }

  return (
    <section className="space-y-5" aria-labelledby="functions-data-title">
      <header className="max-w-3xl space-y-1.5">
        <Badge variant="outline">Funciones</Badge>
        <h1 id="functions-data-title" className="text-2xl font-semibold text-foreground">Funciones: despliegue rápido</h1>
        <p className="text-sm leading-6 text-muted-foreground">Despliega funciones e invócalas contra el runtime del área de trabajo.</p>
        <p className="text-sm leading-6 text-muted-foreground">
          Para versiones, rollback y disparadores, usa{' '}
          <a className="font-medium text-primary underline-offset-4 hover:underline" href="/console/functions">
            Funciones: administrar
          </a>.
        </p>
      </header>
      <FunctionsConsole tenantId={activeTenantId} workspaceId={activeWorkspaceId} />
    </section>
  )
}

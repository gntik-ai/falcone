// Console page: Events (Kafka) console (change: add-console-events-data-editor).
// Supplies the active workspace to the EventsConsole (topics, publish, consume).
import { LockKeyhole, ShieldCheck } from 'lucide-react'

import { EventsConsole } from '@/components/console/EventsConsole'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Badge } from '@/components/ui/badge'
import { useConsoleContext } from '@/lib/console-context'
import { readConsoleShellSession } from '@/lib/console-session'
import { canPerformStructuralWrites } from '@/lib/structural-write-access'

export function ConsoleEventsDataPage() {
  const { activeWorkspaceId } = useConsoleContext()
  const canManageEvents = canPerformStructuralWrites(readConsoleShellSession()?.principal?.platformRoles)

  if (!activeWorkspaceId) {
    return <WorkspaceRequiredState description="Selecciona un área de trabajo para usar eventos." />
  }

  return (
    <section className="space-y-6" aria-labelledby="events-data-title">
      <header className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl space-y-2">
            <h1 id="events-data-title" className="text-2xl font-semibold tracking-tight text-foreground">Eventos</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {canManageEvents
                ? 'Gestiona topics, publica mensajes y consume desde el flujo del área de trabajo.'
                : 'Consulta topics y consume mensajes desde el flujo del área de trabajo.'}
            </p>
          </div>
          <Badge variant={canManageEvents ? 'secondary' : 'outline'} className="w-fit gap-1.5 px-3 py-1">
            {canManageEvents ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{canManageEvents ? 'Acceso de escritura admin' : 'Solo lectura'}</span>
          </Badge>
        </div>
      </header>
      <EventsConsole workspaceId={activeWorkspaceId} canManageEvents={canManageEvents} />
    </section>
  )
}

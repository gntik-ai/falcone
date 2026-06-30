// Console page: Events (Kafka) console (change: add-console-events-data-editor).
// Supplies the active workspace to the EventsConsole (topics, publish, consume).
import { EventsConsole } from '@/components/console/EventsConsole'
import { Badge } from '@/components/ui/badge'
import { useConsoleContext } from '@/lib/console-context'
import { readConsoleShellSession } from '@/lib/console-session'
import { canPerformStructuralWrites } from '@/lib/structural-write-access'

export function ConsoleEventsDataPage() {
  const { activeWorkspaceId } = useConsoleContext()
  const canManageEvents = canPerformStructuralWrites(readConsoleShellSession()?.principal?.platformRoles)

  if (!activeWorkspaceId) {
    return (
      <p role="status" className="rounded-sm border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Select a workspace to use events.
      </p>
    )
  }

  return (
    <section className="space-y-5" aria-labelledby="events-data-title">
      <header className="max-w-3xl space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="events-data-title" className="text-2xl font-semibold text-foreground">Events</h1>
          <Badge variant={canManageEvents ? 'secondary' : 'outline'}>
            {canManageEvents ? 'Admin write access' : 'Read-only'}
          </Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {canManageEvents
            ? 'Manage topics, publish messages, and consume from a workspace stream.'
            : 'Browse topics and consume messages from a workspace stream.'}
        </p>
      </header>
      <EventsConsole workspaceId={activeWorkspaceId} canManageEvents={canManageEvents} />
    </section>
  )
}

// Console page: Events (Kafka) console (change: add-console-events-data-editor).
// Supplies the active workspace to the EventsConsole (topics, publish, consume).
import { EventsConsole } from '@/components/console/EventsConsole'
import { useConsoleContext } from '@/lib/console-context'
import { readConsoleShellSession } from '@/lib/console-session'
import { canPerformStructuralWrites } from '@/lib/structural-write-access'

export function ConsoleEventsDataPage() {
  const { activeWorkspaceId } = useConsoleContext()
  const canManageEvents = canPerformStructuralWrites(readConsoleShellSession()?.principal?.platformRoles)

  if (!activeWorkspaceId) {
    return <p>Select a workspace to use events.</p>
  }

  return (
    <div>
      <h1>Events</h1>
      <p>Manage topics, publish messages, and consume from a workspace stream.</p>
      <EventsConsole workspaceId={activeWorkspaceId} canManageEvents={canManageEvents} />
    </div>
  )
}

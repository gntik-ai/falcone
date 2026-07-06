// Console page: live realtime change stream (change: add-realtime-gateway-console).
// Distinct from ConsoleRealtimePage (snippets/metadata): this one opens a live SSE change
// stream via the executor and shows changes as they happen. Supplies the active workspace.
import { RealtimeConsole } from '@/components/console/RealtimeConsole'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleRealtimeChangesPage() {
  const { activeWorkspaceId } = useConsoleContext()

  if (!activeWorkspaceId) {
    return <WorkspaceRequiredState description="Selecciona un área de trabajo para usar tiempo real." />
  }

  return (
    <div>
      <h1>Cambios en tiempo real</h1>
      <p>Suscríbete al flujo de cambios de la organización para una colección Mongo o una tabla Postgres con una clave anónima y observa los cambios en vivo.</p>
      <RealtimeConsole workspaceId={activeWorkspaceId} />
    </div>
  )
}

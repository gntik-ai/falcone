// Console page: live realtime change stream (change: add-realtime-gateway-console).
// Distinct from ConsoleRealtimePage (snippets/metadata): this one opens a live SSE change
// stream via the executor and shows changes as they happen. Supplies the active workspace.
import { RealtimeConsole } from '@/components/console/RealtimeConsole'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleRealtimeChangesPage() {
  const { activeWorkspaceId } = useConsoleContext()

  if (!activeWorkspaceId) {
    return <p>Select a workspace to use realtime.</p>
  }

  return (
    <div>
      <h1>Realtime changes</h1>
      <p>Subscribe to a collection&apos;s tenant-scoped change stream with an anon key and watch changes live.</p>
      <RealtimeConsole workspaceId={activeWorkspaceId} />
    </div>
  )
}

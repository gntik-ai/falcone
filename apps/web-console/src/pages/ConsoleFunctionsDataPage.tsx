// Console page: Functions console (change: add-console-functions-data-editor).
// Supplies the active workspace to the FunctionsConsole (list/deploy/invoke).
import { FunctionsConsole } from '@/components/console/FunctionsConsole'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleFunctionsDataPage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()

  if (!activeTenantId) {
    return <p>Select a tenant to use functions.</p>
  }

  if (!activeWorkspaceId) {
    return <p>Select a workspace to use functions.</p>
  }

  return (
    <div>
      <h1>Functions</h1>
      <p>Deploy functions and invoke them against the workspace runtime.</p>
      <FunctionsConsole tenantId={activeTenantId} workspaceId={activeWorkspaceId} />
    </div>
  )
}

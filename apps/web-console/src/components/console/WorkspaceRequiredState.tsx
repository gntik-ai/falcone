// Shared "no active workspace" state (issue #742 — onboarding hub + actionable workspace empty
// states). Before this change every workspace-scoped page rendered its own static "Selecciona un
// área de trabajo" text with ZERO inline action (no picker, no create-workspace CTA) — a dead end
// for a signed-in user with no active workspace. This component is the ONE place that turns that
// static message into a real first action, reusing the console-context workspaces list +
// `selectWorkspace` setter (the same mechanism the header's context switcher already uses).
import { Link } from 'react-router-dom'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { type ConsoleWorkspaceOption, useConsoleContext } from '@/lib/console-context'
import { useConsolePermissions } from '@/lib/console-permissions'

export const WORKSPACE_REQUIRED_STATE_DEFAULT_TITLE = 'Selecciona un área de trabajo'

export interface WorkspaceRequiredStateProps {
  /** Page-specific sentence describing what the active workspace unlocks here (e.g. "Selecciona
   * un área de trabajo para ver los recursos Kafka."). Kept page-specific per #742 so the context
   * of what the page shows isn't lost behind a generic message. */
  description: string
  /** Override the shared default title when a page needs different framing. */
  title?: string
}

/**
 * Full-page "no active workspace" guard for workspace-scoped console pages. Honest about
 * loading/error (keeps the existing retry affordance) and otherwise renders an ADDED inline
 * action: a workspace picker when the active organization already has workspaces, or a
 * create-first-workspace CTA (degrading honestly to an explanation when the signed-in role can't
 * create one) when it has none.
 */
export function WorkspaceRequiredState({ description, title = WORKSPACE_REQUIRED_STATE_DEFAULT_TITLE }: WorkspaceRequiredStateProps) {
  const { workspaces, workspacesLoading, workspacesError, selectWorkspace, reloadWorkspaces } = useConsoleContext()
  const { can } = useConsolePermissions()

  if (workspacesLoading) {
    return (
      <ConsolePageState
        kind="loading"
        title="Cargando áreas de trabajo"
        description="Consultando las áreas de trabajo accesibles de la organización activa."
      />
    )
  }

  if (workspacesError) {
    return (
      <ConsolePageState
        kind="error"
        title="No se pudieron cargar las áreas de trabajo"
        description={workspacesError}
        actionLabel="Reintentar"
        onAction={() => void reloadWorkspaces()}
      />
    )
  }

  return (
    <ConsolePageState kind="empty" title={title} description={description}>
      <WorkspaceActivationAction
        workspaces={workspaces ?? []}
        canCreateWorkspace={can('tenant.workspaces.create')}
        onSelectWorkspace={selectWorkspace}
      />
    </ConsolePageState>
  )
}

/**
 * The actual inline action — extracted so `ConsoleContextStatusPanel` (the shell's always-visible
 * context card, shown above every workspace-scoped page including the Overview) can render the
 * SAME action instead of a second, drifting implementation (#742 scenario 1).
 */
export function WorkspaceActivationAction({
  workspaces,
  canCreateWorkspace,
  onSelectWorkspace
}: {
  workspaces: ConsoleWorkspaceOption[]
  canCreateWorkspace: boolean
  onSelectWorkspace: (workspaceId: string | null) => void
}) {
  if (workspaces.length === 0) {
    if (canCreateWorkspace) {
      return (
        <Button asChild>
          <Link to="/console/workspaces">Crear área de trabajo</Link>
        </Button>
      )
    }

    // Honest degrade: this role cannot create a workspace (only tenant_owner/tenant_admin/
    // workspace_owner/workspace_admin — and platform roles — can, per console-permissions.ts).
    // Linking to /console/workspaces would still be a dead end for them (that page renders no
    // content beyond the create wizard trigger), so explain who can instead of offering a broken CTA.
    return (
      <p className="text-sm leading-6 text-muted-foreground" data-testid="workspace-required-create-denied">
        Esta organización todavía no tiene áreas de trabajo. Pide a un propietario o administrador de la
        organización (o del área de trabajo) que cree la primera.
      </p>
    )
  }

  return (
    <label className="flex w-full max-w-sm flex-col gap-1.5 text-sm">
      <span className="font-medium text-foreground">Activar área de trabajo</span>
      <Select
        aria-label="Seleccionar área de trabajo"
        defaultValue=""
        onChange={(event) => {
          if (event.target.value) {
            onSelectWorkspace(event.target.value)
          }
        }}
      >
        <option value="" disabled>
          Selecciona un área de trabajo…
        </option>
        {workspaces.map((workspace) => (
          <option key={workspace.workspaceId} value={workspace.workspaceId}>
            {workspace.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

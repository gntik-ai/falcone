// Coarse, fail-safe gate for the Workspace Secrets console surface (change:
// add-console-secrets-management, #723).
//
// The console session principal carries NO per-workspace role, so this gate is intentionally COARSE
// (workspace membership OR a tenant-admin / platform role). It is defense-in-depth only — it decides
// whether to SHOW the nav entry / render the route, never whether a specific mutation is allowed.
// Per-secret mutate authority stays SERVER-enforced (the runtime `ownedWorkspace` gate + route
// audiences); the screen always defers to the server `403`/`404`.
//
// "Fail-safe" means: an operator who is neither a member of the active workspace nor a tenant-admin/
// platform-role operator is redirected away and does not see the entry.
import type { ConsoleShellSession } from '@/lib/console-session'

// Tenant-admin / platform roles that may operate across a tenant's workspaces.
const SECRETS_PRIVILEGED_ROLES = new Set([
  'superadmin',
  'platform_admin',
  'platform_operator',
  'platform_team',
  'tenant_owner',
  'tenant_admin'
])

export function hasWorkspaceSecretsPrivilegedRole(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => SECRETS_PRIVILEGED_ROLES.has(role))
}

// True when the operator may reach the Workspace Secrets screen for the active workspace: either the
// active workspace is in their membership list, or they hold a tenant-admin / platform role. When no
// workspace is active the gate still allows reaching the screen (it renders a "select a workspace"
// empty state); a non-member with no privileged role is denied.
export function canManageWorkspaceSecrets(
  session: ConsoleShellSession | null,
  activeWorkspaceId: string | null
): boolean {
  const principal = session?.principal
  if (!principal) {
    return false
  }
  if (hasWorkspaceSecretsPrivilegedRole(principal.platformRoles)) {
    return true
  }
  const workspaceIds = Array.isArray(principal.workspaceIds) ? principal.workspaceIds : []
  if (activeWorkspaceId) {
    return workspaceIds.includes(activeWorkspaceId)
  }
  // No active workspace yet: allow operators who are a member of at least one workspace to open the
  // screen (which will then prompt them to select a workspace).
  return workspaceIds.length > 0
}

// Single client-side permission source for tenant-tier roles (change: #761,
// add-console-permission-aware-tenant-roles).
//
// The console session principal already carries the effective role bag
// (`ConsoleSessionPrincipal.platformRoles` — @/lib/console-auth.ts) and the authoritative role
// intents live server-side in `services/internal-contracts/src/authorization-model.json`
// (`permission_matrix.tenant`). Before this change, permission logic was scattered and
// incomplete across the console: `useWizardPermissionCheck` (console-wizards.ts) only modeled
// `superadmin`/`platform_operator`/`tenant_owner`/`workspace_admin`; `ConsoleQuotasPage` hand-rolled
// an `isSuperadmin` check; nothing modeled `tenant_viewer`/`tenant_developer` at all. This module is
// the ONE place that mirrors the matrix at the granularity the UI needs, so every call site can
// delegate here instead of re-deriving its own role logic.
//
// This is a pure, client-side read with NO new backend call — and it stays defense-in-depth only:
// the server continues to enforce the real authorization decision (403). Hiding/disabling an
// affordance here shapes the experience so a role never has to "try and fail" to discover what it
// cannot do; it does not, by itself, secure anything.
import { readConsoleShellSession } from '@/lib/console-session'

// Actions the console UI actually renders affordances for. Kept deliberately coarse — mirroring
// every leaf action in authorization-model.json's `permission_matrix` would add drift risk for no
// UI value (the console never renders per-leaf-action controls); each `PermissionAction` below maps
// to one or more leaf actions in the model (see the comment above each entry in `ACTION_ALLOWED_ROLES`).
export type PermissionAction =
  | 'tenant.create'
  | 'tenant.workspaces.create'
  | 'tenant.members.manage'
  | 'iam.clients.manage'
  | 'workspace.write'
  | 'tenant.audit.read'

export type ConsoleRoleTone = 'read-only' | 'write-capable' | 'unknown'

interface RoleCatalogEntry {
  id: string
  label: string
  tone: ConsoleRoleTone
  // Shown by `denyReason()` when this is the principal's highest-ranked role and the requested
  // action is denied. `null` for roles that are write-capable in the common case (they still fall
  // back to a generic reason for the rarer narrowly-denied action, e.g. `iam.clients.manage`).
  reason: string | null
}

// Ordered by descending privilege — the first entry present in `platformRoles` wins for
// `highestRoleLabel`/`highestRoleTone`. Platform-tier roles are a superset bypass (see
// `PLATFORM_BYPASS_ROLES`): they can perform every `PermissionAction` this module knows about.
const ROLE_CATALOG: RoleCatalogEntry[] = [
  { id: 'superadmin', label: 'Superadmin', tone: 'write-capable', reason: null },
  { id: 'platform_admin', label: 'Admin de plataforma', tone: 'write-capable', reason: null },
  { id: 'platform_operator', label: 'Operador de plataforma', tone: 'write-capable', reason: null },
  { id: 'platform_team', label: 'Equipo de plataforma', tone: 'write-capable', reason: null },
  { id: 'tenant_owner', label: 'Propietario', tone: 'write-capable', reason: null },
  { id: 'tenant_admin', label: 'Administrador', tone: 'write-capable', reason: null },
  { id: 'workspace_owner', label: 'Propietario de área de trabajo', tone: 'write-capable', reason: null },
  { id: 'workspace_admin', label: 'Administrador de área de trabajo', tone: 'write-capable', reason: null },
  {
    id: 'tenant_developer',
    label: 'Developer · solo lectura',
    tone: 'read-only',
    reason:
      'Tu rol (Developer · solo lectura) permite consultar el contexto de la organización y del área de trabajo, pero no crear, modificar ni eliminar recursos. Contacta con un administrador de la organización si necesitas este acceso.'
  },
  {
    id: 'tenant_viewer',
    label: 'Viewer · solo lectura',
    tone: 'read-only',
    reason:
      'Tu rol (Viewer · solo lectura) permite consultar dashboards, auditoría y permisos efectivos, pero no crear, modificar ni eliminar recursos. Contacta con un administrador de la organización si necesitas este acceso.'
  }
]

const ROLE_CATALOG_BY_ID = new Map(ROLE_CATALOG.map((entry) => [entry.id, entry]))

// Platform-tier roles bypass every `PermissionAction` below — they already have unrestricted
// console-level nav access (console-principal.ts::hasPlatformInventoryAccess,
// workspace-secrets-access.ts::SECRETS_PRIVILEGED_ROLES) so gating them narrower here would just be
// a second, drifting source of truth.
const PLATFORM_BYPASS_ROLES = new Set(['superadmin', 'platform_admin', 'platform_operator', 'platform_team'])

// Tenant/workspace-tier roles that are write-capable at the console's coarse granularity. A
// principal with none of these (and none of `PLATFORM_BYPASS_ROLES`) is treated as read-only —
// this INCLUDES an empty or unrecognized role list (fail-closed for writes), matching the fail-safe
// idiom already established by `workspace-secrets-access.ts` and `structural-write-access.ts`.
export const WORKSPACE_WRITE_CAPABLE_ROLES = new Set([
  ...PLATFORM_BYPASS_ROLES,
  'tenant_owner',
  'tenant_admin',
  'workspace_owner',
  'workspace_admin'
])

// Per-action allow-lists beyond the platform bypass. Each maps to leaf actions in
// authorization-model.json's `permission_matrix.tenant`:
const ACTION_ALLOWED_ROLES: Record<PermissionAction, Set<string>> = {
  // No tenant-tier role can create a NEW tenant (that is a platform-tier action, absent from
  // `permission_matrix.tenant` entirely) — only the platform bypass applies.
  'tenant.create': new Set(),
  // `tenant.workspaces.create` — allowed for tenant_owner/tenant_admin in the model; workspace_owner/
  // workspace_admin included for parity with the coarse workspace-tier gates used elsewhere.
  'tenant.workspaces.create': new Set(['tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin']),
  // `tenant.members.manage` — allowed for tenant_owner/tenant_admin in the model.
  'tenant.members.manage': new Set(['tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin']),
  // IAM client management (Auth surface) — narrower than the other tenant-tier actions: the route
  // itself is superadmin-gated (RequireSuperadminRoute in router.tsx), so this mirrors the ORIGINAL
  // `useWizardPermissionCheck('manage_iam')` behavior (workspace_admin only; tenant_owner excluded).
  'iam.clients.manage': new Set(['workspace_owner', 'workspace_admin']),
  // Workspace runtime writes — `database.write/admin`, `bucket.write/admin`, `topic.publish`,
  // `function.deploy/invoke`, `service_account.rotate/credentials.issue/revoke`, and (until flows
  // gain a dedicated leaf action — see companion bug #760) flow drafting: ALL denied for
  // tenant_viewer/tenant_developer in the model, allowed for tenant_owner/tenant_admin at the
  // console's coarse, defense-in-depth granularity (the session carries no per-workspace role).
  'workspace.write': new Set(['tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin']),
  // `tenant.audit.read` — allowed for tenant_viewer, DENIED for tenant_developer in the model. This
  // is the one action where the viewer has strictly MORE read access than the developer.
  'tenant.audit.read': new Set(['tenant_owner', 'tenant_admin', 'tenant_viewer', 'workspace_owner', 'workspace_admin'])
}

const FAIL_CLOSED_REASON =
  'Tu sesión actual no tiene un rol con permisos de escritura reconocido. Contacta con un administrador de la organización si crees que esto es un error.'

const GENERIC_DENY_REASON =
  'Tu rol actual no incluye este permiso. Contacta con un administrador de la organización o del área de trabajo si necesitas este acceso.'

export interface ConsolePermissions {
  /** Raw `platformRoles` bag the decision was computed from. */
  roles: string[]
  /** True when the principal holds no write-capable tenant/workspace/platform role (fail-closed for
   *  an empty or unrecognized role list — never true for tenant_owner/tenant_admin/platform roles). */
  isReadOnly: boolean
  /** Humanized label for the principal's highest-ranked known role (e.g. "Viewer · solo lectura"). */
  highestRoleLabel: string
  /** Visual tone for the role badge/chip. */
  highestRoleTone: ConsoleRoleTone
  /** True when `action` is permitted for the principal's roles. */
  can(action: PermissionAction): boolean
  /** Role-aware, localized explanation for why `action` is denied — `null` when it is allowed. */
  denyReason(action: PermissionAction): string | null
}

function resolveHighestRole(roles: readonly string[]): RoleCatalogEntry | null {
  for (const entry of ROLE_CATALOG) {
    if (roles.includes(entry.id)) {
      return entry
    }
  }
  return null
}

function isActionAllowed(roles: readonly string[], action: PermissionAction): boolean {
  if (roles.some((role) => PLATFORM_BYPASS_ROLES.has(role))) {
    return true
  }
  const allowedRoles = ACTION_ALLOWED_ROLES[action]
  return roles.some((role) => allowedRoles.has(role))
}

/**
 * Pure computation of the effective console permissions for a `platformRoles` bag. Exported
 * separately from `useConsolePermissions()` so non-hook call sites (and tests) can compute the same
 * decision without depending on the console session singleton.
 */
export function getConsolePermissions(roles: readonly string[] | null | undefined): ConsolePermissions {
  const roleList = Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string' && role.length > 0) : []
  const isReadOnly = !roleList.some((role) => WORKSPACE_WRITE_CAPABLE_ROLES.has(role))
  const highestRole = resolveHighestRole(roleList)

  const highestRoleLabel = highestRole?.label ?? (roleList.length === 0 ? 'Sin rol asignado' : 'Rol sin permisos de escritura reconocidos')
  const highestRoleTone: ConsoleRoleTone = highestRole?.tone ?? (roleList.length === 0 ? 'unknown' : 'read-only')

  function can(action: PermissionAction): boolean {
    return isActionAllowed(roleList, action)
  }

  function denyReason(action: PermissionAction): string | null {
    if (can(action)) {
      return null
    }
    if (highestRole?.reason) {
      return highestRole.reason
    }
    if (roleList.length === 0 || !highestRole) {
      return FAIL_CLOSED_REASON
    }
    return GENERIC_DENY_REASON
  }

  return { roles: roleList, isReadOnly, highestRoleLabel, highestRoleTone, can, denyReason }
}

/**
 * Console-wide permission hook. Reads the persisted shell session once per call (the console
 * session is not a reactive store — this mirrors the existing convention in
 * `useWizardPermissionCheck`/`ConsoleQuotasPage`). No new backend request.
 */
export function useConsolePermissions(): ConsolePermissions {
  const session = readConsoleShellSession()
  return getConsolePermissions(session?.principal?.platformRoles)
}

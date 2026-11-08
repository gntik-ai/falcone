import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../shell/permissions'

// The shared permissions module returns Spanish role labels and deny reasons. The page shows its own
// localized copy instead and keeps only the decision (can) from the shared module.
const ROLE_ORDER = ['superadmin', 'platform_admin', 'platform_operator', 'platform_team', 'tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin', 'tenant_developer', 'tenant_viewer'] as const
const READ_ONLY_REASONS = new Set(['tenant_developer', 'tenant_viewer'])

export function useRoleCopy() {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const permissions = usePermissions()
  const highest = ROLE_ORDER.find((role) => permissions.roles.includes(role))
  const roleLabel = highest ? t(`roles.${highest}`) : t(permissions.roles.length === 0 ? 'roles.none' : 'roles.unrecognized')
  const denyReason = (): string | null => {
    if (permissions.can('workspace.write')) return null
    if (highest && READ_ONLY_REASONS.has(highest)) return t(`denyReasons.${highest}`)
    return t(!highest ? 'denyReasons.failClosed' : 'denyReasons.generic')
  }
  return { roleLabel, denyReason }
}

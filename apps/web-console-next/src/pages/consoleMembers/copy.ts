import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-members-page.json'
import en from '../../locales/en/pages.console-members-page.json'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'

i18n.addResourceBundle('es', 'pages.console-members-page', es)
i18n.addResourceBundle('en', 'pages.console-members-page', en)
export const useCopy = () => useTranslation('pages.console-members-page')
const roleOrder = ['superadmin', 'platform_admin', 'platform_operator', 'platform_team', 'tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin', 'tenant_developer', 'tenant_viewer']
export function roleKey(roles: string[]) { return roleOrder.find((role) => roles.includes(role)) ?? (roles.length ? 'unknown' : 'none') }
export function reasonKey(roles: string[]) {
  const permissions = getConsolePermissions(roles)
  const highest = roleKey(roles)
  return highest === 'tenant_viewer' || highest === 'tenant_developer' ? `reasons.${highest}` : permissions.denyReason('tenant.members.manage') && ['none', 'unknown'].includes(highest) ? 'reasons.unknown' : 'reasons.generic'
}
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

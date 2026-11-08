import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-workspaces-page.json'
import en from '../../locales/en/pages.console-workspaces-page.json'

i18n.addResourceBundle('es', 'pages.console-workspaces-page', es)
i18n.addResourceBundle('en', 'pages.console-workspaces-page', en)
export const useCopy = () => useTranslation('pages.console-workspaces-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const roleOrder = ['superadmin', 'platform_admin', 'platform_operator', 'platform_team', 'tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin', 'tenant_developer', 'tenant_viewer']
export const roleKey = (roles: string[]) => roleOrder.find((role) => roles.includes(role)) ?? (roles.length ? 'unknown' : 'none')
export const reasonKey = (roles: string[]) => ['tenant_viewer', 'tenant_developer'].includes(roleKey(roles)) ? `reasons.${roleKey(roles)}` : ['none', 'unknown'].includes(roleKey(roles)) ? 'reasons.unknown' : 'reasons.generic'

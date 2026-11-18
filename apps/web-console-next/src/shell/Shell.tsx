import { Suspense, useEffect, type ComponentPropsWithRef } from 'react'
import { ConsoleShell } from '@gntik-ai/templates'
import { Breadcrumbs, LinkProvider, ThemeCycleButton, useSidebarLayout, useThemeOptions, type NavGroup } from '@gntik-ai/ui'
import { Link, Outlet, useLocation, matchRoutes, type RouteObject } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { canManageWorkspaceSecrets } from '@in-falcone/console-api/workspace-secrets-access'
import { PermissionsProvider, usePermissions } from './permissions'
import { ShellErrorBoundary } from './RouteState'
import { StatusPage } from '../StatusPage'
import { ConsoleContextProvider, useConsoleContext } from './context'
import { pendingConsoleRoutes } from './routes'
import { useSession } from './session'
import { useAccountMenu } from './AccountMenu'
import { LocaleMenu } from '../i18n/LocaleMenu'
import { isMigratedRoute, navigation, navigationGroups } from './navigation'
import { buildBreadcrumbs } from './breadcrumbs'

// Unmigrated pages deliberately hand off to the legacy SPA in the same tab.
// Their root-relative href must not inherit /next/ from the new router basename.
function LegacyLink(props: ComponentPropsWithRef<'a'>) { return <a {...props} /> }

function ShellLink({ href, children, ...props }: ComponentPropsWithRef<'a'>) {
  return href && isMigratedRoute(href)
    ? <Link to={href} {...props}><>{children}</></Link>
    : <LegacyLink href={href} {...props}>{children}</LegacyLink>
}

function ContentLink(props: ComponentPropsWithRef<'a'>) {
  // Preserve existing workspace inventory handoffs in page content and breadcrumbs.
  // The sidebar separately opts into the migrated workspace creation page.
  return props.href === '/console/workspaces' ? <LegacyLink {...props} /> : <ShellLink {...props} />
}

const shellRoutes: RouteObject[] = [{ path: '/console', children: pendingConsoleRoutes }]

export function Shell() {
  const location = useLocation()
  const matches = matchRoutes(shellRoutes, location) ?? []
  const routeWorkspaceId = matches.at(-1)?.params.workspaceId
  const platformGlobal = matches.some((match) => match.route.handle?.platformGlobal)
  return <ConsoleContextProvider routeWorkspaceId={routeWorkspaceId}><PermissionsProvider><ShellContent platformGlobal={platformGlobal} /></PermissionsProvider></ConsoleContextProvider>
}

function ShellContent({ platformGlobal }: { platformGlobal: boolean }) {
  const { t } = useTranslation('common')
  const { pathname, state, key } = useLocation()
  useEffect(() => {
    if (state?.focusMainHeading !== true) return
    // The destination may be lazy. Observe only this explicitly requested navigation.
    const focusHeading = () => {
      const heading = document.querySelector<HTMLElement>('main h1')
      if (!heading || heading.closest('[aria-busy="true"], [hidden], [inert], [style*="display: none"]')) return false
      heading.tabIndex = -1
      heading.focus()
      return true
    }
    if (focusHeading()) return
    const observer = new MutationObserver(() => { if (focusHeading()) observer.disconnect() })
    observer.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'style', 'aria-busy'] })
    return () => observer.disconnect()
  }, [pathname, state, key])
  const session = useSession()
  const context = useConsoleContext()
  const permissions = usePermissions()
  const roles = session?.principal?.platformRoles ?? []
  const visible = navigation.filter((item) =>
    (!('requiresSuperadminAccess' in item) || roles.includes('superadmin')) &&
    (!('requiresPlatformInventoryAccess' in item) || roles.some((role) => ['superadmin', 'platform_admin', 'platform_operator'].includes(role))) &&
    (!('requiresWorkspaceSecretsAccess' in item) || canManageWorkspaceSecrets(session, context.activeWorkspaceId)))
  const groups: NavGroup[] = navigationGroups.map((group) => ({
    label: t(`shell.groups.${group}`),
    items: visible.filter((item) => {
      const resolved = permissions.isReadOnly && 'restrictedForAction' in item && !permissions.can(item.restrictedForAction) ? 'restricted' : item.group
      return resolved === group
    }).map((item) => ({ label: t(`navigation.${item.key}`), href: item.path, icon: (props: { size?: number; 'aria-hidden'?: boolean; className?: string }) => <item.icon {...props} />, current: pathname === item.path || (!('exactActive' in item) && pathname.startsWith(item.path + '/')) }))
  })).filter((group) => group.items.length)
  const breadcrumbs = buildBreadcrumbs(pathname, t)
  const account = useAccountMenu()
  return <LinkProvider component={ShellLink}>
    {/* storageKey is omitted on purpose: no persisted collapsed state, so screenshots do not depend on it. */}
    <ConsoleShell sidebarLabel={t('shell.navigation')} navLabel={t('shell.navigation')} nav={groups} currentHref={pathname} breadcrumbs={null}
      tenants={context.tenants.map((tenant) => ({ id: tenant.tenantId, name: tenant.displayName }))} currentTenantId={context.activeTenantId}
      onTenantSelect={context.selectTenant} tenantLabel={t('shell.tenant')} tenantPlaceholder={t('shell.selectTenant')} tenantEmptyText={t('shell.noTenants')}
      workspaces={context.workspaces.map((workspace) => ({ id: workspace.workspaceId, name: workspace.displayName }))} currentWorkspaceId={context.activeWorkspaceId ?? ''}
      onWorkspaceChange={(workspace) => context.selectWorkspace(workspace.id)} workspaceLabel={t('shell.workspace')} workspaceEmptyText={t('shell.selectWorkspace')}
      hideWorkspaceContext={platformGlobal} contextRegionLabel={t('shell.context')} contextBusy={context.loading} contextStatus={<ContextStatus />}
      user={account.user} userMenuItems={account.userMenuItems} userMenuShowTheme={false} userMenuChildren={<LocaleMenu />} onSignOut={account.onSignOut}
      usage={null} helpHref={null}
      topbar={{ breadcrumb: <LinkProvider component={ContentLink}><Breadcrumbs items={breadcrumbs} /></LinkProvider>, environment: null, search: <ThemeToggle />, notifications: null, theme: null, user: null }}>
      <CloseDrawerOnNavigate />
      {/* The kit's <main> scrolls but is not a tab stop (tabindex=-1). The context controls used to sit inside it; now that they live
          in the sidebar, this wrapper keeps one keyboard stop inside the scroll region (WCAG 2.1.1, axe scrollable-region-focusable). */}
      <div tabIndex={0} className="p-4 sm:p-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring">
        <ShellErrorBoundary key={pathname}><Suspense fallback={<StatusPage state="loading" />}><LinkProvider component={ContentLink}><Outlet /></LinkProvider></Suspense></ShellErrorBoundary>
      </div>
    </ConsoleShell>
    {account.aboutDialog}
  </LinkProvider>
}

// TODO(gntik-ui#855): remove with the kit release that passes onNavigate to ConsoleShell's AppSidebarNav.
// Until then the mobile drawer would stay open after a nav click, so close it on every navigation.
function CloseDrawerOnNavigate() {
  const { key } = useLocation()
  const { setDrawerOpen } = useSidebarLayout()
  useEffect(() => { setDrawerOpen(false) }, [key])
  return null
}

// The kit's built-in topbar `theme: 'cycle'` walks four modes (dark, high contrast, system, light). Falcone offers light and dark only,
// so the public ThemeCycleButton is limited to those two. The topbar's `search` slot is the only public slot on the right of the bar
// (search itself is deferred), so the control is rendered there, in the same spot the built-in control occupies.
function ThemeToggle() {
  const options = useThemeOptions().filter((option) => option.value === 'light' || option.value === 'dark')
  return <ThemeCycleButton options={options} />
}

function ContextStatus() {
  const { t } = useTranslation('common')
  const context = useConsoleContext()
  const permissions = usePermissions()
  return <>
    {permissions.isReadOnly && <span>{t('shell.readOnly')}</span>}
    {context.error && <p role="status">{context.error.status === 403 ? t('states.forbidden.body') : t('states.network.body')}</p>}
  </>
}

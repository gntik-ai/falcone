import { LayoutDashboard } from 'lucide-react'
import { Suspense, useState, useEffect, type ComponentPropsWithRef } from 'react'
import { AppSidebar, AppTopbar } from '@gntik-ai/blocks'
import { SidebarLayout, Breadcrumbs, WorkspaceSwitcher, LinkProvider, MobileNav, type NavGroup } from '@gntik-ai/ui'
import { Outlet, useLocation, matchRoutes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { canManageWorkspaceSecrets } from '@in-falcone/console-api/workspace-secrets-access'
import { PermissionsProvider, usePermissions } from './permissions'
import { ShellErrorBoundary } from './RouteState'
import { StatusPage } from '../StatusPage'
import { ConsoleContextProvider, useConsoleContext } from './context'
import { appRoutes } from '../router'
import { useSession } from './session'
import { AccountMenu } from './AccountMenu'
import { navigation, navigationGroups } from './navigation'
import { buildBreadcrumbs } from './breadcrumbs'

// Unmigrated pages deliberately hand off to the legacy SPA in the same tab.
// Their root-relative href must not inherit /next/ from the new router basename.
function LegacyLink(props: ComponentPropsWithRef<'a'>) { return <a {...props} /> }

export function Shell() {
  const location = useLocation()
  const matches = matchRoutes(appRoutes, location) ?? []
  const routeWorkspaceId = matches.at(-1)?.params.workspaceId
  const platformGlobal = matches.some((match) => match.route.handle?.platformGlobal)
  return <ConsoleContextProvider routeWorkspaceId={routeWorkspaceId}><PermissionsProvider><ShellContent platformGlobal={platformGlobal} /></PermissionsProvider></ConsoleContextProvider>
}

function ShellContent({ platformGlobal }: { platformGlobal: boolean }) {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => setDrawerOpen(false), [pathname])
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
  return <LinkProvider component={LegacyLink}>
    <SidebarLayout fullScreen className="console-shell" drawerOpen={false} sidebarLabel={t('shell.navigation')}
      sidebar={({ collapsed, closeDrawer }) => <>
        <AppSidebar collapsed={collapsed} workspaces={[]} user={null} usage={null} helpHref="" navLabel={t('shell.navigation')}
          currentHref={pathname} navGroups={groups} onNavigate={closeDrawer} />
      </>}
      topbar={<><MobileNav className="lg:hidden" groups={groups} currentHref={pathname} label={t('shell.navigation')}
        open={drawerOpen} onOpenChange={setDrawerOpen} footer={!platformGlobal && <ContextPanel />} /><LayoutDashboard role="img" aria-label={t('shell.console')} className="shrink-0" size={20} /><AppTopbar breadcrumb={<Breadcrumbs items={breadcrumbs} />} environment={null} search={<AccountMenu />} notifications={null} theme={null} user={null} /></>}>
      {!platformGlobal && <ContextPanel />}
      <div className="p-4 sm:p-6">
        <ShellErrorBoundary key={pathname}><Suspense fallback={<StatusPage state="loading" />}><Outlet /></Suspense></ShellErrorBoundary>
      </div>
    </SidebarLayout>
  </LinkProvider>
}

function ContextPanel() {
  const { t } = useTranslation('common')
  const context = useConsoleContext()
  const permissions = usePermissions()
  return <section className="flex flex-wrap items-center gap-3 border-b border-border p-4" aria-label={t('shell.context')} aria-busy={context.loading}>
    <label>{t('shell.tenant')}<select value={context.activeTenantId ?? ''} onChange={(event) => context.selectTenant(event.target.value || null)}>
      <option value="">{t('shell.selectTenant')}</option>
      {context.tenants.map((tenant) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.displayName}</option>)}
    </select></label>
    <WorkspaceSwitcher workspaces={context.workspaces.map((workspace) => ({ id: workspace.workspaceId, name: workspace.displayName }))}
      currentId={context.activeWorkspaceId ?? ''} onSelect={(workspace) => context.selectWorkspace(workspace.id)} label={t('shell.workspace')}
      emptyText={t('shell.selectWorkspace')} />
    {permissions.isReadOnly && <span>{t('shell.readOnly')}</span>}
    {context.error && <p role="status">{t('states.network.body')}</p>}
  </section>
}

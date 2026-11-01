import { Suspense } from 'react'
import { AppSidebar, AppTopbar } from '@gntik-ai/blocks'
import { SidebarLayout, LinkProvider, type NavGroup } from '@gntik-ai/ui'
import { LayoutDashboard } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { StatusPage } from '../StatusPage'
import i18n from '../i18n'
import es from '../locales/es/admin.json'
import en from '../locales/en/admin.json'
import { AccountMenu } from './AccountMenu'
import { RouteState, ShellErrorBoundary } from './RouteState'
import { useSession } from './session'

i18n.addResourceBundle('es', 'admin', es)
i18n.addResourceBundle('en', 'admin', en)

const noGroups: NavGroup[] = []

// Admin links stay inside the router; this shell has no legacy hand-off links.
function AdminLink({ href, children, ...props }: React.ComponentPropsWithRef<'a'>) {
  return <Link to={href ?? ''} {...props}><>{children}</></Link>
}

// The check reads only the session, so no console context provider is mounted here.
export default function AdminLayout() {
  const { t } = useTranslation('admin')
  const { t: tc } = useTranslation('common')
  const session = useSession()
  const { pathname } = useLocation()
  const allowed = (session?.principal?.platformRoles ?? []).includes('superadmin')
  if (!allowed) return <RouteState state="forbidden" primaryAction={{ label: t('backToConsole'), to: '/console' }} />
  return <LinkProvider component={AdminLink}>
    <SidebarLayout fullScreen className="console-shell" drawerOpen={false} sidebarLabel={t('title')}
      sidebar={({ collapsed, closeDrawer }) => <AppSidebar collapsed={collapsed} workspaces={[]} user={null} usage={null} helpHref=""
        navLabel={t('title')} currentHref={pathname} navGroups={noGroups} onNavigate={closeDrawer} />}
      topbar={<><LayoutDashboard role="img" aria-label={tc('shell.console')} className="shrink-0" size={20} /><span className="shrink-0 font-semibold">{t('title')}</span><AppTopbar breadcrumb={null} environment={null} search={null} notifications={null} theme={null} user={null} /><AccountMenu mode="admin" /></>}>
      <div className="p-4 sm:p-6">
        <ShellErrorBoundary key={pathname}><Suspense fallback={<StatusPage state="loading" />}><Outlet /></Suspense></ShellErrorBoundary>
      </div>
    </SidebarLayout>
  </LinkProvider>
}

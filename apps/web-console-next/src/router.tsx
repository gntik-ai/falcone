import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Outlet, type RouteObject, useLocation, useRoutes } from 'react-router-dom'
import { StatusPage } from './StatusPage'
import { ProtectedRoute } from './shell/session'
import { Shell } from './shell/Shell'
import { Guard, ConsoleIndexRedirect } from './shell/guards'
import { PageSkeleton } from '@gntik-ai/blocks'
import { AuthLayout, Logo, StatusLayout } from '@gntik-ai/ui'
import { useTranslation } from 'react-i18next'
import { RouteState, ShellErrorBoundary } from './shell/RouteState'
import { SignupFeedbackLayout } from './pages/signupFeedback'
import { pendingConsoleRoutes } from './shell/routes'
import { isMigratedRoute } from './shell/navigation'
import { SecretsGuard } from './pages/consoleWorkspaceSecrets/guard'

declare const __SHELL_TEST_FIXTURES__: boolean
const AdminLayout = lazy(() => import('./shell/AdminLayout'))
const FixtureRoutes = __SHELL_TEST_FIXTURES__ ? lazy(() => import('./shell/fixtures/FixtureRoutes')) : null

export function routerBasename(base = import.meta.env.VITE_BASE_PATH || '/'): string {
  return base.replace(/\/+$/, '') || '/'
}

export function ConsoleRoutes() {
  const routes = useRoutes(appRoutes)
  return <Suspense fallback={<StatusPage state="loading" />}>{routes}</Suspense>
}

function WelcomeLoading() {
  const { t } = useTranslation('common')
  return <main className="mx-auto w-full max-w-5xl p-7 sm:p-10"><PageSkeleton stats={0} rows={2} label={t('states.loading.title')} className="" /></main>
}

function LoginLoading() {
  const { t } = useTranslation('common')
  return <AuthLayout variant="card" mainId="login-loading" fullScreen={false}
    logo={<Logo size={28} wordmark={true} aria-label={t('shell.console')} />} brand={null} brandFooter={null}
    brandLabel={t('shell.console')} footer={null} skipLinkLabel={t('states.loading.title')} className="min-w-0">
    <PageSkeleton stats={0} rows={2} label={t('states.loading.title')} className="" />
  </AuthLayout>
}

function NotFoundLoading() {
  const { t } = useTranslation('common')
  return <StatusLayout mainId="not-found-loading" tone="neutral" fullScreen={false} className="min-w-0"
    heading={<PageSkeleton stats={0} rows={2} label={t('states.loading.title')} className="" />}
    code={null} titleRef={undefined} description={null} icon={undefined} illustration={null}
    primaryAction={null} secondaryAction={null} header={null} footer={null} children={null}
    skipLinkLabel={t('states.loading.title')} />
}

// Namespace names are explicit so check:i18n validates the route/resource contract.
function lazyPage(_namespace: string, load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load)
  return <Page />
}

const postgresRollbackPage = lazyPage('pendingPage', () => import('./pages/pendingPage'))

// A cached route element must still honor the active route's migration kill switch.
function PostgresMigrationBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return isMigratedRoute(pathname) ? children : postgresRollbackPage
}

export const appRoutes: RouteObject[] = [
  {
    element: <Outlet />,
    children: [
      { path: '/', handle: { ownLayout: true }, element: <ShellErrorBoundary><Suspense fallback={<WelcomeLoading />}>{lazyPage('pages.welcome-page', () => import('./pages/welcome'))}</Suspense></ShellErrorBoundary> },
      { path: '/login', handle: { ownLayout: true }, element: <ShellErrorBoundary><Suspense fallback={<LoginLoading />}>{lazyPage('pages.login-page', () => import('./pages/login'))}</Suspense></ShellErrorBoundary> },
      { path: '/password-recovery', handle: { ownLayout: true }, element: <ShellErrorBoundary><Suspense fallback={<LoginLoading />}>{lazyPage('pages.password-recovery-page', () => import('./pages/recovery'))}</Suspense></ShellErrorBoundary> },
      { path: '/invitations/:tenantId/:invitationId', element: lazyPage('invitation', () => import('./pages/invitation')) },
      { element: <SignupFeedbackLayout />, children: [
        { path: '/signup', handle: { ownLayout: true }, element: <ShellErrorBoundary><Suspense fallback={<WelcomeLoading />}>{lazyPage('pages.signup-page', () => import('./pages/signup'))}</Suspense></ShellErrorBoundary> },
        { path: '/signup/pending-activation', handle: { ownLayout: true }, element: <ShellErrorBoundary><Suspense fallback={<WelcomeLoading />}>{lazyPage('pages.pending-activation-page', () => import('./pages/pendingActivation'))}</Suspense></ShellErrorBoundary> },
      ] },
      { path: '*', handle: { ownLayout: true }, element: <ShellErrorBoundary><Suspense fallback={<NotFoundLoading />}>{lazyPage('pages.not-found-page', () => import('./pages/notFound'))}</Suspense></ShellErrorBoundary> }
    ]
  },
  {
    path: '/admin',
    element: <ProtectedRoute><AdminLayout /></ProtectedRoute>,
    children: [
      { index: true, element: lazyPage('admin', () => import('./pages/admin')) }
    ]
  },
  {
    path: '/console',
    element: <ProtectedRoute><Shell /></ProtectedRoute>,
    children: [
      { index: true, element: <ConsoleIndexRedirect /> },
      { path: 'operations/:operationId', element: lazyPage('operationDetail', () => import('./pages/operationDetail')) },
      ...pendingConsoleRoutes.map(({ guard, ...route }) => {
        if (route.path === 'postgres' && route.migrated) return { ...route, element: <PostgresMigrationBoundary>{lazyPage('pages.console-postgres-page', () => import('./pages/consolePostgres'))}</PostgresMigrationBoundary> }
        if (route.path === 'operations') return { ...route, element: lazyPage('pages.console-operations-page', () => import('./pages/consoleOperations')) }
        if (route.path === 'tenants') return { ...route, element: lazyPage('pages.console-tenants-page', () => import('./pages/consoleTenants')) }
        if (route.path === 'overview') return { ...route, element: lazyPage('pages.console-overview-page', () => import('./pages/overview')) }
        if (route.path === 'plans') return { ...route, element: <Guard kind="superadmin">{lazyPage('pages.console-plan-catalog-page', () => import('./pages/consolePlanCatalog'))}</Guard> }
        if (route.path === 'tenants/:tenantId/plan' && route.migrated) return { ...route, element: <Guard kind="superadmin">{lazyPage('pages.console-tenant-plan-page', () => import('./pages/consoleTenantPlan'))}</Guard> }
        if (route.path === 'plans/:planId' && route.migrated) return { ...route, element: <Guard kind="superadmin">{lazyPage('pages.console-plan-detail-page', () => import('./pages/consolePlanDetail'))}</Guard> }
        if (route.path === 'iam-access' && route.migrated) return { ...route, element: <Guard kind="superadmin">{lazyPage('pages.console-iam-access-page', () => import('./pages/consoleIamAccess'))}</Guard> }
        if (route.path === 'auth' && route.migrated) return { ...route, element: <Guard kind="superadmin">{lazyPage('pages.console-auth-page', () => import('./pages/consoleAuth'))}</Guard> }
        if (route.path === 'plans/new') return { ...route, element: lazyPage('pages.console-plan-create-page', () => import('./pages/consolePlanCreate')) }
        if (route.path === 'database' && route.migrated) return { ...route, element: lazyPage('pages.console-workspace-database-page', () => import('./pages/consoleWorkspaceDatabase')) }
        if (route.path === 'quotas') return { ...route, element: lazyPage('pages.console-quotas-page', () => import('./pages/consoleQuotas')) }
        if (route.path === 'workspaces/:workspaceId/realtime' && route.migrated) return { ...route, element: lazyPage('pages.console-realtime-page', () => import('./pages/consoleRealtime')) }
        if (route.path === 'observability' && route.migrated) return { ...route, element: lazyPage('pages.console-observability-page', () => import('./pages/consoleObservability')) }
        if (route.path === 'runtime') return { ...route, element: lazyPage('pages.console-runtime-page', () => import('./pages/consoleRuntime')) }
        if (route.path === 'my-plan' && route.migrated) return { ...route, element: lazyPage('pages.console-tenant-plan-overview-page', () => import('./pages/consoleTenantPlanOverview')) }
        if (route.path === 'my-plan/allocation') return { ...route, element: lazyPage('pages.console-tenant-allocation-summary-page', () => import('./pages/consoleTenantAllocationSummary')) }
        if (route.path === 'profile') return { ...route, element: lazyPage('pages.console-profile-page', () => import('./pages/consoleProfile')) }
        if (route.path === 'workspaces/:workspaceId/docs') return { ...route, element: lazyPage('pages.console-docs-page', () => import('./pages/consoleDocs')) }
        if (route.path === 'workspaces/:workspaceId' && route.migrated) return { ...route, element: lazyPage('pages.console-workspace-dashboard-page', () => import('./pages/consoleWorkspaceDashboard')) }
        if (route.path === 'mcp/servers' && route.migrated) return { ...route, element: lazyPage('pages.console-mcp-servers-page', () => import('./pages/consoleMcpServers')) }
        if (route.path === 'mcp/servers/:mcpServerId' && route.migrated) return { ...route, element: lazyPage('pages.console-mcp-server-detail-page', () => import('./pages/consoleMcpServerDetail')) }
        if (route.path === 'functions-registry' && route.migrated) return { ...route, element: lazyPage('pages.console-function-registry-page', () => import('./pages/consoleFunctionRegistry')) }
        if (route.path === 'functions/data' && route.migrated) return { ...route, element: lazyPage('pages.console-functions-data-page', () => import('./pages/consoleFunctionsData')) }
        if (route.path === 'workspaces' && route.migrated) return { ...route, element: lazyPage('pages.console-workspaces-page', () => import('./pages/consoleWorkspaces')) }
        if (route.path === 'members' && route.migrated) return { ...route, element: lazyPage('pages.console-members-page', () => import('./pages/consoleMembers')) }
        if (route.path === 'service-accounts' && route.migrated) return { ...route, element: lazyPage('pages.console-service-accounts-page', () => import('./pages/consoleServiceAccounts')) }
        if (route.path === 'secrets/:encodedSecretPath/rotate') return { ...route, element: lazyPage('pages.console-secret-rotation-page', () => import('./pages/consoleSecretRotation')) }
        if (route.path === 'secrets' && route.migrated) return { ...route, element: lazyPage('pages.console-secrets-page', () => import('./pages/consoleSecrets')) }
        if (route.path === 'storage' && route.migrated) return { ...route, element: lazyPage('pages.console-storage-page', () => import('./pages/consoleStorage')) }
        if (route.path === 'workspace-secrets' && route.migrated) return { ...route, element: <SecretsGuard>{lazyPage('pages.console-workspace-secrets-page', () => import('./pages/consoleWorkspaceSecrets'))}</SecretsGuard> }
        if (route.path === 'auth-config' && route.migrated) return { ...route, element: lazyPage('pages.console-auth-config-page', () => import('./pages/consoleAuthConfig')) }
        if (route.path === 'realtime/changes' && route.migrated) return { ...route, element: lazyPage('pages.console-realtime-changes-page', () => import('./pages/consoleRealtimeChanges')) }
        if (route.path === 'flows' && route.migrated) return { ...route, element: lazyPage('pages.console-flows-page', () => import('./pages/consoleFlows')) }
        if (route.path === 'flows/:flowId' && route.migrated) return { ...route, element: lazyPage('pages.console-flow-designer-page', () => import('./pages/consoleFlowDesigner')) }
        if (route.path === 'flows/:flowId/runs' && route.migrated) return { ...route, element: lazyPage('pages.console-flow-history-page', () => import('./pages/consoleFlowHistory')) }
        const page = lazyPage('pendingPage', () => import('./pages/pendingPage'))
        return { ...route, element: guard ? <Guard kind={guard}>{page}</Guard> : page }
      }),
      ...(__SHELL_TEST_FIXTURES__ && FixtureRoutes ? [{ path: '__fixture/*', element: <FixtureRoutes /> }] : []),
      { path: 'settings', element: lazyPage('pages.console-settings-page', () => import('./pages/settings')) },
      { path: '*', element: <RouteState state="unknown" /> }
    ]
  }
]

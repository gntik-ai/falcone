import { lazy, Suspense, type ComponentType } from 'react'
import { Outlet, type RouteObject, useRoutes } from 'react-router-dom'
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

declare const __SHELL_TEST_FIXTURES__: boolean
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
    path: '/console',
    element: <ProtectedRoute><Shell /></ProtectedRoute>,
    children: [
      { index: true, element: <ConsoleIndexRedirect /> },
      { path: 'operations/:operationId', element: lazyPage('operationDetail', () => import('./pages/operationDetail')) },
      ...pendingConsoleRoutes.map(({ guard, ...route }) => {
        if (route.path === 'operations') return { ...route, element: lazyPage('pages.console-operations-page', () => import('./pages/consoleOperations')) }
        if (route.path === 'tenants') return { ...route, element: lazyPage('pages.console-tenants-page', () => import('./pages/consoleTenants')) }
        if (route.path === 'overview') return { ...route, element: lazyPage('pages.console-overview-page', () => import('./pages/overview')) }
        if (route.path === 'plans') return { ...route, element: <Guard kind="superadmin">{lazyPage('pages.console-plan-catalog-page', () => import('./pages/consolePlanCatalog'))}</Guard> }
        if (route.path === 'plans/new') return { ...route, element: lazyPage('pages.console-plan-create-page', () => import('./pages/consolePlanCreate')) }
        if (route.path === 'quotas') return { ...route, element: lazyPage('pages.console-quotas-page', () => import('./pages/consoleQuotas')) }
        if (route.path === 'runtime') return { ...route, element: lazyPage('pages.console-runtime-page', () => import('./pages/consoleRuntime')) }
        if (route.path === 'my-plan/allocation') return { ...route, element: lazyPage('pages.console-tenant-allocation-summary-page', () => import('./pages/consoleTenantAllocationSummary')) }
        if (route.path === 'profile') return { ...route, element: lazyPage('pages.console-profile-page', () => import('./pages/consoleProfile')) }
        if (route.path === 'workspaces/:workspaceId/docs') return { ...route, element: lazyPage('pages.console-docs-page', () => import('./pages/consoleDocs')) }
        if (route.path === 'workspaces/:workspaceId' && route.migrated) return { ...route, element: lazyPage('pages.console-workspace-dashboard-page', () => import('./pages/consoleWorkspaceDashboard')) }
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

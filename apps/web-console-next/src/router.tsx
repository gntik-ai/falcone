import { lazy, Suspense, type ComponentType } from 'react'
import { Outlet, type RouteObject, useRoutes } from 'react-router-dom'
import { StatusPage } from './StatusPage'
import { ProtectedRoute } from './shell/session'
import { Shell } from './shell/Shell'
import { Guard, ConsoleIndexRedirect } from './shell/guards'
import { RouteState } from './shell/RouteState'

declare const __SHELL_TEST_FIXTURES__: boolean
const FixtureRoutes = __SHELL_TEST_FIXTURES__ ? lazy(() => import('./shell/fixtures/FixtureRoutes')) : null

export function routerBasename(base = import.meta.env.VITE_BASE_PATH || '/'): string {
  return base.replace(/\/+$/, '') || '/'
}

export function ConsoleRoutes() {
  const routes = useRoutes(appRoutes)
  return <Suspense fallback={<StatusPage state="loading" />}>{routes}</Suspense>
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
      { path: '/', element: lazyPage('welcome', () => import('./pages/welcome')) },
      { path: '/login', element: lazyPage('login', () => import('./pages/login')) },
      { path: '/password-recovery', element: lazyPage('recovery', () => import('./pages/recovery')) },
      { path: '/invitations/:tenantId/:invitationId', element: lazyPage('invitation', () => import('./pages/invitation')) },
      { path: '/signup', element: lazyPage('signup', () => import('./pages/signup')) },
      { path: '/signup/pending-activation', element: lazyPage('pendingActivation', () => import('./pages/pendingActivation')) },
      { path: '*', element: <RouteState state="notFound" /> }
    ]
  },
  {
    path: '/console',
    element: <ProtectedRoute><Shell /></ProtectedRoute>,
    children: [
      { index: true, element: <ConsoleIndexRedirect /> },
      { path: 'overview', element: lazyPage('overview', () => import('./pages/overview')) },
      ...[
        'tenants',
        'workspaces',
        'database',
        'functions-registry',
        'iam-access',
        'members',
        'plans',
        'plans/new',
        'plans/:planId',
        'tenants/:tenantId/plan',
        'my-plan',
        'my-plan/allocation',
        'workspaces/:workspaceId',
        'auth',
        'auth-config',
        'postgres',
        'postgres/data',
        'mongo',
        'mongo/data',
        'kafka',
        'events/data',
        'functions',
        'functions/data',
        'realtime/changes',
        'flows',
        'flows/:flowId',
        'flows/:flowId/runs',
        'flows/:flowId/runs/:executionId',
        'storage',
        'observability',
        'runtime',
        'service-accounts',
        'quotas',
        'operations',
        'operations/:operationId',
        'mcp/servers/:mcpServerId',
        'workspaces/:workspaceId/realtime',
        'workspaces/:workspaceId/docs',
        'secrets',
        'secrets/:encodedSecretPath/rotate',
        'workspace-secrets',
        'profile'
      ].map((path) => {
        const page = lazyPage('pendingPage', () => import('./pages/pendingPage'))
        const kind = ['iam-access', 'auth', 'plans', 'plans/new', 'plans/:planId', 'tenants/:tenantId/plan'].includes(path) ? 'superadmin'
          : path === 'runtime' ? 'observer' : path === 'workspace-secrets' ? 'secrets' : null
        return { path, handle: { platformGlobal: path.startsWith('plans') || path === 'runtime' }, element: kind ? <Guard kind={kind}>{page}</Guard> : page }
      }),
      ...(__SHELL_TEST_FIXTURES__ && FixtureRoutes ? [{ path: '__fixture/*', element: <FixtureRoutes /> }] : []),
      { path: 'settings', element: lazyPage('settings', () => import('./pages/settings')) },
      { path: '*', element: <RouteState state="unknown" /> }
    ]
  }
]

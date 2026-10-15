import { lazy, Suspense, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, type RouteObject, useRoutes } from 'react-router-dom'
import { StatusPage } from './StatusPage'

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

function NotFound() {
  const { t } = useTranslation('common')
  return <section>
    <h1 className="text-2xl font-semibold">{t('states.notFound.title')}</h1>
    <p className="mt-2 text-muted-foreground">{t('placeholder.body')}</p>
  </section>
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
      { path: '*', element: <NotFound /> }
    ]
  },
  {
    path: '/console',
    element: <Outlet />,
    children: [
      { index: true, element: lazyPage('dashboard', () => import('./pages/dashboard')) },
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
      ].map((path) => ({ path, element: lazyPage('pendingPage', () => import('./pages/pendingPage')) })),
      { path: 'settings', element: lazyPage('settings', () => import('./pages/settings')) },
      { path: '*', element: <NotFound /> }
    ]
  }
]

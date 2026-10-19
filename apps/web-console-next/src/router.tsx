import { lazy, Suspense, type ComponentType } from 'react'
import { Outlet, type RouteObject, useRoutes } from 'react-router-dom'
import { StatusPage } from './StatusPage'
import { ProtectedRoute } from './shell/session'
import { Shell } from './shell/Shell'
import { Guard, ConsoleIndexRedirect } from './shell/guards'
import { RouteState } from './shell/RouteState'
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
      ...pendingConsoleRoutes.map(({ guard, ...route }) => {
        const page = lazyPage('pendingPage', () => import('./pages/pendingPage'))
        return { ...route, element: guard ? <Guard kind={guard}>{page}</Guard> : page }
      }),
      ...(__SHELL_TEST_FIXTURES__ && FixtureRoutes ? [{ path: '__fixture/*', element: <FixtureRoutes /> }] : []),
      { path: 'settings', element: lazyPage('settings', () => import('./pages/settings')) },
      { path: '*', element: <RouteState state="unknown" /> }
    ]
  }
]

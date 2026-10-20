import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import * as sessionApi from '@in-falcone/console-api/session'
import { Shell } from '../src/shell/Shell'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { changeLocale } from '../src/i18n'
import { Guard } from '../src/shell/guards'
import { ConsoleContextProvider } from '../src/shell/context'
import { ProtectedRoute, useSession } from '../src/shell/session'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => { cleanup(); requests?.verify() })

test.each([
  ['es', 'Sin acceso a cuotas', 'Consulta con tu administrador.', 'Acceso denegado', 'No tienes permiso para ver esta página.'],
  ['en', 'No quota access', 'Ask your administrator.', 'Access denied', 'You do not have permission to view this page.'],
])('Guard supports page denial copy and defaults in %s', async (locale, title, description, defaultTitle, defaultBody) => {
  await changeLocale(locale as 'es' | 'en')
  login(['tenant_viewer'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  const open = (custom: boolean) => render(<MemoryRouter><ProtectedRoute><ConsoleContextProvider>
    <Guard kind="superadmin" {...(custom ? { denialTitle: title, denialDescription: description } : {})}><p>Protected content</p></Guard>
  </ConsoleContextProvider></ProtectedRoute></MemoryRouter>)
  const custom = open(true)
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  expect(screen.getByText(description)).toBeVisible()
  expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  custom.unmount()
  open(false)
  expect(await screen.findByRole('heading', { name: defaultTitle })).toBeVisible()
  expect(within(screen.getByRole('main')).getByText(defaultBody)).toBeVisible()
})

function CurrentLocation() {
  const location = useLocation()
  return <output aria-label="Current location">{location.pathname}{location.search}{location.hash}</output>
}

test.each(['/next', '/preview'])('protected intent includes router basename %s', async (basename) => {
  requests = strictFetch({})
  render(<MemoryRouter basename={basename} initialEntries={[`${basename}/console/quotas?x=1#s`]}>
    <CurrentLocation /><Routes>
      <Route path="/console/quotas" element={<ProtectedRoute><p>Quotas</p></ProtectedRoute>} />
      <Route path={consoleAuthConfig.loginPath} element={<h1>Configured login</h1>} />
    </Routes>
  </MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Configured login' })).toBeVisible()
  expect(screen.getByLabelText('Current location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe(`${basename}/console/quotas?x=1#s`)
})

test('session page helper exposes persisted principal without the auth lifecycle or loading UI', async () => {
  const ensure = vi.spyOn(sessionApi, 'ensureConsoleSession')
  const session = login(['workspace_viewer'])
  session.expiresAt = session.tokenSet!.expiresAt = '2020-01-01T00:00:00Z'
  sessionApi.persistConsoleShellSession(session)
  requests = strictFetch({})
  function Page() { return <h1>{useSession()?.principal?.userId}</h1> }
  const rendered = renderWithSession(<Page />)
  expect(screen.getByRole('heading', { name: 'synthetic-user' })).toBeVisible()
  expect(rendered.container.querySelector('[aria-busy="true"]')).toBeNull()
  expect(screen.queryByText('Cargando')).not.toBeInTheDocument()
  await Promise.resolve()
  expect(ensure).not.toHaveBeenCalled()
  expect(requests.mock).not.toHaveBeenCalled()
})

test('sidebar uses the router for opted-in routes and root-relative legacy anchors for the rest', async () => {
  login(['tenant_owner'])
  requests = strictFetch({})
  // Only this test opts in; no shipped route is migrated.
  pendingConsoleRoutes.push({ path: 'overview', migrated: true })
  try {
    renderWithSession(<><CurrentLocation /><Routes><Route path="/console" element={<Shell />}>
      <Route path="quotas" element={<h1>Quotas test page</h1>} />
      <Route path="overview" element={<h1>Migrated overview test page</h1>} />
    </Route></Routes></>, { basename: '/next', route: '/next/console/quotas' })
    const nav = screen.getByRole('navigation', { name: 'Navegación de consola' })
    const migrated = within(nav).getByRole('link', { name: /Vista general/ })
    expect(migrated).toHaveAttribute('href', '/next/console/overview')
    expect(within(nav).getByRole('link', { name: /Flujos/ })).toHaveAttribute('href', '/console/flows')
    const documentLocation = window.location.href
    expect(fireEvent.click(migrated)).toBe(false) // Router consumes document navigation.
    expect(await screen.findByRole('heading', { name: 'Migrated overview test page' })).toBeVisible()
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/overview')
    expect(window.location.href).toBe(documentLocation)
  } finally { pendingConsoleRoutes.pop() }
})

test.each(['es', 'en'].flatMap((locale) => ['tenant', 'workspace'].flatMap((endpoint) =>
  [403, 401, 404, 500, 418, 'network', 'string403', 'missing-status'].map((status) => ({ locale, endpoint, status }))
)))('$locale $endpoint failure $status only shows no-access for numeric 403', async ({ locale, endpoint, status }) => {
  await changeLocale(locale as 'es' | 'en')
  const session = login(['tenant_owner'], ['t1'])
  const fail = () => {
    if (status === 'network') throw new TypeError('Synthetic network failure')
    if (status === 'string403') throw Object.assign(new Error('Synthetic nonnumeric status'), { status: '403' })
    if (status === 'missing-status') throw new Error('Synthetic unknown status')
    return Response.json({ message: 'Synthetic failure' }, { status: status as number })
  }
  requests = strictFetch({
    'GET /v1/tenants/t1': endpoint === 'tenant' ? fail : { tenantId: 't1', displayName: 'Tenant One' },
    [`GET ${workspaceUrl('t1')}`]: fail,
    'POST /v1/auth/login-sessions/synthetic-session/refresh': session,
  })
  renderWithSession(<Routes><Route path="/console" element={<Shell />}><Route path="overview" element={<h1>Context test page</h1>} /></Route></Routes>)
  const expected = status === 403
    ? locale === 'es' ? 'No tienes permiso para ver esta página.' : 'You do not have permission to view this page.'
    : locale === 'es' ? 'Comprueba tu conexión e inténtalo de nuevo.' : 'Check your connection and try again.'
  await waitFor(() => expect(within(screen.getByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context' })).getByRole('status')).toHaveTextContent(expected))
})

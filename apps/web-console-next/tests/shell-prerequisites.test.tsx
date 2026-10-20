import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { Guard } from '../src/shell/guards'
import { ConsoleContextProvider } from '../src/shell/context'
import { ProtectedRoute } from '../src/shell/session'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('Guard preserves default and page denial copy and allows authorised roles in %s', async (locale) => {
  await changeLocale(locale)
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  const copy = locale === 'es' ? { denialTitle: 'Página privada', denialDescription: 'Consulta al administrador.' }
    : { denialTitle: 'Private page', denialDescription: 'Ask your administrator.' }
  const defaults = locale === 'es' ? ['Acceso denegado', 'No tienes permiso para ver esta página.']
    : ['Access denied', 'You do not have permission to view this page.']
  login(['tenant_viewer'])
  function View({ custom = false }: { custom?: boolean }) {
    return <MemoryRouter><ProtectedRoute><ConsoleContextProvider>
      <Guard kind="superadmin" {...(custom ? copy : {})}><h1>Allowed page</h1></Guard>
    </ConsoleContextProvider></ProtectedRoute></MemoryRouter>
  }
  const view = render(<View custom />)
  expect(await screen.findByRole('heading', { name: copy.denialTitle })).toBeVisible()
  expect(screen.getByText(copy.denialDescription)).toBeVisible()
  view.rerender(<View />)
  expect(await screen.findByRole('heading', { name: defaults[0] })).toBeVisible()
  expect(screen.getByText(defaults[1])).toBeVisible()
  view.unmount()
  login(['superadmin'])
  render(<View custom />)
  expect(await screen.findByRole('heading', { name: 'Allowed page' })).toBeVisible()
  expect(screen.queryByText(copy.denialDescription)).not.toBeInTheDocument()
})

test.each(['/next', '/', ''])('protected intent includes router basename %s once and redirects to configured login', async (basename) => {
  const { App } = await import('../src/App')
  const { readProtectedRouteIntent } = await import('@in-falcone/console-api/session')
  const { consoleAuthConfig } = await import('@in-falcone/console-api/config')
  const prefix = basename === '/' ? '' : basename
  function Location() { const location = useLocation(); return <output aria-label="Location">{location.pathname}</output> }
  render(<MemoryRouter basename={basename} initialEntries={[`${prefix}/console/quotas?x=1#s`]}><Location /><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
  expect(screen.getByLabelText('Location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe(`${prefix}/console/quotas?x=1#s`)
})

test('session helper renders the persisted principal synchronously without the auth lifecycle', async () => {
  const sessions = await import('@in-falcone/console-api/session')
  const shellSession = await import('../src/shell/session')
  const support = await import('./shell-support')
  const ensure = vi.spyOn(sessions, 'ensureConsoleSession')
  const protectedRoute = vi.spyOn(shellSession, 'ProtectedRoute')
  const session = login(['workspace_admin'])
  function Page() { return <h1>{shellSession.useSession()?.principal?.userId}</h1> }
  support.renderWithSession(<Page />)
  expect(screen.getByRole('heading', { name: session.principal!.userId })).toBeVisible()
  expect(screen.queryByText('Cargando')).not.toBeInTheDocument()
  await Promise.resolve()
  expect(ensure).not.toHaveBeenCalled()
  expect(protectedRoute).not.toHaveBeenCalled()
})

test.each(['/next', '/'].flatMap((basename) => ['sidebar', 'mobile'].map((surface) => ({ basename, surface }))))('$surface links use the router only for migrated targets under $basename', async ({ basename, surface }) => {
  const { Shell } = await import('../src/shell/Shell')
  const { pendingConsoleRoutes } = await import('../src/shell/routes')
  const { renderWithSession, tenantUrl } = await import('./shell-support')
  login()
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  function Location() { const location = useLocation(); return <output aria-label="Location">{location.pathname}</output> }
  const routes = pendingConsoleRoutes.map((route) => ({ ...route, migrated: route.path === 'quotas' }))
  renderWithSession(<MemoryRouter basename={basename} initialEntries={[`${basename === '/' ? '' : basename}/console/overview`]}>
    <Location /><Routes><Route path="/console" element={<Shell routes={routes} />}><Route path="*" element={<h1>Test page</h1>} /></Route></Routes>
  </MemoryRouter>)
  if (surface === 'mobile') fireEvent.click(screen.getAllByRole('button', { name: 'Open navigation' })[1])
  const links = within(surface === 'mobile' ? await screen.findByRole('dialog') : screen.getByRole('navigation', { name: 'Navegación de consola' }))
  const quota = links.getByRole('link', { name: 'Cuotas' })
  expect(quota).toHaveAttribute('href', `${basename === '/' ? '' : basename}/console/quotas`)
  expect(links.getByRole('link', { name: /Flujos/ })).toHaveAttribute('href', '/console/flows')
  expect(fireEvent.click(quota)).toBe(false)
  expect(screen.getByLabelText('Location')).toHaveTextContent('/console/quotas')
})

test.each(['tenant', 'workspace'].flatMap((load) =>
  ['es', 'en'].flatMap((locale) => [403, 500, 404, 'network', 'string-status', 'unknown', 'null'].map((failure) => ({ load, locale, failure })))
))('$load $failure shows only numeric 403 as no access in $locale', async ({ load, locale, failure }) => {
  const { App } = await import('../src/App')
  await changeLocale(locale as 'es' | 'en')
  login()
  const fail = () => {
    if (typeof failure === 'number') return Response.json({ message: 'Synthetic failure' }, { status: failure })
    if (failure === 'string-status') throw { status: '403' }
    if (failure === 'unknown') throw { message: '403' }
    if (failure === 'null') throw null
    throw new TypeError('Synthetic network failure')
  }
  requests = strictFetch({
    [`GET ${tenantUrl}`]: load === 'tenant' ? fail : { items: [{ tenantId: 't1', displayName: 'Tenant One' }] },
    [`GET ${workspaceUrl('t1')}`]: fail
  })
  render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
  const forbidden = locale === 'es' ? 'No tienes permiso para ver esta página.' : 'You do not have permission to view this page.'
  const network = locale === 'es' ? 'Comprueba tu conexión e inténtalo de nuevo.' : 'Check your connection and try again.'
  const notice = await screen.findByText(locale === 'es' ? /^(No tienes permiso para ver esta página\.|Comprueba tu conexión e inténtalo de nuevo\.)$/ : /^(You do not have permission to view this page\.|Check your connection and try again\.)$/)
  expect(notice).toHaveAttribute('role', 'status')
  expect(notice).toHaveTextContent(failure === 403 ? forbidden : network)
  expect(screen.queryByText(failure === 403 ? network : forbidden)).not.toBeInTheDocument()
})

import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch } from './shell-support'
import { pageRoutes, shellRoutes, calls, realmKey } from './consoleAuth-support'
import es from '../src/locales/es/pages.console-auth-page.json'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test('the route is flagged migrated, superadmin-only, and the shell navigates client-side to it under /next', async () => {
  login(['superadmin'])
  requests = strictFetch({ ...shellRoutes(), ...pageRoutes() })
  expect(pendingConsoleRoutes.find((route) => route.path === 'auth')).toMatchObject({ migrated: true, guard: 'superadmin' })
  expect(isMigratedRoute('/console/auth')).toBe(true)
  const view = render(<StrictMode><MemoryRouter basename="/next" initialEntries={['/next/console/overview']}><App /></MemoryRouter></StrictMode>)
  const links = await screen.findAllByRole('link', { name: 'Autenticación' })
  expect(links[0]).toHaveAttribute('href', '/next/console/auth')
  fireEvent.click(links[0])
  expect(await screen.findByRole('heading', { level: 1, name: es.title }, { timeout: 5000 })).toBeVisible()
  expect(await screen.findByRole('table', { name: es.apps.table }, { timeout: 5000 })).toBeVisible()
  view.unmount()
})

test.each([['tenant_owner'], ['platform_auditor'], ['workspace_admin']])('%s is denied by the guard and the page sends no request', async (role) => {
  login([role])
  requests = strictFetch({ ...shellRoutes(), ...pageRoutes() })
  render(<MemoryRouter initialEntries={['/console/auth']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso denegado' }, { timeout: 5000 })).toBeVisible()
  expect(calls(requests).filter(({ path }) => path.startsWith('/v1/iam/') || path.includes('/applications'))).toEqual([])
})

test('a realm 401 refreshes once, then clears the session and redirects to login with the return intent', async () => {
  let refreshes = 0
  login(['superadmin'])
  requests = strictFetch({
    ...shellRoutes(), ...pageRoutes(),
    [realmKey('users')]: () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => { refreshes++; return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) },
    'GET /v1/auth/signups/policy': { selfServiceEnabled: false, mode: 'invitation' },
  })
  render(<MemoryRouter initialEntries={['/console/auth']}><App /></MemoryRouter>)
  await screen.findByLabelText('Usuario', {}, { timeout: 5000 })
  expect(refreshes).toBe(1)
  expect(readProtectedRouteIntent()).toBe('/console/auth')
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, NavLink, useNavigate } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { ready, realtimePath, capabilitiesPath } from './parity/pages/console-realtime-page.manifest'
import { consumption } from './parity/pages/console-workspace-dashboard-page.manifest'
import es from '../src/locales/es/pages.console-realtime-page.json'
import common from '../src/locales/es/common.json'

let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); document.documentElement.removeAttribute('data-same-document') })
const bootstrap = {
  [`GET ${capabilitiesPath}`]: { capabilities: { realtime: true } },
  [`GET ${tenantUrl}`]: { items: [{ tenantId: 't1', displayName: 'Synthetic tenant', slug: 'synthetic' }] },
  [`GET ${workspaceUrl('t1')}`]: { items: [{ workspaceId: 'ws-1', tenantId: 't1', displayName: 'Synthetic workspace', slug: 'synthetic' }] },
  'GET /v1/workspaces/ws-1/consumption': { ...consumption, workspaceId: 'ws-1', tenantId: 't1' },
}
function Controls() {
  const navigate = useNavigate()
  return <><NavLink to="/console/workspaces/ws-1/realtime">Realtime link fixture</NavLink><button onClick={() => navigate('/console/workspaces/ws-1/realtime')}>Realtime navigate fixture</button><button onClick={() => navigate('/console/workspaces/ws-1')}>Dashboard fixture</button></>
}
test('NavLink and navigate load the lazy route once each in the same document with the shell visible', async () => {
  login(['superadmin'])
  requests = strictFetch({ ...bootstrap, [`GET ${realtimePath}`]: ready })
  render(<MemoryRouter initialEntries={['/console/workspaces/ws-1']}><Controls /><App /></MemoryRouter>)
  await screen.findByRole('table', {}, { timeout: 10000 })
  expect(requests.mock.mock.calls.filter(([path]) => path === capabilitiesPath)).toHaveLength(0)
  document.documentElement.dataset.sameDocument = 'synthetic-marker'
  fireEvent.click(screen.getByRole('link', { name: 'Realtime link fixture' }))
  await screen.findByRole('tab', { name: 'JavaScript' }, { timeout: 10000 })
  expect(requests.mock.mock.calls.filter(([path]) => path === realtimePath)).toHaveLength(1)
  expect(document.documentElement.dataset.sameDocument).toBe('synthetic-marker')
  expect(screen.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard fixture' })); await screen.findByRole('table', {}, { timeout: 10000 })
  fireEvent.click(screen.getByRole('button', { name: 'Realtime navigate fixture' })); await screen.findByRole('tab', { name: 'JavaScript' }, { timeout: 10000 })
  expect(document.documentElement.dataset.sameDocument).toBe('synthetic-marker')
  expect(requests.mock.mock.calls.filter(([path]) => path === realtimePath)).toHaveLength(2)
  expect(requests.mock.mock.calls.filter(([path]) => path === capabilitiesPath)).toHaveLength(1)
}, 20000)
test('the provisioning link reaches the unknown route and the back control restores realtime', async () => {
  login(['superadmin'])
  requests = strictFetch({ ...bootstrap, [`GET ${realtimePath}`]: { ...ready, dataSources: [] } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/workspaces/ws-1/realtime']}><App /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('link', { name: es.provisioning }))
  expect(await screen.findByRole('heading', { name: common.states.unknown.title })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: common.shell.back }))
  expect(await screen.findByRole('heading', { name: es.emptyTitle })).toBeVisible()
  expect(requests.mock.mock.calls.filter(([path]) => path === realtimePath)).toHaveLength(2)
  expect(requests.mock.mock.calls.filter(([path]) => path === capabilitiesPath)).toHaveLength(1)
})
test.each(['refresh-ok', 'refresh-rejected', 'replay-401'])('401 shared session lifecycle: %s', async (variant) => {
  login(['superadmin']); let count = 0
  const refreshed = buildConsoleRefreshSessionFixture()
  Object.assign(refreshed.principal!, { tenantIds: ['t1'], workspaceIds: ['ws-1'] })
  requests = strictFetch({ ...bootstrap,
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    [`GET ${realtimePath}`]: () => ++count === 2 && variant === 'refresh-ok' ? Response.json(ready) : Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'refresh-rejected' ? Response.json({}, { status: 401 }) : Response.json(refreshed),
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/workspaces/ws-1/realtime']}><App /></MemoryRouter>)
  if (variant === 'refresh-ok') {
    await screen.findByRole('tab', { name: 'JavaScript' }, { timeout: 10000 })
    expect(screen.getByTestId('realtime-enabled')).not.toHaveAttribute('inert')
    const replay = requests.mock.mock.calls.filter(([path]) => path === realtimePath)[1][1]
    expect(new Headers(replay?.headers).get('Authorization')).toBe(`Bearer ${buildConsoleRefreshSessionFixture().tokenSet!.accessToken}`)
  } else {
    await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 5000 })
    expect(readProtectedRouteIntent()).toBe('/next/console/workspaces/ws-1/realtime')
  }
  await waitFor(() => expect(count).toBe(variant === 'refresh-rejected' ? 1 : 2))
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(screen.queryByRole('heading', { name: es.errorTitle })).not.toBeInTheDocument()
})

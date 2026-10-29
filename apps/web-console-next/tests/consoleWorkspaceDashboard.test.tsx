import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent } from '@in-falcone/console-api/session'
import WorkspacePage from '../src/pages/consoleWorkspaceDashboard'
import { consumption, consumptionFixtures, meterEdges } from './parity/pages/console-workspace-dashboard-page.manifest'
import { login, strictFetch } from './shell-support'
import { ProtectedRoute } from '../src/shell/session'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-workspace-dashboard-page.json'
import en from '../src/locales/en/pages.console-workspace-dashboard-page.json'

const path = '/v1/workspaces/synthetic-workspace/consumption'
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); window.history.replaceState({}, '', '/') })
const calls = () => requests.mock.mock.calls.filter(([url]) => /\/consumption$/.test(String(url)))
const fail = (status: number) => Response.json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', correlationId: 'PRIVATE_CORRELATION',
  ...(status === 500 ? { requestId: 'req_synthetic_workspace_500' } : {}) }, { status })
function Location() { return <output aria-label="Location">{useLocation().pathname}</output> }
function routes() {
  return <Routes>
    <Route path="/console/workspaces/:workspaceId" element={<ProtectedRoute><WorkspacePage /></ProtectedRoute>} />
    <Route path="/console/my-plan" element={<h1>My plan destination</h1>} />
    <Route path="/login" element={<Location />} />
  </Routes>
}
function open(response: unknown = consumption, id = 'synthetic-workspace', role = 'workspace_viewer') {
  login([role])
  requests = strictFetch({ [`GET /v1/workspaces/${encodeURIComponent(id)}/consumption`]: response })
  return render(<MemoryRouter initialEntries={[`/console/workspaces/${encodeURIComponent(id)}`]}>{routes()}</MemoryRouter>)
}
function assertGet(count: number, id = 'synthetic-workspace') {
  expect(calls()).toHaveLength(count)
  for (const [url, init] of calls()) {
    expect(url).toBe(`/v1/workspaces/${encodeURIComponent(id)}/consumption`)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  }
}

test.each(['es', 'en'] as const)('ports legacy metadata, five quota columns, source mapping and badge names in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  open()
  const table = await screen.findByRole('table', { name: copy.tableTitle })
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
  expect(within(table).getAllByRole('row')).toHaveLength(4)
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByText('synthetic-workspace')).toBeVisible()
  expect(screen.getByText('synthetic-tenant')).toBeVisible()
  const time = document.querySelector('time')!
  expect(time).toHaveAttribute('datetime', consumption.snapshotAt)
  expect(time.textContent).toBe(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(consumption.snapshotAt)))
  expect(screen.getByLabelText(locale === 'es' ? 'PostgreSQL databases: estado Dentro del límite' : 'PostgreSQL databases: status Within limit')).toBeVisible()
  expect(screen.getByLabelText(locale === 'es' ? 'Synthetic realtime capability: capacidad habilitada' : 'Synthetic realtime capability: capability enabled')).toHaveTextContent(copy.enabled)
  expect(screen.getByLabelText(locale === 'es' ? 'Synthetic disabled capability: capacidad deshabilitada' : 'Synthetic disabled capability: capability disabled')).toHaveTextContent(copy.disabled)
  const row = within(table).getAllByRole('row')[1]
  expect(row).toHaveTextContent(copy.override)
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('6')
  expect(screen.getByText(copy.platformDefault)).toBeVisible()
  expect(within(table).getAllByText(copy.plan)).toHaveLength(2)
  expect(within(table).getByRole('meter')).toHaveAttribute('aria-valuemax', '6')
  expect(within(table).getByRole('meter')).toHaveAttribute('aria-valuenow', '4')
  expect(within(table).getByText(copy.unlimited)).toBeVisible()
  expect(within(table).getByText(copy.unavailableData)).toBeVisible()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  expect(within(table).queryByRole('button')).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Deployments|Production API|Save view|Density|Columns/)
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
  assertGet(1)
})

test.each(['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'])('all authenticated roles read the same data: %s', async (role) => {
  open(consumption, 'synthetic-workspace', role)
  await screen.findByRole('table')
  assertGet(1)
})

test('announces loading once with workspace context and hides the skeleton announcements', async () => {
  let release!: () => void
  open(async () => { await new Promise<void>((resolve) => { release = resolve }); return Response.json(consumption) })
  const status = await screen.findByRole('status', { name: es.loading })
  expect(status).toHaveAttribute('aria-busy', 'true')
  expect(status).toHaveTextContent('synthetic-workspace')
  expect(within(status).queryAllByRole('status')).toHaveLength(0)
  expect(status.querySelectorAll('[aria-hidden="true"] [role="status"]').length).toBe(4)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  await act(async () => release())
  await screen.findByRole('table')
  expect(screen.queryByRole('status', { name: es.loading })).not.toBeInTheDocument()
})

test.each(['es', 'en'] as const)('independent empty and absent fields preserve their sections and status in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  for (const variant of ['dimensions-empty', 'capabilities-empty', 'capabilities-absent', 'dimensions-empty-capabilities-absent'] as const) {
    const fixture = consumptionFixtures[`workspace-consumption.${variant}`].body
    const page = open(fixture)
    await screen.findByText('synthetic-workspace', { exact: true })
    const noDimensions = variant.startsWith('dimensions-empty')
    const noCapabilities = variant.endsWith('capabilities-absent')
    expect(screen.queryByRole('table')).toBe(noDimensions ? null : screen.getByRole('table'))
    expect(screen.queryByRole('heading', { name: copy.dimensionsEmpty }) !== null).toBe(noDimensions)
    expect(screen.queryByRole('heading', { name: copy.capabilities }) !== null).toBe(!noCapabilities)
    if (variant === 'capabilities-empty') {
      expect(screen.getByRole('heading', { name: copy.capabilitiesEmpty })).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent(copy.capabilitiesEmpty)
    }
    expect(screen.queryByRole('button', { name: /clear|limpiar/i })).not.toBeInTheDocument()
    page.unmount()
    requests.verify()
  }
})

test.each(['es', 'en'] as const)('meter edges retain unlimited, unknown, zero, equal and over-limit text in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  open(meterEdges)
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row').slice(1)
  expect(within(rows[0]).getByText(copy.unavailableData)).toBeVisible()
  expect(within(rows[0]).queryByRole('meter')).not.toBeInTheDocument()
  expect(rows[1]).toHaveTextContent(copy.unlimited)
  expect(within(rows[1]).queryByRole('meter')).not.toBeInTheDocument()
  for (const row of rows.slice(2)) {
    const meter = within(row).getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe(meter.getAttribute('aria-valuemax'))
    expect(row).toHaveTextContent(copy.over_limit)
  }
  expect(within(rows[4]).getByRole('meter')).toHaveAttribute('aria-valuetext', '6 / 6')
  expect(within(rows[5]).getByRole('meter')).toHaveAttribute('aria-valuetext', '10 / 6')
})

test.each(['es', 'en'] as const)('403 and 404 offer My plan with no request-access or retry action in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  for (const status of [403, 404]) {
    const page = open(() => fail(status))
    expect(await screen.findByRole('heading', { name: status === 403 ? copy.noAccess : copy.unavailable })).toBeVisible()
    expect(screen.getByRole('link', { name: copy.myPlan })).toHaveAttribute('href', '/console/my-plan')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
    if (status === 404) expect(screen.getByText(copy.unavailableDescription.replace('{workspaceId}', 'synthetic-workspace'))).toBeVisible()
    assertGet(1)
    page.unmount()
    requests.verify()
  }
})

test.each(['es', 'en'] as const)('500 Retry sends one identical read, retains focus after failure and focuses h1 after success in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  let release!: () => void
  let count = 0
  open(async () => {
    count++
    if (count === 2) await new Promise<void>((resolve) => { release = resolve })
    return count < 3 ? fail(500) : Response.json(consumption)
  })
  const retry = await screen.findByRole('button', { name: copy.retry })
  expect(screen.getByText('req_synthetic_workspace_500')).toBeVisible()
  expect(document.body).not.toHaveTextContent('PRIVATE_CORRELATION')
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  const back = screen.getByRole('link', { name: copy.myPlan })
  expect(back.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  retry.focus(); fireEvent.click(retry)
  await screen.findByRole('button', { name: copy.retrying })
  expect(retry).toHaveFocus()
  expect(retry).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(retry)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  assertGet(2)
  await act(async () => release())
  expect(await screen.findByRole('button', { name: copy.retry })).toHaveFocus()
  fireEvent.click(retry)
  await screen.findByRole('table')
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  assertGet(3)
})

test('network errors hide raw details and can retry the same request', async () => {
  let count = 0
  open(() => { if (++count === 1) throw new TypeError('PRIVATE_MARKER'); return Response.json(consumption) })
  const retry = await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText(es.networkDescription)).toBeVisible()
  expect(screen.queryByText(es.requestId)).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  fireEvent.click(retry)
  await screen.findByRole('table')
  assertGet(2)
})

test.each(['synthetic/with space', 'synthetic space'])('encodes the route ID containing reserved characters: %s', async (id) => {
  open({ ...consumption, workspaceId: id }, id)
  await screen.findByRole('table')
  expect(screen.getByText(id)).toBeVisible()
  assertGet(1, id)
})

test('route param wins over a stored workspace selection', async () => {
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 'stored-tenant', workspaceId: 'stored-workspace' }))
  open()
  await screen.findByRole('table')
  assertGet(1)
})

test.each(['delayed', 'loaded', 'error'] as const)('pushState and popstate clear the previous %s workspace and ignore its late response', async (previous) => {
  login(['workspace_viewer'])
  let releaseOld!: () => void
  let releaseNew!: () => void
  requests = strictFetch({
    'GET /v1/workspaces/a/consumption': async () => {
      if (previous === 'delayed') await new Promise<void>((resolve) => { releaseOld = resolve })
      return previous === 'error' ? fail(500) : Response.json({ ...consumption, workspaceId: 'Old workspace' })
    },
    'GET /v1/workspaces/b/consumption': async () => {
      await new Promise<void>((resolve) => { releaseNew = resolve })
      return Response.json({ ...consumption, workspaceId: 'New workspace' })
    },
  })
  window.history.replaceState({}, '', '/console/workspaces/a')
  const errors = vi.spyOn(console, 'error')
  render(<BrowserRouter>{routes()}</BrowserRouter>)
  if (previous === 'loaded') await screen.findByText('Old workspace')
  if (previous === 'error') await screen.findByRole('button', { name: es.retry })
  if (previous === 'delayed') await waitFor(() => expect(releaseOld).toBeTypeOf('function'))
  act(() => { window.history.pushState({}, '', '/console/workspaces/b'); window.dispatchEvent(new PopStateEvent('popstate')) })
  expect(screen.queryByText('Old workspace')).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: es.loading })).toHaveTextContent('b')
  await waitFor(() => expect(releaseNew).toBeTypeOf('function'))
  await act(async () => releaseNew())
  expect(await screen.findByText('New workspace')).toBeVisible()
  if (previous === 'delayed') await act(async () => releaseOld())
  expect(screen.queryByText('Old workspace')).not.toBeInTheDocument()
  expect(screen.getByText('New workspace')).toBeVisible()
  expect(calls().map(([url]) => url)).toEqual(['/v1/workspaces/a/consumption', '/v1/workspaces/b/consumption'])
  expect(errors).not.toHaveBeenCalled()
})

test.each([false, true])('401 shared refresh rejected=%s retries once or clears session with login intent', async (rejected) => {
  login(['workspace_viewer'])
  let count = 0
  requests = strictFetch({
    [`GET ${path}`]: () => ++count === 1 ? fail(401) : Response.json(consumption),
    [`POST ${refresh}`]: () => rejected ? fail(401) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter initialEntries={['/console/workspaces/synthetic-workspace']}>{routes()}</MemoryRouter>)
  if (rejected) {
    await waitFor(() => expect(readProtectedRouteIntent()).toBe('/console/workspaces/synthetic-workspace'))
    expect(screen.getByLabelText('Location')).toHaveTextContent('/login')
    expect(readConsoleShellSession()).toBeNull()
    assertGet(1)
  } else {
    await screen.findByRole('table')
    assertGet(2)
    expect(new Headers(calls()[1][1]?.headers).get('Authorization')).toBe('Bearer synthetic-refreshed-access-token')
  }
  const refreshCalls = requests.mock.mock.calls.filter(([url]) => url === refresh)
  expect(refreshCalls).toHaveLength(1)
  expect(JSON.parse(String(refreshCalls[0][1]?.body))).toEqual({ refreshToken: 'synthetic-refresh-token' })
})

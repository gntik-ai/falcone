import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { I18nProvider } from '@gntik-ai/ui'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import AllocationPage from '../src/pages/consoleTenantAllocationSummary'
import { formatAllocationValue, workspaceLabel } from '../src/pages/consoleTenantAllocationSummary/format'
import { allocationMixed, allocationEmpty } from './parity/pages/console-tenant-allocation-summary-page.manifest'
import { login, renderWithSession, strictFetch } from './shell-support'
import { Shell } from '../src/shell/Shell'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { ProtectedRoute } from '../src/shell/session'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-tenant-allocation-summary-page.json'
import en from '../src/locales/en/pages.console-tenant-allocation-summary-page.json'

const path = '/v1/tenant/plan/allocation-summary'
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls.filter(([url]) => url === path)
function open(response: unknown = allocationMixed, roles = ['tenant_owner'], tenants = ['synthetic-tenant']) {
  login(roles, tenants)
  requests = strictFetch({ [`GET ${path}`]: response })
  return renderWithSession(<AllocationPage />, { route: '/console/my-plan/allocation' })
}
const fail = (status: number, extra = {}) => Response.json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', correlationId: 'PRIVATE_CORRELATION', ...extra }, { status })

test.each(['es', 'en'] as const)('ports legacy data, labels, five columns and locale formatting in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  open()
  const table = await screen.findByRole('table', { name: copy.tableTitle })
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
  expect(within(table).getAllByRole('rowheader')).toHaveLength(3)
  expect(within(table).getByText('Synthetic Production')).toBeVisible()
  expect(within(table).getByText(locale === 'es' ? 'Área de trabajo 2' : 'Workspace 2')).toBeVisible()
  expect(within(table).getByText(copy.fullyAllocated)).toBeVisible()
  expect(within(table).getByText(copy.sharedPool)).toBeVisible()
  expect(within(table).getByText(copy.unlimited)).toBeVisible()
  expect(within(table).getByText(copy.dash)).toBeVisible()
  expect(within(table).getAllByText(locale === 'es' ? '2,0 KB' : '2.0 KB')).toHaveLength(2)
  expect(within(table).getByText(`${new Intl.NumberFormat(locale).format(12345)} requests`)).toBeVisible()
  expect(within(table).getAllByRole('meter')).toHaveLength(2)
  expect(within(table).getAllByRole('meter')[0]).toHaveAccessibleName(/PostgreSQL Databases.*5 count/)
  expect(screen.getByText(locale === 'es' ? '3 dimensiones' : '3 dimensions')).toBeVisible()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByText('Ignored name')).not.toBeInTheDocument()
  expect(table).not.toHaveTextContent('f47ac10b')
  expect(calls()).toHaveLength(1)
  expect(calls()[0][1]).toMatchObject({ method: 'GET' })
  expect(calls()[0][1]?.body).toBeUndefined()
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
})

test.each(['superadmin', 'platform_admin', 'platform_operator'])('tenantless %s makes no page request', async (role) => {
  open(allocationMixed, [role], [])
  expect(await screen.findByRole('heading', { name: es.tenantlessTitle })).toBeVisible()
  expect(calls()).toHaveLength(0)
})

test.each(['es', 'en'] as const)('loading precedes the all-shared-pool empty state in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  let release!: () => void
  open(async () => { await new Promise<void>((resolve) => { release = resolve }); return Response.json(allocationEmpty) })
  const state = screen.getByRole('status', { name: copy.loading })
  expect(screen.getByRole('heading', { level: 1 }).compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(state.querySelector('[aria-hidden="true"] [role="status"]')).toBeInTheDocument()
  await waitFor(() => expect(release).toBeTypeOf('function'))
  await act(async () => release())
  expect(await screen.findByRole('heading', { name: copy.emptyTitle })).toBeVisible()
  expect(screen.getByText(copy.emptyDescription)).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test.each(['es', 'en'] as const)('403 has no retry; 404 returns to My plan in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const page = open(() => fail(403))
  expect(await screen.findByRole('heading', { name: copy.noAccess })).toBeVisible()
  expect(screen.queryByRole('button', { name: copy.retry })).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  page.unmount()
  open(() => fail(404))
  expect(await screen.findByRole('heading', { name: copy.notFound })).toBeVisible()
  expect(screen.getAllByRole('link', { name: copy.myPlan })).toHaveLength(2)
  expect(screen.getAllByRole('link', { name: copy.myPlan })[1]).toHaveAttribute('href', '/console/my-plan')
  expect(screen.queryByRole('button', { name: copy.retry })).not.toBeInTheDocument()
})

test.each(['es', 'en'] as const)('retry retains focus while pending, focuses retry after failure and heading after recovery in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  let release!: () => void
  let count = 0
  open(async () => {
    count++
    if (count === 2) await new Promise<void>((resolve) => { release = resolve })
    return count < 3 ? fail(500, { requestId: 'req_synthetic_alloc_500' }) : Response.json(allocationMixed)
  })
  const retry = await screen.findByRole('button', { name: copy.retry })
  expect(screen.getByText('req_synthetic_alloc_500')).toBeVisible()
  expect(document.body).not.toHaveTextContent('PRIVATE_CORRELATION')
  retry.focus(); fireEvent.click(retry)
  await screen.findByRole('button', { name: copy.retrying })
  expect(retry).toHaveFocus()
  fireEvent.click(retry)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(calls()).toHaveLength(2)
  await act(async () => release())
  expect(await screen.findByRole('button', { name: copy.retry })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: copy.retry }))
  await screen.findByRole('table')
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  expect(calls()).toHaveLength(3)
})

test('network rejection shows retry without a request ID or stale data', async () => {
  open(() => { throw new TypeError('PRIVATE_MARKER') })
  expect(await screen.findByRole('button', { name: es.retry })).toBeVisible()
  expect(screen.getByText(es.networkDescription)).toBeVisible()
  expect(screen.queryByText(es.requestId)).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
})

test('label precedence, UUID fallback, byte suffix fallback and unit rules match legacy', () => {
  const workspace = { workspaceId: 'synthetic-id', allocatedValue: 1, displayLabel: 'Label', workspaceDisplayName: 'Display', workspaceName: 'Name', workspaceSlug: 'Slug', name: 'name', slug: 'slug' }
  for (const key of ['displayLabel', 'workspaceDisplayName', 'workspaceName', 'workspaceSlug', 'name', 'slug'] as const) {
    expect(workspaceLabel(workspace, 0, String)).toBe(workspace[key])
    workspace[key] = ''
  }
  expect(workspaceLabel(workspace, 0, String)).toBe('synthetic-id')
  expect(formatAllocationValue(8192, { dimensionKey: 'storage.bytes' }, 'en', 'Unlimited')).toBe('8.0 KB')
  expect(formatAllocationValue(8192, { dimensionKey: 'storage.bytes', unit: 'count' }, 'en', 'Unlimited')).toBe('8,192 count')
  expect(formatAllocationValue(0, { dimensionKey: 'storage.bytes' }, 'es', 'Sin límite')).toBe('0 B')
})

function Location() { return <output aria-label="Location">{useLocation().pathname}</output> }
test.each([false, true])('breadcrumb follows migrated=%s with explicit destination heading focus', async (migrated) => {
  login(['tenant_owner'])
  requests = strictFetch({ [`GET ${path}`]: allocationMixed })
  const route = pendingConsoleRoutes.find((item) => item.path === 'my-plan')!
  const previous = route.migrated
  route.migrated = migrated
  try {
    renderWithSession(<I18nProvider locale="es"><Location /><Routes><Route path="/console" element={<Shell />}>
      <Route path="my-plan/allocation" element={<AllocationPage />} />
      <Route path="my-plan" element={<h1>Destination heading</h1>} />
    </Route></Routes></I18nProvider>, { route: '/next/console/my-plan/allocation', basename: '/next' })
    const link = await within(document.querySelector('.allocation-summary')!).findByRole('link', { name: es.myPlan })
    expect(link).toHaveAttribute('href', migrated ? '/next/console/my-plan' : '/console/my-plan')
    link.focus()
    const documentLocation = window.location.href
    expect(fireEvent.click(link)).toBe(!migrated)
    if (migrated) {
      expect(await screen.findByRole('heading', { name: 'Destination heading' })).toHaveFocus()
      expect(screen.getByLabelText('Location')).toHaveTextContent('/console/my-plan')
      expect(window.location.href).toBe(documentLocation)
    }
  } finally { route.migrated = previous }
})

test.each(['direct', 'nav'] as const)('ordinary %s navigation leaves focus off the destination heading', async (entry) => {
  login(['tenant_owner'])
  requests = strictFetch({ [`GET ${path}`]: allocationMixed })
  renderWithSession(<I18nProvider locale="es"><Routes><Route path="/console" element={<Shell />}>
    <Route path="my-plan" element={<h1>Origin heading</h1>} />
    <Route path="my-plan/allocation" element={<AllocationPage />} />
  </Route></Routes></I18nProvider>, { route: entry === 'nav' ? '/console/my-plan' : '/console/my-plan/allocation' })
  if (entry === 'nav') fireEvent.click(screen.getAllByRole('link', { name: es.title })[0])
  await screen.findByRole('table')
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
})

test('explicit focus waits for a lazy destination rather than its loading heading', async () => {
  login(['tenant_owner'])
  requests = strictFetch({ [`GET ${path}`]: allocationMixed })
  let release!: (value: { default: () => React.JSX.Element }) => void
  const Destination = lazy(() => new Promise<{ default: () => React.JSX.Element }>((resolve) => { release = resolve }))
  const route = pendingConsoleRoutes.find((item) => item.path === 'my-plan')!
  const previous = route.migrated
  route.migrated = true
  try {
    renderWithSession(<Routes><Route path="/console" element={<Shell />}>
      <Route path="my-plan/allocation" element={<AllocationPage />} />
      <Route path="my-plan" element={<Suspense fallback={<section aria-busy="true"><h1>Loading destination</h1></section>}><Destination /></Suspense>} />
    </Route></Routes>, { route: '/console/my-plan/allocation' })
    await screen.findByRole('table')
    fireEvent.click(within(document.querySelector('.allocation-summary')!).getByRole('link', { name: es.myPlan }))
    await act(async () => release({ default: () => <h1>Lazy destination heading</h1> }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lazy destination heading' })).toHaveFocus())
  } finally { route.migrated = previous }
})

test.each([false, true])('401 refresh rejected=%s uses shared transport and login intent', async (rejected) => {
  login(['tenant_owner'], ['synthetic-tenant'])
  let count = 0
  requests = strictFetch({
    [`GET ${path}`]: () => ++count === 1 ? fail(401) : Response.json(allocationMixed),
    [`POST ${refresh}`]: () => rejected ? fail(401) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter initialEntries={['/console/my-plan/allocation']}><Routes>
    <Route path="/console/my-plan/allocation" element={<ProtectedRoute><AllocationPage /></ProtectedRoute>} />
    <Route path="/login" element={<Location />} />
  </Routes></MemoryRouter>)
  if (rejected) {
    await waitFor(() => expect(readProtectedRouteIntent()).toBe('/console/my-plan/allocation'))
    expect(screen.getByLabelText('Location')).toHaveTextContent('/login')
    expect(calls()).toHaveLength(1)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  } else {
    await screen.findByRole('table')
    expect(calls()).toHaveLength(2)
    expect(new Headers(calls()[1][1]?.headers).get('Authorization')).toBe('Bearer synthetic-refreshed-access-token')
    expect(new Headers(calls()[0][1]?.headers).get('Authorization')).toBe('Bearer synthetic-access-token')
  }
  const refreshCalls = requests.mock.mock.calls.filter(([url]) => url === refresh)
  expect(refreshCalls).toHaveLength(1)
  expect(JSON.parse(String(refreshCalls[0][1]?.body))).toEqual({ refreshToken: 'synthetic-refresh-token' })
})

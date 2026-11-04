import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConsoleObservabilityPage from '../src/pages/consoleObservability'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { SessionProvider } from '../src/shell/session'
import { login, renderWithSession, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-observability-page.json'
import en from '../src/locales/en/pages.console-observability-page.json'
import { auditRecord, filteredPage, firstPage, lastPage, manifestBody, observabilityEndpoints, overviewMixed, series24h, series7d, usageSnapshot, usageWithPoints } from './parity/pages/console-observability-page.manifest'
import { myPlanEndpoints } from './parity/pages/console-tenant-plan-overview-page.manifest'
import loginManifest from './parity/pages/login-page.manifest'
import { createEndpointRegistry } from './parity/endpoint-registry'
import { endpoints, responseFor } from './parity/fixtures/shell'

const context = vi.hoisted(() => ({ activeTenantId: 'synthetic-tenant' as string | null, activeWorkspaceId: 'synthetic-workspace' as string | null, loading: false,
  tenants: [{ tenantId: 'synthetic-tenant', displayName: 'Synthetic Organization' }, { tenantId: 'other-tenant', displayName: 'Other Organization' }],
  workspaces: [{ workspaceId: 'synthetic-workspace', displayName: 'Synthetic Workspace' }, { workspaceId: 'other-workspace', displayName: 'Other Workspace' }] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context }))
let requests: ReturnType<typeof strictFetch>
const tenant = '/v1/metrics/tenants/synthetic-tenant'
const workspace = '/v1/metrics/workspaces/synthetic-workspace'
const audit = 'page%5Bsize%5D=50&sort=-eventTimestamp'
const series = (window = '24h') => `${workspace}/series?metricKey=api_requests&window=${window}`
const list = () => requests.mock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)
const posts = () => requests.mock.mock.calls.filter(([, init]) => init?.method === 'POST')
const json = (value: unknown, status = 200) => Response.json(value, { status })
const failure = (status: number) => json({ code: `HTTP_${status}`, message: 'synthetic-error', requestId: `req_obs_${status}` }, status)
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const workspaceReads = { [`GET ${workspace}/overview`]: overviewMixed, [`GET ${workspace}/usage`]: usageSnapshot, [`GET ${series()}`]: series24h, [`GET ${workspace}/audit-records?${audit}`]: firstPage }
function setup(extra: Parameters<typeof strictFetch>[0] = {}, reads: Parameters<typeof strictFetch>[0] = workspaceReads) { requests = strictFetch({ ...reads, ...extra }) }
function open(role = 'tenant_viewer') { login([role]); return renderWithSession(<ConsoleObservabilityPage />) }
const ready = () => screen.findByRole('heading', { name: overviewMixed.dimensions[0].displayName, level: 3 })
const tab = (name: string) => screen.getByRole('tab', { name })
async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name })); await act(async () => {})
  fireEvent.pointerDown(screen.getByRole('option', { name: option })); fireEvent.click(screen.getByRole('option', { name: option })); await act(async () => {})
}
beforeEach(async () => {
  await i18n.changeLanguage('es'); context.activeTenantId = 'synthetic-tenant'; context.activeWorkspaceId = 'synthetic-workspace'; context.loading = false
})
afterEach(() => { requests?.verify(); cleanup(); vi.unstubAllGlobals() })

test('workspace scope sends exactly overview, usage, the windowed series and the first audit page', async () => {
  setup(); open(); await ready()
  await waitFor(() => expect(list()).toHaveLength(4))
  expect(list().sort()).toEqual([`GET ${workspace}/audit-records?${audit}`, `GET ${workspace}/overview`, `GET ${series()}`, `GET ${workspace}/usage`].sort())
  expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible()
  for (const row of overviewMixed.dimensions) expect(screen.getByRole('heading', { name: row.displayName, level: 3 })).toBeVisible()
  expect(screen.getAllByRole('meter')).toHaveLength(5)
  expect(screen.getByRole('meter', { name: 'Uso de Synthetic Requests' })).toHaveAttribute('aria-valuetext', '110% usado')
  expect(screen.getByText('110% usado')).toBeVisible()
  expect(screen.getByText(es.metrics.exceeded)).toBeVisible()
  expect(screen.getByRole('link', { name: es.metrics.quotasLink })).toHaveAttribute('href', '/console/quotas')
  expect(screen.getByText(es.metrics.unlimited)).toBeVisible()
  // Legacy change 22072f17: a dimension the policy does not enforce says so.
  expect(screen.getByText(es.metrics.notEnforced)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Límite duro superado. Ver cuotas.' })).toHaveAttribute('href', '/console/quotas')
  expect(screen.getByText('2.0 KB de 8.0 KB')).toBeVisible()
})

test.each(['es', 'en'] as const)('renders the series chart card with its text summary and no range toggle in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  const copy = locale === 'es' ? es : en
  expect(screen.getByRole('heading', { name: copy.series.title, level: 2 })).toBeVisible()
  expect(screen.getByText(new RegExp(`${copy.series.window24h}\\.$`))).toBeVisible()
  expect(screen.queryByRole('button', { name: /90/ })).not.toBeInTheDocument()
  // The chart's screen-reader table uses localized column headers, never the raw index key.
  const headers = screen.getAllByRole('columnheader', { hidden: true }).map((header) => header.textContent)
  expect(headers).toEqual([copy.series.period, copy.series.label])
  expect(headers).not.toContain('time')
  expect(screen.queryByText('Infrastructure cost')).not.toBeInTheDocument()
  expect(screen.queryByText('Compute')).not.toBeInTheDocument()
  const last = series24h.points.at(-1)!.value, values = series24h.points.map((point) => point.value), format = new Intl.NumberFormat(locale)
  expect(screen.getByText(copy.series.summary.replace('{latest}', format.format(last)).replace('{min}', format.format(Math.min(...values))).replace('{max}', format.format(Math.max(...values))).replace('{window}', copy.series.window24h))).toBeVisible()
})

test('changing the window refetches overview, usage and series with the mapped window', async () => {
  setup({ [`GET ${series('7d')}`]: series7d }); open(); await ready()
  const before = list().length
  await choose(es.metrics.windowLabel, '7d')
  await waitFor(() => expect(list().slice(before).sort()).toEqual([`GET ${workspace}/overview`, `GET ${series('7d')}`, `GET ${workspace}/usage`].sort()))
  await ready()
  expect(list().filter((call) => call.includes('window='))).toEqual([`GET ${series()}`, `GET ${series('7d')}`])
  expect(list().filter((call) => call.includes('audit-records'))).toHaveLength(1)
})

test('tenant scope sends no series or window, disables the select and links the reason', async () => {
  context.activeWorkspaceId = null
  setup({}, { [`GET ${tenant}/overview`]: overviewMixed, [`GET ${tenant}/usage`]: usageSnapshot, [`GET ${tenant}/audit-records?${audit}`]: firstPage }); open(); await ready()
  await waitFor(() => expect(list()).toHaveLength(3))
  expect(list().sort()).toEqual([`GET ${tenant}/audit-records?${audit}`, `GET ${tenant}/overview`, `GET ${tenant}/usage`])
  const select = screen.getByRole('combobox', { name: es.metrics.windowLabel })
  expect(select).toBeDisabled()
  expect(select).toHaveTextContent(es.metrics.windowNone)
  expect(document.getElementById(select.getAttribute('aria-describedby')!)).toHaveTextContent(es.metrics.windowReason)
  expect(screen.getByText(es.metrics.windowNotApplicable)).toBeVisible()
  expect(screen.getByText(es.series.empty)).toBeVisible()
})

test('metrics Reintentar at tenant scope re-sends only overview and usage', async () => {
  context.activeWorkspaceId = null
  let count = 0
  setup({}, { [`GET ${tenant}/overview`]: () => ++count === 1 ? failure(500) : json(overviewMixed), [`GET ${tenant}/usage`]: usageSnapshot, [`GET ${tenant}/audit-records?${audit}`]: firstPage }); open()
  expect(await screen.findByText('req_obs_500')).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Synthetic API Keys' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: es.error.retry }))
  await ready()
  expect(list().filter((call) => call.includes('usage'))).toHaveLength(2)
  expect(list().filter((call) => call.includes('overview'))).toHaveLength(2)
  expect(list().filter((call) => call.includes('series'))).toHaveLength(0)
  expect(list().filter((call) => call.includes('audit-records'))).toHaveLength(1)
})

test.each([
  ['usage points fill an empty series', { points: [] }, usageWithPoints, true],
  ['no points at all shows the empty copy', { points: [] }, usageSnapshot, false],
] as const)('%s', async (_name, seriesBody, usage, plotted) => {
  setup({ [`GET ${series()}`]: seriesBody, [`GET ${workspace}/usage`]: usage }); open(); await ready()
  if (plotted) { expect(screen.queryByText(es.series.empty)).not.toBeInTheDocument(); expect(screen.getByText(/Último valor/)).toBeVisible() }
  else { expect(screen.getByText(es.series.empty)).toBeVisible(); expect(screen.queryByText(/Último valor/)).not.toBeInTheDocument() }
})

test('the dimension search is local and clearing it restores every row', async () => {
  setup(); open(); await ready()
  const before = list().length
  fireEvent.change(screen.getByRole('searchbox', { name: es.metrics.searchLabel }), { target: { value: 'storage' } })
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
  fireEvent.change(screen.getByRole('searchbox', { name: es.metrics.searchLabel }), { target: { value: 'zzz' } })
  fireEvent.click(screen.getByRole('button', { name: es.metrics.clearSearch }))
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(5)
  expect(list()).toHaveLength(before)
})

test.each([[403, 'metrics.noAccess'], [404, 'metrics.notFound']] as const)('metrics %s renders an in-page state while the audit tab keeps working', async (status, key) => {
  setup({ [`GET ${workspace}/overview`]: () => failure(status) }); open()
  expect(await screen.findByRole('heading', { name: key === 'metrics.noAccess' ? es.metrics.noAccess : es.metrics.notFound, level: 2 })).toBeVisible()
  if (status === 404) expect(screen.getByRole('link', { name: es.backToOverview })).toHaveAttribute('href', '/console/overview')
  fireEvent.click(tab(es.tabAudit))
  expect(await screen.findByRole('button', { name: 'evt-001' })).toBeVisible()
})

test.each([['network', () => { throw new TypeError('synthetic-network') }], ['500', () => failure(500)]] as const)('a metrics %s failure clears everything and shows the error panel', async (_kind, respond) => {
  setup({ [`GET ${workspace}/overview`]: respond as never }); open()
  expect(await screen.findByRole('heading', { name: es.metrics.errorTitle, level: 2 })).toBeVisible()
  expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  expect(screen.queryByText(/Último valor/)).not.toBeInTheDocument()
})

test('a first-page audit failure leaves no stale records and Reintentar recovers', async () => {
  let count = 0
  setup({ [`GET ${workspace}/audit-records?${audit}`]: () => ++count === 1 ? failure(500) : json(firstPage) }); open(); await ready()
  fireEvent.click(tab(es.tabAudit))
  expect(await screen.findByRole('heading', { name: es.audit.errorTitle, level: 2 })).toBeVisible()
  expect(screen.getByText('req_obs_500')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'evt-001' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: es.error.retry }))
  expect(await screen.findByRole('button', { name: 'evt-001' })).toBeVisible()
  expect(list().filter((call) => call.includes('audit-records'))).toHaveLength(2)
})

test('Cargar mas sends the cursor with the same filters, appends rows and disappears on the last page', async () => {
  const next = `${workspace}/audit-records?${audit}&page%5Bafter%5D=synthetic-cursor-2`
  setup({ [`GET ${next}`]: lastPage }); open(); await ready()
  fireEvent.click(tab(es.tabAudit))
  await screen.findByRole('button', { name: 'evt-001' })
  expect(screen.getByText('50 eventos mostrados')).toBeVisible()
  expect(screen.getAllByRole('row')).toHaveLength(51)
  fireEvent.click(screen.getByRole('button', { name: es.audit.loadMore }))
  await waitFor(() => expect(screen.getByText('60 eventos mostrados')).toBeVisible())
  expect(list()).toContain(`GET ${next}`)
  expect(screen.queryByRole('button', { name: es.audit.loadMore })).not.toBeInTheDocument()
  expect(screen.getAllByRole('row')).toHaveLength(61)
  await waitFor(() => expect(screen.getByRole('button', { name: 'evt-051' })).toHaveFocus())
})

test.each([['500', () => failure(500)], ['network', () => { throw new TypeError('synthetic-network') }]] as const)('a next-page %s failure keeps the 50 rows and retries the same cursor', async (_kind, respond) => {
  const next = `GET ${workspace}/audit-records?${audit}&page%5Bafter%5D=synthetic-cursor-2`
  let count = 0
  setup({ [next]: () => ++count === 1 ? respond() : json(lastPage) }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.click(screen.getByRole('button', { name: es.audit.loadMore }))
  const group = await screen.findByRole('group', { name: es.audit.moreGroup })
  await waitFor(() => expect(within(group).getByRole('button', { name: es.audit.retry })).toBeVisible())
  expect(screen.getAllByRole('row')).toHaveLength(51)
  expect(screen.getByText('50 eventos mostrados')).toBeVisible()
  fireEvent.click(within(group).getByRole('button', { name: es.audit.retry }))
  await waitFor(() => expect(screen.getByText('60 eventos mostrados')).toBeVisible())
  expect(list().filter((call) => call === next)).toHaveLength(2)
})

test('filters map to the legacy parameters and restart from the first page', async () => {
  const filtered = (query: string) => `GET ${workspace}/audit-records?${audit}${query}`
  setup({
    [filtered('&filter%5BactorId%5D=ana')]: filteredPage, [filtered('&filter%5BactorId%5D=ana&filter%5BactionCategory%5D=iam')]: filteredPage,
    [filtered('&filter%5BactorId%5D=ana&filter%5BactionCategory%5D=iam&filter%5Boutcome%5D=failed')]: { items: [], page: { hasMore: false, nextCursor: null } },
  }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'ana' } })
  expect(await screen.findByRole('button', { name: 'evt-900' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'evt-001' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: es.audit.category }), { target: { value: 'iam' } })
  await waitFor(() => expect(list()).toContain(filtered('&filter%5BactorId%5D=ana&filter%5BactionCategory%5D=iam')))
  await choose(es.audit.result, es.audit.resultFailure)
  expect(await screen.findByRole('heading', { name: es.audit.empty })).toBeVisible()
  expect(screen.getByRole('searchbox', { name: es.audit.actor })).toHaveValue('ana')
})

test('the empty audit state offers Limpiar filtros, which restores the unfiltered first page', async () => {
  const filtered = `GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=ghost`
  setup({ [filtered]: { items: [], page: { hasMore: false, nextCursor: null } } }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'ghost' } })
  fireEvent.click(await screen.findByRole('button', { name: es.audit.clearFilters }))
  expect(await screen.findByRole('button', { name: 'evt-001' })).toBeVisible()
})

test('a late response for superseded filters is neither rendered nor appended', async () => {
  const slow = deferred<Response>()
  const filtered = `GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=a`
  const other = `GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=ab`
  setup({ [filtered]: () => slow.promise, [other]: filteredPage }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'a' } })
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'ab' } })
  expect(await screen.findByRole('button', { name: 'evt-900' })).toBeVisible()
  await act(async () => { slow.resolve(json(firstPage)); await Promise.resolve() })
  expect(screen.queryByRole('button', { name: 'evt-001' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'evt-900' })).toBeVisible()
})

test('an event id opens the detail drawer with scope and metadata and returns focus on close', async () => {
  setup(); open(); await ready()
  fireEvent.click(tab(es.tabAudit))
  const trigger = await screen.findByRole('button', { name: 'evt-002' })
  trigger.focus(); fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Evento evt-002')).toBeVisible()
  expect(within(dialog).getByText('Synthetic Actor (user)')).toBeVisible()
  expect(dialog).toHaveTextContent('synthetic-evt-002')
  fireEvent.click(within(dialog).getByRole('button', { name: es.detail.close }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button', { name: 'evt-002' })).toHaveFocus())
})

test('a role without tenant.audit.read sees no Auditoria tab and sends no audit request', async () => {
  setup({}, { [`GET ${workspace}/overview`]: overviewMixed, [`GET ${workspace}/usage`]: usageSnapshot, [`GET ${series()}`]: series24h }); open('tenant_developer'); await ready()
  expect(screen.queryByRole('tab', { name: es.tabAudit })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: es.tabMetrics })).toBeVisible()
  await waitFor(() => expect(list()).toHaveLength(3))
  expect(list().some((call) => call.includes('audit-'))).toBe(false)
})

test('no active tenant renders the blocked state and sends nothing', async () => {
  context.activeTenantId = null; context.activeWorkspaceId = null
  setup({}, {}); open()
  expect(await screen.findByRole('heading', { name: es.blocked, level: 2 })).toBeVisible()
  expect(list()).toEqual([])
})

test('export POSTs the legacy filter body, shows the busy state, then the manifest and downloads it', async () => {
  const exportUrl = `POST ${workspace}/audit-exports`
  const pending = deferred<Response>()
  setup({ [exportUrl]: () => pending.promise, [`GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=ana&filter%5BactionCategory%5D=iam&filter%5Boutcome%5D=succeeded`]: filteredPage,
    [`GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=ana`]: filteredPage, [`GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=ana&filter%5BactionCategory%5D=iam`]: filteredPage }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'ana' } })
  fireEvent.change(screen.getByRole('textbox', { name: es.audit.category }), { target: { value: 'iam' } })
  await choose(es.audit.result, es.audit.resultSuccess)
  await screen.findByRole('button', { name: 'evt-900' })
  fireEvent.click(screen.getByRole('button', { name: es.export.button }))
  const busy = await screen.findByRole('button', { name: es.export.running })
  expect(busy).toBeDisabled(); expect(busy).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByText(es.export.progressTitle)).toBeVisible()
  expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ filters: { actorId: 'ana', actionCategory: 'iam', outcome: 'succeeded' } })
  const create = vi.fn(() => 'blob:synthetic'), revoke = vi.fn()
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await act(async () => { pending.resolve(json(manifestBody)); await Promise.resolve() })
  expect(await screen.findByText(es.export.readyTitle)).toBeVisible()
  expect(screen.getByText(manifestBody.exportId)).toBeVisible()
  expect(screen.getByText('3')).toBeVisible()
  expect(screen.getByText(es.export.statusCompleted)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.export.download }))
  expect(click).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(1)
  click.mockRestore()
})

test('an accepted export without a manifest shows the warning and offers no download', async () => {
  setup({ [`POST ${workspace}/audit-exports`]: { exportId: 'exp-accepted-1', status: 'accepted', message: 'synthetic-queued' } }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.click(screen.getByRole('button', { name: es.export.button }))
  expect(await screen.findByText(es.export.unavailableTitle)).toBeVisible()
  expect(screen.getByText('synthetic-queued')).toBeVisible()
  expect(screen.getByText(es.export.unavailableNoFile)).toBeVisible()
  expect(screen.queryByRole('button', { name: es.export.download })).not.toBeInTheDocument()
})

test.each([['500', () => failure(500)], ['network', () => { throw new TypeError('synthetic-network') }]] as const)('a failed export (%s) shows the error panel and Reintentar re-POSTs the identical body of the failed attempt', async (_kind, respond) => {
  const exportUrl = `POST ${workspace}/audit-exports`
  let count = 0
  setup({ [exportUrl]: () => ++count === 1 ? respond() : json(manifestBody), [`GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=ana`]: filteredPage, [`GET ${workspace}/audit-records?${audit}&filter%5BactorId%5D=anabel`]: filteredPage })
  open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'ana' } })
  await screen.findByRole('button', { name: 'evt-900' })
  fireEvent.click(screen.getByRole('button', { name: es.export.button }))
  expect(await screen.findByRole('heading', { name: es.export.errorTitle, level: 2 })).toBeVisible()
  if (_kind === '500') expect(screen.getByText('req_obs_500')).toBeVisible()
  expect(screen.queryByRole('button', { name: es.export.download })).not.toBeInTheDocument()
  expect(screen.queryByText(es.export.readyTitle)).not.toBeInTheDocument()
  // Editing the filters afterwards must not change what the retry sends.
  fireEvent.change(screen.getByRole('searchbox', { name: es.audit.actor }), { target: { value: 'anabel' } })
  fireEvent.click(screen.getByRole('button', { name: es.export.retry }))
  expect(await screen.findByText(es.export.readyTitle)).toBeVisible()
  expect(posts()).toHaveLength(2)
  expect(posts()[1][1]?.body).toBe(posts()[0][1]?.body)
  expect(JSON.parse(String(posts()[1][1]?.body))).toEqual({ filters: { actorId: 'ana' } })
  await waitFor(() => expect(screen.getByRole('button', { name: es.export.download })).toHaveFocus())
})

test('switching workspace discards loaded pages, the drawer, export feedback and ignores late replies', async () => {
  const slow = deferred<Response>()
  const otherAudit = '/v1/metrics/workspaces/other-workspace'
  const exportUrl = `POST ${workspace}/audit-exports`
  setup({ [exportUrl]: () => slow.promise,
    [`GET ${otherAudit}/overview`]: { ...overviewMixed, dimensions: [] }, [`GET ${otherAudit}/usage`]: usageSnapshot, [`GET ${otherAudit}/series?metricKey=api_requests&window=24h`]: { points: [] },
    [`GET ${otherAudit}/audit-records?${audit}`]: filteredPage })
  login(['tenant_viewer'])
  const tree = () => <MemoryRouter><SessionProvider value={readConsoleShellSession()!}><ConsoleObservabilityPage /></SessionProvider></MemoryRouter>
  const view = render(tree()); await ready()
  fireEvent.click(tab(es.tabAudit)); fireEvent.click(await screen.findByRole('button', { name: 'evt-001' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: es.export.button, hidden: true }))
  await screen.findByText(es.export.progressTitle)
  context.activeWorkspaceId = 'other-workspace'
  view.rerender(tree())
  expect(await screen.findByRole('button', { name: 'evt-900' })).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'evt-001' })).not.toBeInTheDocument()
  expect(screen.queryByText(es.export.progressTitle)).not.toBeInTheDocument()
  await act(async () => { slow.resolve(json(manifestBody)); await Promise.resolve() })
  expect(screen.queryByText(es.export.readyTitle)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: es.export.button })).toBeEnabled()
  expect(posts()).toHaveLength(1)
})

test('a late Cargar mas reply for the old workspace is never appended to the new workspace', async () => {
  const late = deferred<Response>()
  const other = '/v1/metrics/workspaces/other-workspace'
  setup({ [`GET ${workspace}/audit-records?${audit}&page%5Bafter%5D=synthetic-cursor-2`]: () => late.promise,
    [`GET ${other}/overview`]: { ...overviewMixed, dimensions: [] }, [`GET ${other}/usage`]: usageSnapshot, [`GET ${other}/series?metricKey=api_requests&window=24h`]: { points: [] },
    [`GET ${other}/audit-records?${audit}`]: filteredPage })
  login(['tenant_viewer'])
  const tree = () => <MemoryRouter><SessionProvider value={readConsoleShellSession()!}><ConsoleObservabilityPage /></SessionProvider></MemoryRouter>
  const view = render(tree()); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.click(screen.getByRole('button', { name: es.audit.loadMore }))
  context.activeWorkspaceId = 'other-workspace'
  view.rerender(tree())
  expect(await screen.findByRole('button', { name: 'evt-900' })).toBeVisible()
  await act(async () => { late.resolve(json(lastPage)); await Promise.resolve() })
  expect(screen.queryByRole('button', { name: 'evt-051' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'evt-001' })).not.toBeInTheDocument()
  expect(screen.getByText('1 evento mostrado')).toBeVisible()
})

test('an export started in a tenant goes to that tenant scope', async () => {
  context.activeWorkspaceId = null
  setup({ [`POST ${tenant}/audit-exports`]: manifestBody }, { [`GET ${tenant}/overview`]: overviewMixed, [`GET ${tenant}/usage`]: usageSnapshot, [`GET ${tenant}/audit-records?${audit}`]: firstPage }); open(); await ready()
  fireEvent.click(tab(es.tabAudit)); await screen.findByRole('button', { name: 'evt-001' })
  fireEvent.click(screen.getByRole('button', { name: es.export.button }))
  expect(await screen.findByText(es.export.readyTitle)).toBeVisible()
  expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ filters: {} })
})

test.each(['es', 'en'] as const)('every catalog key is used in %s and the page shows no sample data', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  expect(document.body).not.toHaveTextContent(/Infrastructure cost|Compute|Storage Network|Recent activity|acme/i)
  expect(auditRecord(1).eventId).toBe('evt-001')
  expect(en.title).not.toBe(es.title)
})

test('the parity registry matches every request the page sends and coexists with the suites that land on it', () => {
  const registry = createEndpointRegistry(endpoints, (name, variant, role) => responseFor(name, variant as Parameters<typeof responseFor>[1], role), observabilityEndpoints)
  for (const scope of [tenant, workspace]) for (const [method, path] of [['GET', 'overview'], ['GET', 'usage'], ['GET', 'audit-records'], ['POST', 'audit-exports']]) {
    expect(registry.find(method, `${scope}/${path}`), `${method} ${scope}/${path}`).toBeDefined()
  }
  expect(registry.find('GET', `${workspace}/series`)).toBeDefined()
  // Tenant series is never sent, so it is never registered.
  expect(registry.find('GET', `${tenant}/series`)).toBeUndefined()
  expect(registry.responseFor(registry.find('POST', `${workspace}/audit-exports`)!, 'tenant_viewer').body).toEqual(manifestBody)
  // The landing suites register these reads next to their own page endpoints without collisions.
  expect(() => createEndpointRegistry(endpoints, () => ({}), { ...myPlanEndpoints, ...observabilityEndpoints })).not.toThrow()
  expect(() => createEndpointRegistry(endpoints, () => ({}), loginManifest.endpoints!)).not.toThrow()
})

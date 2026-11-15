import { StrictMode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { ConsoleContextProvider, useConsoleContext } from '../src/shell/context'
import { PermissionsProvider } from '../src/shell/permissions'
import ConsoleKafkaPage from '../src/pages/consoleKafka'
import i18n from '../src/i18n'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { fixtures, paths, mockInventory, mockTopicDetail, streamEvents } from './parity/pages/console-kafka-page.manifest'
import es from '../src/locales/es/pages.console-kafka-page.json'
import en from '../src/locales/en/pages.console-kafka-page.json'

let requests: ReturnType<typeof strictFetch>
const copy = (locale: string) => locale === 'es' ? es : en
const pageCalls = () => requests.mock.mock.calls.filter(([url]) => String(url).startsWith('/v1/events/'))
const callsTo = (url: string) => pageCalls().filter(([path]) => path === url)
function setup(extra: Parameters<typeof strictFetch>[0] = {}) {
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${paths.inventory}`]: fixtures['kafka:inventory-3-with-bridges'], [`GET ${paths.bridge}`]: fixtures['kafka:bridge-1'],
    [`GET ${paths.detail}`]: fixtures['kafka:topic-detail'], [`GET ${paths.access}`]: fixtures['kafka:topic-access'], [`GET ${paths.metadata}`]: fixtures['kafka:topic-metadata'], ...extra })
}
function SwitchWorkspace() { const context = useConsoleContext(); return <button onClick={() => context.selectWorkspace('synthetic-other')}>Switch workspace</button> }
function open(withSwitch = false) { return renderWithSession(<StrictMode><ConsoleContextProvider routeWorkspaceId={withSwitch ? 'synthetic-workspace' : undefined}><PermissionsProvider><ConsoleKafkaPage />{withSwitch ? <SwitchWorkspace /> : null}</PermissionsProvider></ConsoleContextProvider></StrictMode>) }
const select = async () => { fireEvent.click(await screen.findByRole('button', { name: 'orders.created' })); await screen.findByRole('heading', { name: 'orders.created' }) }
const tab = (name: string) => { fireEvent.click(screen.getByRole('tab', { name })) }
const failure = (status: number) => Response.json({ message: 'Raw backend error', requestId: 'kafka-request-123' }, { status })
beforeEach(() => { login() })
afterEach(() => { requests?.verify() })

test.each(['es', 'en'])('inventory, independent topic reads and every detail field preserve legacy values in %s', async (locale) => {
  await i18n.changeLanguage(locale); const c = copy(locale); setup(); open(); await select()
  const kpis = screen.getByLabelText(c.kafkaTopics, { selector: 'dl' })
  expect(kpis).toHaveTextContent(c.total); expect(kpis).toHaveTextContent(c.active); expect(kpis).toHaveTextContent(c.provisioning); expect(kpis).toHaveTextContent(c.degraded)
  for (const name of ['evt.ten_alpha.orders.created', '/events/orders', 'res_topic_1', '4096', 'Gzip', 'S3', 'Cg.Ten Alpha.']) expect(screen.getAllByText(name, { exact: true }).length).toBeGreaterThan(0)
  expect(await screen.findByText(c.noStatusHistory)).toBeVisible(); expect(screen.getByRole('meter', { name: c.quotas })).toHaveAttribute('aria-valuenow', '100')
  tab(c.tabs.access); expect(await screen.findByText('svc-orders')).toBeVisible(); expect(screen.getByText('svc-denied')).toBeVisible()
  tab(c.tabs.metadata); expect(await screen.findByText('Cg-Orders')).toBeVisible(); expect(screen.getByText(/Metadata parcial/)).toBeVisible()
  expect(pageCalls().map(([path]) => path).sort()).toEqual([paths.inventory, paths.bridge, paths.detail, paths.access, paths.metadata].sort())
  expect(screen.queryByText('Raw backend error')).toBeNull(); expect(screen.queryByRole('searchbox', { name: '' })).toBeNull()
})
test('all 120 topics render without paging and total falls back to the item count', async () => {
  setup({ [`GET ${paths.inventory}`]: fixtures['kafka:inventory-120'] }); open()
  const table = await screen.findByRole('table', { name: es.kafkaTopics })
  expect(within(table).getAllByRole('row')).toHaveLength(121)
  expect(screen.getByLabelText(es.kafkaTopics, { selector: 'dl' })).toHaveTextContent('120')
  expect(screen.queryByRole('button', { name: /next page|siguiente página/i })).toBeNull()
})
test.each(['es', 'en'])('KPI topics fallback, zero defaults and count-only bridges preserve copy in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup({ [`GET ${paths.inventory}`]: mockInventory({ counts: { topics: 8 }, items: [{ ...fixtures['kafka:inventory-3-with-bridges'].items[0], operationalMetadata: { bridgeCount: 2 } }] }) }); open()
  expect(await screen.findByText(copy(locale).theBridgeListRequiresIdsExposedByTheInventory)).toBeVisible()
  expect(screen.getByLabelText(copy(locale).kafkaTopics, { selector: 'dl' })).toHaveTextContent('8')
  expect(callsTo(paths.bridge)).toHaveLength(0)
})
test.each(['es', 'en'])('empty inventory, bridges and selection placeholders are localized in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup({ [`GET ${paths.inventory}`]: fixtures['kafka:inventory-empty'] }); open()
  for (const key of ['thereAreNoTopicsInThisWorkspace', 'thereAreNoBridgesConfiguredInThisWorkspace', 'selectATopicFromTheInventoryToReviewDetailAccessMetadataPublishEventsOrOpenAnSseStream'] as const) expect(await screen.findByText(copy(locale)[key])).toBeVisible()
  expect(pageCalls()).toHaveLength(1)
})
test.each(['es', 'en'])('legacy metadata fallbacks retain lag, retention and compaction in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup({ [`GET ${paths.metadata}`]: fixtures['kafka:topic-metadata-legacy-fields'] }); open(); await select(); tab(copy(locale).tabs.metadata)
  expect(await screen.findAllByText('44', { exact: true })).toHaveLength(2)
  expect(screen.getByText('48', { exact: true })).toBeVisible(); expect(screen.getByText('1234', { exact: true })).toBeVisible(); expect(screen.getByText(copy(locale).providerManaged)).toBeVisible()
})
test.each(['es', 'en'].flatMap((locale) => [500, 'network'].map((status) => ({ locale, status }))))('inventory $status has request ID or network copy, scoped retry and recovery in $locale', async ({ locale, status }) => {
  await i18n.changeLanguage(locale); const c = copy(locale); let attempts = 0
  setup({ [`GET ${paths.inventory}`]: () => { if (++attempts > 1) return Response.json(fixtures['kafka:inventory-empty']); if (status === 'network') throw new TypeError('Raw network error'); return failure(500) } }); open()
  expect(await screen.findByRole('heading', { name: c.couldNotLoadTheKafkaInventory })).toBeVisible()
  if (status === 500) expect(screen.getByText('kafka-request-123')).toBeVisible()
  else expect(screen.getAllByText(c.couldNotLoadTheKafkaInventory).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: c.retry })); await screen.findByText(c.thereAreNoTopicsInThisWorkspace)
  expect(callsTo(paths.inventory)).toHaveLength(2); expect(screen.queryByText('Raw network error')).toBeNull()
})
test.each(['es', 'en'])('inventory 403 is localized and sends no sibling request in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup({ [`GET ${paths.inventory}`]: () => failure(403) }); open()
  expect(await screen.findByText(copy(locale).youDoNotHaveAccessToTheKafkaInventory)).toBeVisible(); expect(pageCalls()).toHaveLength(1)
})
const sections = [
  { key: 'bridge', tab: null, title: 'couldNotLoadTheBridgeList', success: 'orders_outbox' },
  { key: 'detail', tab: 'detail', title: 'couldNotLoadTheTopicDetail', success: '/events/orders' },
  { key: 'access', tab: 'access', title: 'couldNotLoadTheTopicAccessPolicy', success: 'svc-orders' },
  { key: 'metadata', tab: 'metadata', title: 'couldNotLoadTheTopicOperationalMetadata', success: 'cg-orders' },
] as const
test.each(['es', 'en'].flatMap((locale) => sections.map((section) => ({ locale, ...section }))))('$key error has request ID, isolated retry, focus and preserved siblings in $locale', async ({ locale, key, tab: tabName, title, success }) => {
  await i18n.changeLanguage(locale); const c = copy(locale); let attempts = 0
  const fixtureKey = { bridge: 'kafka:bridge-1', detail: 'kafka:topic-detail', access: 'kafka:topic-access', metadata: 'kafka:topic-metadata' } as const
  setup({ [`GET ${paths[key]}`]: () => ++attempts === 1 ? failure(500) : Response.json(fixtures[fixtureKey[key]]) }); open(); await select()
  if (tabName) tab(c.tabs[tabName]); await screen.findByRole('heading', { name: c[title] })
  expect(screen.getByText('kafka-request-123')).toBeVisible(); const before = pageCalls().length
  const retry = screen.getByRole('button', { name: c.retry }); retry.focus(); fireEvent.click(retry)
  await waitFor(() => expect(callsTo(paths[key])).toHaveLength(2)); await waitFor(() => expect(screen.queryByRole('heading', { name: c[title] })).toBeNull())
  expect(screen.getAllByText(new RegExp(success, 'i')).length).toBeGreaterThan(0); expect(pageCalls()).toHaveLength(before + 1)
  if (tabName !== 'detail') { tab(c.tabs.detail); expect(await screen.findByText('/events/orders')).toBeVisible() }
})
test.each(['es', 'en'].flatMap((locale) => ['access', 'metadata'].map((key) => ({ locale, key }))))('$key 403 leaves detail intact in $locale', async ({ locale, key }) => {
  await i18n.changeLanguage(locale); const c = copy(locale); setup({ [`GET ${paths[key as 'access' | 'metadata']}`]: () => failure(403) }); open(); await select(); tab(c.tabs[key as 'access' | 'metadata'])
  expect(await screen.findByText(key === 'access' ? c.youDoNotHaveAccessToTheTopicAccessPolicy : c.youDoNotHaveAccessToTheTopicOperationalMetadata)).toBeVisible()
  tab(c.tabs.detail); expect(await screen.findByText('/events/orders')).toBeVisible()
})
test('a deleted topic has a keyboard reachable way back to the inventory', async () => {
  setup({ [`GET ${paths.detail}`]: () => failure(404) }); open(); await select()
  expect(await screen.findByText(es.theTopicIsNoLongerAvailable)).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: es.backToInventory }))
  expect(await screen.findByText(es.selectATopicFromTheInventoryToReviewDetailAccessMetadataPublishEventsOrOpenAnSseStream)).toBeVisible()
})
test.each(['es', 'en'].flatMap((locale) => [false, true].map((limited) => ({ locale, limited }))))('publish preserves request shape, focus and announcements (limited=$limited) in $locale', async ({ locale, limited }) => {
  await i18n.changeLanguage(locale); const c = copy(locale)
  setup({ [`POST ${paths.publish}`]: () => limited ? failure(429) : Response.json(fixtures['kafka:publish-accepted']) }); open(); await select(); tab(c.tabs.publish)
  fireEvent.change(screen.getByLabelText(c.jsonPayload), { target: { value: '{"a":1}' } }); fireEvent.change(screen.getByLabelText(c.eventType), { target: { value: 'com.example.event' } })
  const button = screen.getByRole('button', { name: c.publishEvent }); button.focus(); fireEvent.click(button)
  if (limited) expect(await screen.findByText(c.checkDetailQuotasToVerifyLimitsOrLimitEnforcement)).toBeVisible()
  else { expect(await screen.findByText('pub_123')).toBeVisible(); expect(screen.getByText('2026-03-29T06:45:00.000Z')).toBeVisible() }
  expect(button).toHaveFocus(); expect(callsTo(paths.publish)).toHaveLength(1)
  const init = callsTo(paths.publish)[0][1]!; expect(init.method).toBe('POST'); expect(JSON.parse(String(init.body))).toEqual({ payload: { a: 1 }, eventType: 'com.example.event', contentType: 'application/json' })
})
test.each(['raw text', '', '  ', 'null', '5'])('publish accepts legacy payload %j and omits emptied optional fields', async (payload) => {
  setup({ [`POST ${paths.publish}`]: fixtures['kafka:publish-accepted'] }); open(); await select(); tab(es.tabs.publish)
  fireEvent.change(screen.getByLabelText(es.jsonPayload), { target: { value: payload } }); fireEvent.change(screen.getByLabelText(es.contentType), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: es.publishEvent }))
  await screen.findByText('pub_123'); expect(JSON.parse(String(callsTo(paths.publish)[0][1]?.body))).toEqual({ payload: payload === 'null' ? null : payload === '5' ? 5 : payload })
})

function streamResponse(content: string, dropped = false) {
  let source!: ReadableStreamDefaultController<Uint8Array>; let cancelled = false
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; if (content) controller.enqueue(new TextEncoder().encode(content)) }, cancel() { cancelled = true } })
  return { response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), drop: () => source.error(new TypeError('Synthetic dropped connection')), cancelled: () => cancelled, source }
}
test.each(['es', 'en'])('stream bearer, newest-first 100-event cap, burst warning, stop, reconnect and focus in %s', async (locale) => {
  await i18n.changeLanguage(locale); const c = copy(locale); const stream = streamResponse(streamEvents(105))
  setup({ [`GET ${paths.stream}`]: () => stream.response }); const view = open(); await select(); tab(c.tabs.stream)
  const toggle = screen.getByRole('button', { name: c.startStream }); toggle.focus(); fireEvent.click(toggle)
  await screen.findByText(c.highEventVolumeTheDisplayMayLagBehindTheBroker)
  expect(toggle).toHaveAccessibleName(c.stopStream); expect(toggle).toHaveFocus(); const log = screen.getByRole('log'); expect(log).toHaveAttribute('aria-live', 'off')
  expect(within(log).queryByText(/key-0 ·/)).toBeNull(); expect(within(log).getByText(/key-104/)).toBeVisible()
  expect(callsTo(paths.stream)[0][1]?.signal?.aborted).toBe(false); expect(new Headers(callsTo(paths.stream)[0][1]?.headers).get('Authorization')).toContain('Bearer ')
  fireEvent.click(toggle); expect(toggle).toHaveAccessibleName(c.startStream); expect(toggle).toHaveFocus()
  await waitFor(() => expect(stream.cancelled()).toBe(true)); expect(callsTo(paths.stream)[0][1]?.signal?.aborted).toBe(true)
  view.unmount()
})
test.each(['es', 'en'].flatMap((locale) => [401, 503].map((status) => ({ locale, status }))))('stream $status is localized, assertive and never refreshes or logs out in $locale', async ({ locale, status }) => {
  await i18n.changeLanguage(locale); const c = copy(locale); setup({ [`GET ${paths.stream}`]: () => failure(status) }); open(); await select(); tab(c.tabs.stream)
  const toggle = screen.getByRole('button', { name: c.startStream }); toggle.focus(); fireEvent.click(toggle)
  expect(await screen.findByText(status === 401 ? c.errors.unauthorized : c.errors.server)).toBeVisible()
  expect(toggle).toHaveAccessibleName(c.startStream); expect(toggle).toHaveFocus(); expect(sessionStorage.getItem('in-falcone.console-shell-session')).not.toBeNull()
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(0)
})
test.each(['es', 'en'])('stream without a token sends no request in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await select(); tab(copy(locale).tabs.stream); sessionStorage.removeItem('in-falcone.console-shell-session')
  fireEvent.click(screen.getByRole('button', { name: copy(locale).startStream })); expect(await screen.findByText(copy(locale).sessionUnavailableSignInAgain)).toBeVisible(); expect(callsTo(paths.stream)).toHaveLength(0)
})
test('a dropped stream can reconnect, while topic change and unmount cancel active readers', async () => {
  let stream = streamResponse(''); setup({ [`GET ${paths.stream}`]: () => stream.response, 'GET /v1/events/topics/res_topic_2': mockTopicDetail(), 'GET /v1/events/topics/res_topic_2/access': fixtures['kafka:topic-access'], 'GET /v1/events/topics/res_topic_2/metadata': fixtures['kafka:topic-metadata'] }); const view = open(); await select(); tab(es.tabs.stream)
  const toggle = screen.getByRole('button', { name: es.startStream }); toggle.focus(); fireEvent.click(toggle); await screen.findAllByText(es.listeningForEvents)
  await act(async () => stream.drop()); expect(await screen.findByText(es.theStreamConnectionFailed)).toBeVisible(); expect(toggle).toHaveFocus()
  stream = streamResponse(''); fireEvent.click(toggle); await waitFor(() => expect(callsTo(paths.stream)).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: 'orders.pending' })); await waitFor(() => expect(stream.cancelled()).toBe(true))
  await select(); tab(es.tabs.stream); stream = streamResponse(''); fireEvent.click(screen.getByRole('button', { name: es.startStream })); await waitFor(() => expect(callsTo(paths.stream)).toHaveLength(3)); view.unmount(); await waitFor(() => expect(stream.cancelled()).toBe(true))
})
test('SSE frames split between chunks are buffered and aborting before headers ignores stale responses', async () => {
  const stream = streamResponse('data: {"pay'); let response: Response | Promise<Response> = stream.response
  setup({ [`GET ${paths.stream}`]: () => response }); open(); await select(); tab(es.tabs.stream); fireEvent.click(screen.getByRole('button', { name: es.startStream }))
  await act(async () => { stream.source.enqueue(new TextEncoder().encode('load":{"split":true}}\n\n')) }); expect(await screen.findByText(/"split":true/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.stopStream })); await waitFor(() => expect(stream.cancelled()).toBe(true))
  let release!: (response: Response) => void
  response = new Promise<Response>((resolve) => { release = resolve })
  fireEvent.click(screen.getByRole('button', { name: es.startStream })); await waitFor(() => expect(callsTo(paths.stream)).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: es.stopStream })); const late = streamResponse('data: {"late":true}\n\n')
  await act(async () => release(late.response)); await waitFor(() => expect(late.cancelled()).toBe(true))
  expect(screen.getByRole('button', { name: es.startStream })).toBeVisible(); expect(screen.queryByText(/"late":true/)).toBeNull()

})

test('pending inventory and each topic section render localized skeletons without sample values', async () => {
  let releaseInventory!: (response: Response) => void
  setup({ [`GET ${paths.inventory}`]: () => new Promise<Response>((resolve) => { releaseInventory = resolve }), [`GET ${paths.detail}`]: () => new Promise<Response>(() => {}), [`GET ${paths.access}`]: () => new Promise<Response>(() => {}), [`GET ${paths.metadata}`]: () => new Promise<Response>(() => {}) }); open()
  expect(await screen.findAllByText(es.loadingInventory)).toHaveLength(2)
  expect(screen.queryByText('Acme')).toBeNull()
  await act(async () => releaseInventory(Response.json(fixtures['kafka:inventory-3-with-bridges']))); await select()
  expect((await screen.findByText(es.loadingDetail)).closest('[role=status]')).toHaveAttribute('aria-busy', 'true')
  tab(es.tabs.access); expect((await screen.findByText(es.loadingAccessPolicy)).closest('[role=status]')).toHaveAttribute('aria-busy', 'true')
  tab(es.tabs.metadata); expect((await screen.findByText(es.loadingOperationalMetadata)).closest('[role=status]')).toHaveAttribute('aria-busy', 'true')
})
test('section retry retains focus while pending and does not refetch sibling endpoints', async () => {
  let attempts = 0, release!: (response: Response) => void
  setup({ [`GET ${paths.access}`]: () => ++attempts === 1 ? failure(500) : new Promise<Response>((resolve) => { release = resolve }) }); open(); await select(); tab(es.tabs.access)
  const retry = await screen.findByRole('button', { name: es.retry }); retry.focus(); fireEvent.click(retry)
  expect(retry).toHaveFocus(); expect(await screen.findByRole('button', { name: es.retrying })).toBe(retry)
  await act(async () => release(Response.json(fixtures['kafka:topic-access']))); expect(await screen.findByText('svc-orders')).toBeVisible()
  expect(callsTo(paths.access)).toHaveLength(2); expect(callsTo(paths.detail)).toHaveLength(1); expect(callsTo(paths.metadata)).toHaveLength(1)
})
test('tabs follow the arrow-key pattern and retain a visible keyboard focus class', async () => {
  setup(); open(); await select(); const detail = screen.getByRole('tab', { name: es.tabs.detail }); detail.focus()
  fireEvent.keyDown(detail, { key: 'ArrowRight' }); await waitFor(() => expect(screen.getByRole('tab', { name: es.tabs.access })).toHaveFocus())
  expect(screen.getByRole('tab', { name: es.tabs.access }).className).toContain('focus-visible:outline-focus-ring')
})
test('leaving a topic aborts a pending detail read and a late response cannot replace the new topic', async () => {
  let release!: (response: Response) => void
  setup({ [`GET ${paths.detail}`]: () => new Promise<Response>((resolve) => { release = resolve }), 'GET /v1/events/topics/res_topic_2': mockTopicDetail({ resourceId: 'res_topic_2', topicName: 'orders.pending' }), 'GET /v1/events/topics/res_topic_2/access': fixtures['kafka:topic-access'], 'GET /v1/events/topics/res_topic_2/metadata': fixtures['kafka:topic-metadata'] }); open(); await select(); await waitFor(() => expect(callsTo(paths.detail)).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'orders.pending' })); expect(await screen.findByRole('heading', { name: 'orders.pending' })).toBeVisible(); expect(callsTo(paths.detail)[0][1]?.signal?.aborted).toBe(true)
  await act(async () => release(Response.json(mockTopicDetail({ topicName: 'Stale response' })))); expect(screen.queryByRole('heading', { name: 'Stale response' })).toBeNull()
})

test('workspace changes abort the stream reader and clear the selected topic without sending old-workspace requests', async () => {
  const workspaces = buildWorkspaceCollectionFixture(), stream = streamResponse(''); workspaces.items.push({ ...workspaces.items[0], workspaceId: 'synthetic-other', displayName: 'Other workspace' })
  setup({ [`GET ${workspaceUrl('synthetic-tenant')}`]: workspaces, [`GET ${paths.stream}`]: () => stream.response, 'GET /v1/events/workspaces/synthetic-other/inventory?page[size]=100': fixtures['kafka:inventory-empty'] }); open(true); await select(); tab(es.tabs.stream); fireEvent.click(screen.getByRole('button', { name: es.startStream })); await waitFor(() => expect(callsTo(paths.stream)).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' })); expect(await screen.findByText(es.thereAreNoTopicsInThisWorkspace)).toBeVisible(); await waitFor(() => expect(stream.cancelled()).toBe(true)); expect(callsTo(paths.stream)[0][1]?.signal?.aborted).toBe(true)
  expect(callsTo(paths.inventory)).toHaveLength(1); expect(screen.queryByRole('tablist')).toBeNull()
})
test('a successful SSE response without a body shows the legacy readable-content error', async () => {
  setup({ [`GET ${paths.stream}`]: () => new Response(null) }); open(); await select(); tab(es.tabs.stream); fireEvent.click(screen.getByRole('button', { name: es.startStream })); expect(await screen.findByText(es.theStreamReturnedNoReadableContent)).toBeVisible()
})

test('multiple bridges keep legacy request order and retry only the failed bridge in one table', async () => {
  const second = '/v1/events/workspaces/synthetic-workspace/bridges/evb_second'; let attempts = 0
  setup({ [`GET ${paths.inventory}`]: mockInventory({ bridgeIds: ['evb_orders', 'evb_second'] }), [`GET ${second}`]: () => ++attempts === 1 ? failure(500) : Response.json({ ...fixtures['kafka:bridge-1'], bridgeId: 'evb_second', topicRef: 'second-topic' }) }); open()
  const retry = await screen.findByRole('button', { name: es.retry }); expect(pageCalls().map(([path]) => path)).toEqual([paths.inventory, paths.bridge, second]); fireEvent.click(retry)
  const table = await screen.findByRole('table', { name: es.bridges }); expect(within(table).getAllByRole('row')).toHaveLength(3); expect(pageCalls().map(([path]) => path)).toEqual([paths.inventory, paths.bridge, second, second])
})

test('reselecting a topic returns to Detail and draft publish fields survive a topic change', async () => {
  setup({ 'GET /v1/events/topics/res_topic_2': mockTopicDetail({ resourceId: 'res_topic_2', topicName: 'orders.pending' }), 'GET /v1/events/topics/res_topic_2/access': fixtures['kafka:topic-access'], 'GET /v1/events/topics/res_topic_2/metadata': fixtures['kafka:topic-metadata'] }); open(); await select(); tab(es.tabs.publish)
  fireEvent.change(screen.getByLabelText(es.jsonPayload), { target: { value: '{"draft":true}' } }); await select(); expect(screen.getByRole('tab', { name: es.tabs.detail })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'orders.pending' })); await screen.findByRole('heading', { name: 'orders.pending' }); tab(es.tabs.publish); expect(screen.getByLabelText(es.jsonPayload)).toHaveValue('{"draft":true}')
})

test('an existing stream error follows a locale switch without issuing another request', async () => {
  setup({ [`GET ${paths.stream}`]: () => failure(503) }); open(); await select(); tab(es.tabs.stream); fireEvent.click(screen.getByRole('button', { name: es.startStream })); await screen.findByText(es.errors.server)
  await act(async () => i18n.changeLanguage('en')); expect(await screen.findByText(en.errors.server)).toBeVisible(); expect(callsTo(paths.stream)).toHaveLength(1)
})

test('stream event inspection uses the localized JSON viewer without announcing every arriving event', async () => {
  const stream = streamResponse(streamEvents(5)); setup({ [`GET ${paths.stream}`]: () => stream.response }); open(); await select(); tab(es.tabs.stream); fireEvent.click(screen.getByRole('button', { name: es.startStream }))
  const inspect = (await screen.findAllByRole('button', { name: es.inspectEvent }))[0]; fireEvent.click(inspect)
  expect(await screen.findByRole('tree', { name: es.jsonPayload })).toBeVisible(); expect(screen.getByRole('button', { name: 'Copiar ruta' })).toBeVisible(); expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')
})

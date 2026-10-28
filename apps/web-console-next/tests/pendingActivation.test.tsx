import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Profiler, StrictMode, type ProfilerProps } from 'react'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import PendingActivationPage from '../src/pages/pendingActivation'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.pending-activation-page.json'
import en from '../src/locales/en/pages.pending-activation-page.json'
import { actionView, navigationFixtures, serverView, statusPath } from './parity/pages/pendingActivation.manifest'

const fetchMock = vi.fn<typeof fetch>()
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset() })
const registration = navigationFixtures['nav-state.signup-registration']
function response(status = 200, body: unknown = serverView) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function mock(status = 200, body: unknown = serverView) {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => response(status, body))
}
function open(state?: unknown, basename = '/', app = false, onRender: ProfilerProps['onRender'] = () => {}) {
  return render(<StrictMode><MemoryRouter basename={basename} initialEntries={[{ pathname: `${basename === '/' ? '' : basename}/signup/pending-activation`, state }]}>
    <Profiler id="pending-activation" onRender={onRender}>{app ? <App /> : <PendingActivationPage />}</Profiler>
  </MemoryRouter></StrictMode>)
}
async function settled() { await waitFor(() => expect(screen.queryByText(es.loading)).not.toBeInTheDocument()) }
function assertRequest(count = 1) {
  expect(fetchMock).toHaveBeenCalledTimes(count)
  for (const [path, options] of fetchMock.mock.calls) {
    expect(path).toBe(statusPath)
    expect(options).toMatchObject({ method: 'GET', body: undefined, signal: expect.any(AbortSignal) })
  }
}
function noRawCopy() {
  expect(document.body.innerHTML).not.toMatch(/RAW_SERVER|RAW_NAVIGATION|RAW_ERROR|EP-\d+|US-UI|\/v1\//)
  expect(document.body.textContent).not.toMatch(/Estado:|Modo de activación:|Resumen del registro/)
}

test.each(['es', 'en'] as const)('ports the canonical view and receiving signup reference in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  mock(); open(registration, '/', true)
  await screen.findByText(copy.statusMessage)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title)
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getAllByRole('img', { name: copy.logo })).toHaveLength(1)
  expect(screen.getByText(copy.reference.replace('{id}', registration.registrationId))).toBeVisible()
  expect(screen.getByRole('link', { name: copy.login })).toHaveAttribute('href', '/login')
  expect(screen.getByRole('link', { name: copy.signup })).toHaveAttribute('href', '/signup')
  expect(document.title).toBe(copy.documentTitle)
  assertRequest(); noRawCopy()
})

test('ports a useful direct visit without navigation state or registration reference', async () => {
  mock(); open(); await settled()
  expect(screen.getByText(es.statusMessage)).toBeVisible()
  expect(screen.queryByText(es.referenceTitle)).not.toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(3) // Skip link and recovery links.
  assertRequest()
})

test.each([
  ['approval_required', 'approvalPending'], ['auto_activate', 'activationPending'],
  ['self_service', 'activationPending'], ['unknown', 'fallbackMessage'], [undefined, 'fallbackMessage'],
] as const)('maps navigation mode %s at render time, ignoring free text', async (activationMode, key) => {
  mock(500, { status: 500 }); open({ ...registration, activationMode })
  await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText(es[key])).toBeVisible()
  await act(() => i18n.changeLanguage('en'))
  expect(screen.getByText(en[key])).toBeVisible()
  expect(screen.getByText(en.reference.replace('{id}', registration.registrationId))).toBeVisible()
  expect(document.title).toBe(en.documentTitle)
  await act(() => i18n.changeLanguage('es'))
  expect(screen.getByText(es[key])).toBeVisible()
  noRawCopy(); assertRequest()
})

test.each([null, {}, { activationMode: 'approval_required' }])('uses the safe fallback without a pending navigation identity: %j', async (state) => {
  mock(401, { status: 401 }); open(state)
  await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText(es.fallbackMessage)).toBeVisible()
})

test('maps an unknown server status to fallback copy and preserves unknown action targets verbatim', async () => {
  mock(200, { ...serverView, statusView: 'unknown', allowedActions: [{ actionId: 'constructor', target: '/help?x=1#support', label: 'RAW_SERVER_LABEL' }] })
  open(); await settled()
  expect(screen.getByText(es.fallbackMessage)).toBeVisible()
  expect(screen.getByRole('link', { name: es.actions.unknown })).toHaveAttribute('href', '/help?x=1#support')
  noRawCopy()
})

test.each(['/', '/next'])('uses router links only for public targets with basename %s', async (basename) => {
  mock(200, { ...actionView, allowedActions: [...actionView.allowedActions,
    { actionId: 'return_to_login', target: '/invitations/tenant/invite?x=1#step', label: 'RAW_SERVER_LABEL' },
    { actionId: 'unknown', target: 'https://example.test/support?x=1#help', label: 'RAW_SERVER_LABEL' }] })
  const router = createMemoryRouter([{ path: '*', element: <PendingActivationPage /> }], {
    basename, initialEntries: [`${basename === '/' ? '' : basename}/signup/pending-activation`],
  })
  render(<RouterProvider router={router} />); await settled()
  const prefix = basename === '/' ? '' : basename
  for (const [key, target] of [['start_login', '/login'], ['create_account', '/signup'], ['recover_password', '/password-recovery']] as const) {
    const link = screen.getByRole('link', { name: es.actions[key] })
    expect(link).toHaveAttribute('href', prefix + target)
  }
  expect(screen.getAllByRole('link', { name: es.login })[0]).toHaveAttribute('href', prefix + '/invitations/tenant/invite?x=1#step')
  expect(screen.getByRole('link', { name: es.actions.unknown })).toHaveAttribute('href', 'https://example.test/support?x=1#help')
  fireEvent.click(screen.getByRole('link', { name: es.actions.start_login }))
  expect(router.state.location.pathname).toBe(prefix + '/login')
  noRawCopy()
})

test.each(['es', 'en'] as const)('renders explicit 401, 403, 404, 500 and network states in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  for (const status of [401, 403, 404, 500, 0]) {
    if (status) mock(status, { status, requestId: 'synthetic-pending-request', message: 'RAW_ERROR_MESSAGE' })
    else { vi.stubGlobal('fetch', fetchMock); fetchMock.mockRejectedValue(new Error('RAW_ERROR_MESSAGE')) }
    const page = open(registration)
    await screen.findByRole('heading', { level: 2, name: status === 403 ? copy.noAccessTitle : status === 404 ? copy.notFoundTitle : copy.errorTitle })
    expect(screen.getByText(copy.reference.replace('{id}', registration.registrationId))).toBeVisible()
    expect(screen.getAllByRole('link', { name: copy.login })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: copy.signup })).toHaveLength(1)
    if ([403, 404].includes(status)) {
      expect(screen.queryByRole('group', { name: copy.statusTitle })).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      if (status === 404) expect(screen.getByText(`${copy.notFoundDescription} ${copy.approvalPending}`)).toBeVisible()
    } else {
      expect(screen.getByText(copy.approvalPending)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    }
    expect(screen.queryByText('synthetic-pending-request') !== null).toBe(status === 500)
    noRawCopy(); page.unmount(); fetchMock.mockReset()
  }
})

test('ports safe network degradation while retaining retry and recovery actions', async () => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockRejectedValue(new Error('network failed'))
  open(registration)
  await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText(es.approvalPending)).toBeVisible()
  expect(screen.getByRole('link', { name: es.login })).toHaveAttribute('href', '/login')
  noRawCopy()
})

test('copies the server request ID and retries once per activation, restoring focus on failure and success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  // Start the assertion at the link's commit, before the passive focus effect.
  let focusCheck: Promise<unknown> | undefined
  mock(500, { status: 500, requestId: 'synthetic-pending-request' }); open(registration, '/', false, () => {
    if (screen.queryByRole('link', { name: es.actions.start_login })) focusCheck ??= waitFor(() => expect(screen.getByRole('group', { name: es.statusTitle })).toHaveFocus())
  })
  await screen.findByRole('button', { name: es.retry })
  fireEvent.click(screen.getByRole('button', { name: es.copyRequestId }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('synthetic-pending-request'))
  const retry = screen.getByRole('button', { name: es.retry }); retry.focus(); fireEvent.click(retry)
  await waitFor(() => expect(screen.getByRole('button', { name: es.retry })).toHaveFocus())
  assertRequest(2)
  let finish!: (value: Response) => void
  fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  await act(async () => { finish(response(200, actionView)) })
  await screen.findByRole('link', { name: es.actions.start_login })
  expect(focusCheck).toBeDefined()
  await focusCheck
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  assertRequest(3)
})

test('shows one loading announcement and usable recovery links, and aborts on unmount without a follow-up', async () => {
  vi.stubGlobal('fetch', fetchMock)
  let finish!: (value: Response) => void
  fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const page = open(registration)
  expect(screen.getAllByText(es.loading)).toHaveLength(1)
  expect(screen.getByText(es.loading).closest('[role="status"]')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('link', { name: es.login })).toBeVisible()
  await waitFor(() => assertRequest())
  const signal = fetchMock.mock.calls[0][1]?.signal
  expect(signal?.aborted).toBe(false)
  page.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish(response()); await Promise.resolve() })
  assertRequest()
})

test('preserves history state on reload and restores the previous document title on unmount', async () => {
  document.title = 'Previous title'
  mock(500, { status: 500 })
  const router = createMemoryRouter([{ path: '*', element: <PendingActivationPage /> }], { initialEntries: [{ pathname: '/signup/pending-activation', state: registration }] })
  const page = render(<RouterProvider router={router} />)
  await screen.findByText(es.approvalPending)
  expect(router.state.location.state).toEqual(registration)
  page.unmount()
  expect(document.title).toBe('Previous title')
})

test('CSP session serves the pending activation fixture and rejects unexpected requests', async () => {
  // @ts-expect-error Browser helpers intentionally use native JavaScript modules.
  const { installSession } = await import('./browser-session.mjs')
  const page = { addInitScript: vi.fn(), route: vi.fn() }
  const unmatched = await installSession(page)
  const handle = page.route.mock.calls[0][1]
  for (const [method, path] of [
    ['GET', statusPath],
    ['POST', statusPath],
    ['GET', `${statusPath}/unexpected`],
    ['GET', `${statusPath}?unexpected=true`],
    ['GET', '/v1/auth/status-views/active'],
  ]) {
    const route = {
      request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }),
      fulfill: vi.fn(), abort: vi.fn(),
    }
    await handle(route)
    if (method === 'GET' && path === statusPath) {
      expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ status: 200, json: serverView })
      expect(route.abort).not.toHaveBeenCalled()
      expect(unmatched).toEqual([])
    } else {
      expect(route.fulfill).not.toHaveBeenCalled()
      expect(route.abort).toHaveBeenCalledExactlyOnceWith()
    }
  }
  expect(unmatched).toEqual([
    `POST ${statusPath}`,
    `GET ${statusPath}/unexpected`,
    `GET ${statusPath}?unexpected=true`,
    'GET /v1/auth/status-views/active',
  ])
})

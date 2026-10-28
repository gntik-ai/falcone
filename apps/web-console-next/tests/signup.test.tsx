import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { I18nProvider } from '@gntik-ai/ui'
import { buildConsoleSignupPolicyFixture, buildConsoleLoginSessionFixture } from '@in-falcone/console-api/fixtures'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import SignupPage from '../src/pages/signup'
import { SignupFeedbackLayout } from '../src/pages/signupFeedback'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.signup-page.json'
import en from '../src/locales/en/pages.signup-page.json'

const policyPath = '/v1/auth/signups/policy'
const signupPath = '/v1/auth/signups'
const sessionKey = 'in-falcone.console-shell-session'
const fetchMock = vi.fn<typeof fetch>()
const policy = () => ({ ...buildConsoleSignupPolicyFixture(), selfServiceEnabled: true, passwordPolicy: { minLength: 12 }, message: 'Synthetic policy' })
const active = { registrationId: 'reg_abc123', userId: 'usr_abc123', activationMode: 'self_service', state: 'active', statusView: 'login', createdAt: '2026-03-28T19:00:00.000Z', message: 'Synthetic confirmation' }
const pending = { registrationId: 'reg_console_001', userId: 'usr_pending_001', activationMode: 'approval_required', state: 'pending_activation', statusView: 'pending_activation', createdAt: '2026-03-28T21:05:00.000Z', message: 'Tu registro está pendiente de activación.' }
const secret = '  synthetic-password  '
const fail = (status: number) => Response.json({ status, message: 'Synthetic failure', requestId: 'synthetic-request', code: `HTTP_${status}` }, { status })
function install(policyResponse: () => Response | Promise<Response> = () => Response.json(policy()), postResponse: () => Response | Promise<Response> = () => Response.json(active, { status: 201 })) {
  fetchMock.mockImplementation(async (url, init) => {
    if (url === policyPath && init?.method === 'GET') return policyResponse()
    if (url === signupPath && init?.method === 'POST') return postResponse()
    throw new Error(`Unexpected request ${init?.method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
}
function open(entry = '/signup', basename = '/') {
  const router = createMemoryRouter([{ element: <SignupFeedbackLayout />, children: [
    { path: '/signup', element: <SignupPage /> }, { path: '/signup/pending-activation', element: <h1>Pending destination</h1> },
    { path: '/login', element: <h1>Login destination</h1> }, { path: '/', element: <h1>Home destination</h1> },
  ] }], { initialEntries: [entry], basename })
  return { ...render(<StrictMode><I18nProvider locale={i18n.language}><RouterProvider router={router} /></I18nProvider></StrictMode>), router }
}
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
const change = (name: string, value: string) => fireEvent.change(input(name), { target: { value } })
async function ready(copy = es) { return screen.findByRole('button', { name: copy.submit }) }
function fill() {
  for (const [key, value] of Object.entries({ username: '  operations  ', displayName: '  Platform Operations  ', primaryEmail: '  no-at-sign  ', tenantId: '  ten_console  ', password: secret })) change(key, value)
}
function submit(copy = es) { fireEvent.click(screen.getByRole('button', { name: copy.submit })) }
const posts = () => fetchMock.mock.calls.filter(([url]) => url === signupPath)
function noLeaks(router: ReturnType<typeof open>['router']) {
  for (const value of [JSON.stringify(localStorage), JSON.stringify(sessionStorage), JSON.stringify(router.state.location.state), document.body.textContent]) expect(value).not.toContain(secret.trim())
}
beforeEach(() => { install(); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => {
  expect(fetchMock.mock.calls.every(([url, init]) => url === policyPath && init?.method === 'GET' || url === signupPath && init?.method === 'POST')).toBe(true)
  fetchMock.mockReset(); vi.unstubAllGlobals()
})

for (const locale of ['es', 'en'] as const) describe(`signup legacy parity in ${locale}`, () => {
  const copy = locale === 'es' ? es : en
  beforeEach(async () => { await i18n.changeLanguage(locale) })
  test('renders all fields, legacy attributes, policy, public links and title under a basename', async () => {
    open('/next/signup?tenant=%20ten_console%20&workspaceId=%20wrk_console%20', '/next'); await ready(copy)
    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(document.title).toBe(copy.documentTitle)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    for (const name of Object.keys(copy.fields)) expect(screen.getByLabelText(copy.fields[name as keyof typeof copy.fields].label, { selector: 'input' })).toBe(input(name))
    expect(input('tenantId')).toHaveValue('ten_console'); expect(input('workspaceId')).toHaveValue('wrk_console')
    expect(input('username')).toHaveAttribute('pattern', '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$')
    expect(input('username')).toHaveAttribute('maxlength', '63')
    expect(input('password')).toHaveAttribute('minlength', '12'); expect(input('password')).toHaveAttribute('autocomplete', 'new-password')
    expect(input('password')).toHaveAttribute('type', 'password'); expect(input('primaryEmail')).toHaveAttribute('type', 'email')
    expect(input('username').form).toHaveAttribute('novalidate')
    expect(screen.getByRole('link', { name: copy.homeLabel })).toHaveAttribute('href', '/next')
    expect(screen.getByRole('link', { name: copy.existing })).toHaveAttribute('href', '/next/login')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.body).not.toHaveTextContent(/EP-\d|US-UI|Realm|\/v1\/|Acme/)
  })
  test('query changes fill only empty context fields and discard restores the latest prefill', async () => {
    const { router } = open('/signup?tenantId=ten_console'); await ready(copy)
    change('tenantId', 'ten_typed')
    await act(async () => { await router.navigate('/signup?tenantId=ten_other&workspaceId=wrk_other') })
    expect(input('tenantId')).toHaveValue('ten_typed'); expect(input('workspaceId')).toHaveValue('wrk_other')
    change('username', 'typed')
    fireEvent.click(screen.getByRole('button', { name: copy.discard }))
    expect(input('tenantId')).toHaveValue('ten_other'); expect(input('username')).toHaveValue('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  test.each(['', '   '])('required-only validation rejects blank fields (%j), focuses in order and clears only edited errors', async (blank) => {
    open(); await ready(copy)
    for (const key of ['username', 'displayName', 'primaryEmail', 'tenantId']) change(key, blank)
    submit(copy)
    expect(await screen.findByRole('region', { name: copy.validationTitle })).toBeVisible()
    expect(input('username')).toHaveFocus()
    expect(screen.getAllByRole('alert').filter((element) => element.textContent?.includes(copy.requiredField))).toHaveLength(5)
    const links = within(screen.getByRole('region', { name: copy.validationTitle })).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#username', '#displayName', '#primaryEmail', '#tenantId', '#password'])
    fireEvent.click(links[3]); expect(input('tenantId')).toHaveFocus()
    change('displayName', 'Display')
    expect(input('displayName')).not.toHaveAttribute('aria-invalid', 'true')
    expect(input('username')).toHaveAttribute('aria-invalid', 'true')
    expect(input('username')).toHaveAttribute('aria-describedby', 'username-help username-required')
    expect(posts()).toHaveLength(0)
  })
  test.each(Object.keys(copy.fields))('Enter in %s validates and submits once while a request is pending', async (name) => {
    let finish!: (value: Response) => void
    install(undefined, () => new Promise((resolve) => { finish = resolve }))
    const { router } = open(); await ready(copy)
    fireEvent.keyDown(input(name), { key: 'Enter' })
    expect(await screen.findByRole('region', { name: copy.validationTitle })).toBeVisible()
    expect(input('username')).toHaveFocus()
    expect(screen.getAllByRole('alert').filter((element) => element.textContent?.includes(copy.requiredField))).toHaveLength(5)
    expect(posts()).toHaveLength(0)
    fill()
    fireEvent.keyDown(input(name), { key: 'Enter' })
    expect(await screen.findByRole('button', { name: copy.submitting })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(input(name), { key: 'Enter' })
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ username: 'operations', displayName: 'Platform Operations', primaryEmail: 'no-at-sign', tenantId: 'ten_console', password: secret })
    expect(new Headers(posts()[0][1]?.headers).get('Idempotency-Key')).toMatch(/^idem_/)
    await act(async () => { finish(Response.json(active, { status: 201 })) })
    await waitFor(() => expect(screen.getByRole('group', { name: copy.successTitle })).toHaveFocus())
    noLeaks(router)
  })
  test('Enter during input composition does not submit', async () => {
    open(); await ready(copy); fill()
    fireEvent.keyDown(input('password'), { key: 'Enter', isComposing: true })
    expect(posts()).toHaveLength(0)
    expect(screen.queryByRole('region', { name: copy.validationTitle })).not.toBeInTheDocument()
  })
  test('submits trimmed text, untrimmed password and optional workspace with an idempotency key; success focuses once without leaks', async () => {
    let finish!: (value: Response) => void
    install(undefined, () => new Promise((resolve) => { finish = resolve }))
    const { router } = open(); await ready(copy); fill(); change('workspaceId', '  wrk_console  '); submit(copy)
    const saving = await screen.findByRole('button', { name: copy.submitting })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(saving); expect(posts()).toHaveLength(1)
    const [, request] = posts()[0]
    expect(JSON.parse(String(request?.body))).toEqual({ username: 'operations', displayName: 'Platform Operations', primaryEmail: 'no-at-sign', tenantId: 'ten_console', password: secret, workspaceId: 'wrk_console' })
    expect(new Headers(request?.headers).get('Idempotency-Key')).toMatch(/^idem_/)
    expect(new Headers(request?.headers).get('Authorization')).toBeNull()
    await act(async () => { finish(Response.json(active, { status: 201 })) })
    const confirmation = await screen.findByRole('group', { name: copy.successTitle })
    await waitFor(() => expect(confirmation).toHaveFocus())
    expect(within(confirmation).getByText(active.message)).toBeVisible()
    expect(within(confirmation).getByText(copy.reference.replace('{id}', active.registrationId))).toBeVisible()
    expect(screen.getByRole('link', { name: copy.continue })).toHaveAttribute('href', '/login?tenantId=ten_console')
    expect(screen.getByRole('region', { name: copy.notifications })).toHaveTextContent(copy.successTitle)
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(copy.successTitle)
    noLeaks(router)
  })
  test.each(['state', 'statusView'])('pending handoff through %s replaces history and carries exactly six fields while the polite toast survives', async (field) => {
    const result = { ...pending, ...(field === 'statusView' ? { state: 'active' } : { statusView: 'login' }) }
    install(undefined, () => Response.json(result, { status: 201 }))
    const { router } = open(); await ready(copy); fill(); change('workspaceId', '   '); submit(copy)
    await screen.findByRole('heading', { name: 'Pending destination' })
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.state).toEqual(Object.fromEntries(['registrationId', 'state', 'statusView', 'activationMode', 'createdAt', 'message'].map((key) => [key, result[key as keyof typeof result]])))
    expect(JSON.parse(String(posts()[0][1]?.body))).not.toHaveProperty('workspaceId')
    expect(screen.getByRole('region', { name: copy.notifications })).toHaveTextContent(copy.pendingTitle)
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(copy.pendingTitle)
    noLeaks(router)
  })
  test.each([400, 401, 403, 404, 409, 422, 500, 'network'] as const)('maps POST %s above the kept form and announces failure assertively', async (status) => {
    install(undefined, () => { if (status === 'network') throw new TypeError('Synthetic offline'); return fail(status) })
    const { router } = open(); await ready(copy); fill(); submit(copy)
    const title = status === 400 ? copy.invalidTitle : status === 403 ? copy.deniedTitle : status === 404 ? copy.notFoundTitle : status === 409 ? copy.conflictTitle : copy.submitErrorTitle
    await waitFor(() => expect(document.getElementById('signup-feedback')).toHaveTextContent(title))
    expect(input('username')).toHaveValue('  operations  ')
    expect(input('password')).toHaveValue(secret)
    expect(screen.queryByRole('group', { name: copy.successTitle })).not.toBeInTheDocument()
    expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(title)
    expect(screen.getByRole('region', { name: copy.notifications })).toHaveTextContent(title)
    expect(router.state.location.pathname).toBe('/signup')
    if (status === 500) expect(screen.getByText('synthetic-request')).toBeVisible()
    if (status === 'network' || status === 500) {
      install(undefined, () => Response.json(active, { status: 201 }))
      fireEvent.click(screen.getByRole('button', { name: copy.retry }))
      await screen.findByRole('group', { name: copy.successTitle })
      expect(posts()).toHaveLength(2)
    }
    noLeaks(router)
  })
  test.each([401, 403, 404, 500, 'network'] as const)('policy %s hides the form and maps the state; retry reads once', async (status) => {
    install(() => { if (status === 'network') throw new TypeError('Synthetic offline'); return fail(status) })
    open()
    await screen.findByRole('heading', { name: status === 403 ? copy.disabledTitle : status === 404 ? copy.notFoundTitle : copy.policyErrorTitle })
    expect(document.querySelector('form')).toBeNull()
    expect(posts()).toHaveLength(0)
    if (status !== 403 && status !== 404) {
      if (status !== 'network') expect(screen.getByText('synthetic-request')).toBeVisible()
      install()
      fireEvent.click(screen.getByRole('button', { name: copy.retry }))
      await ready(copy)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  })
  test('focuses the only missing organization and revalidates before retrying a failed POST', async () => {
    install(undefined, () => fail(500))
    open(); await ready(copy); fill(); change('tenantId', '   '); submit(copy)
    expect(input('tenantId')).toHaveFocus()
    expect(posts()).toHaveLength(0)
    change('tenantId', 'ten_console'); submit(copy)
    await screen.findByRole('button', { name: copy.retry })
    change('displayName', '   ')
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    expect(input('displayName')).toHaveFocus()
    expect(posts()).toHaveLength(1)
    expect(screen.getByRole('region', { name: copy.validationTitle })).toBeVisible()
  })
  test.each([null, 'true'])('only boolean true policy permission renders a form (%s)', async (permission) => {
    install(() => Response.json({ ...policy(), selfServiceEnabled: permission }))
    open(); await screen.findByText(copy.disabledTitle)
    expect(document.querySelector('form')).toBeNull()
    expect(posts()).toHaveLength(0)
  })
  test('loading and restricted policies have no form or action bar; aborts policy on unmount', async () => {
    install(() => new Promise(() => {}))
    const { unmount } = open()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('status').some((node) => node.getAttribute('aria-busy') === 'true')).toBe(true)
    expect(document.querySelector('form')).toBeNull()
    fireEvent.keyDown(screen.getByRole('main'), { key: 'Enter' })
    expect(posts()).toHaveLength(0)
    const signal = fetchMock.mock.calls[0][1]?.signal
    unmount(); expect(signal?.aborted).toBe(true)
    install(() => Response.json({ ...policy(), selfServiceEnabled: false }))
    open(); await screen.findByText(copy.disabledTitle)
    expect(document.querySelector('form')).toBeNull()
    expect(screen.queryByRole('button', { name: copy.submit })).not.toBeInTheDocument()
  })
  test.each([undefined, 0, -1, 'invalid'])('password minimum falls back to eight for %s and empty policy messages use translated copy', async (min) => {
    install(() => Response.json({ ...policy(), message: '', passwordPolicy: min === undefined ? undefined : { minLength: min } }))
    open(); await ready(copy)
    expect(input('password')).toHaveAttribute('minlength', '8')
    expect(screen.getByText(copy.enabledSummary)).toBeVisible()
    for (const key of Object.keys(copy.fields)) expect(input(key)).toHaveValue('')
  })
})

test.each(['policy', 'submit'])('401 from %s never refreshes, redirects or touches a stored session', async (endpoint) => {
  for (const stored of [false, true]) {
    if (stored) persistConsoleShellSession(buildConsoleLoginSessionFixture())
    const before = sessionStorage.getItem(sessionKey)
    install(endpoint === 'policy' ? () => fail(401) : undefined, () => fail(401))
    const { router, unmount } = open()
    if (endpoint === 'submit') { await ready(); fill(); submit() }
    await waitFor(() => expect(endpoint === 'policy' ? document.body : document.getElementById('signup-feedback')).toHaveTextContent(endpoint === 'policy' ? es.policyErrorTitle : es.submitErrorTitle))
    expect(router.state.location.pathname).toBe('/signup')
    expect(sessionStorage.getItem(sessionKey)).toBe(before)
    expect(fetchMock.mock.calls.every(([url, init]) => url === policyPath && init?.method === 'GET' || url === signupPath && init?.method === 'POST')).toBe(true)
    unmount(); fetchMock.mockClear()
  }
})

test('signup owns its frame within the application and focuses main', async () => {
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/next/signup'], basename: '/next' })
  render(<RouterProvider router={router} />); await ready()
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main')).toHaveFocus()
  expect(screen.getByRole('img', { name: es.logo })).toBeVisible()
})

test.each(['es', 'en'] as const)('application signup announces a failed submission exactly once in its assertive region in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  install(undefined, () => fail(400))
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/next/signup'], basename: '/next' })
  render(<RouterProvider router={router} />)
  await ready(copy); fill(); submit(copy)
  await waitFor(() => expect(document.getElementById('signup-feedback')).toHaveTextContent(copy.invalidTitle))
  const regions = Array.from(document.querySelectorAll('[data-live-announcer="assertive"]'))
  expect(regions).toHaveLength(2)
  expect(regions.filter((region) => region.textContent?.includes(copy.invalidTitle))).toHaveLength(1)
  expect(regions.at(-1)).toBeEmptyDOMElement()
  expect(screen.getByRole('region', { name: copy.notifications })).toHaveTextContent(copy.invalidTitle)
  expect(input('username')).toHaveValue('  operations  ')
  expect(posts()).toHaveLength(1)
  noLeaks(router)
})

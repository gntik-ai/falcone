import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { iamClientsPath, syntheticSecret } from './parity/pages/console-auth-page.manifest'
import { applicationReads, copy, failure, fill, open, pageCalls, ready, type Locale, writes } from './consoleAuth-support'

let requests: ReturnType<typeof open>['requests']
const locales: Locale[] = ['es', 'en']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => { requests?.verify(); vi.restoreAllMocks() })
const post = `POST ${iamClientsPath}`
const created = (extra: Record<string, unknown> = {}) => () => Response.json({ iamClientId: 'new-client', clientSecret: syntheticSecret, ...extra }, { status: 201 })
const start = async (locale: Locale, routes: Record<string, unknown> = {}) => {
  await i18n.changeLanguage(locale)
  ;({ requests } = open({ routes }))
  await ready(locale)
}
const wizard = () => screen.getByTestId('auth-wizard')
const press = (name: string) => fireEvent.click(within(wizard()).getByRole('button', { name }))
const next = (c: typeof copy.es) => press(c.wizard.next)
const typed = (label: string, value: string) => fireEvent.change(within(wizard()).getByLabelText(new RegExp(`^${label}`)), { target: { value } })
async function toReview(c: typeof copy.es, { type = 'public', clientId = 'new-client', redirects = 'https://app.example.test/callback' } = {}) {
  fireEvent.click(screen.getByRole('button', { name: c.wizard.open }))
  await screen.findByTestId('auth-wizard')
  next(c)
  if (type !== 'public') {
    fireEvent.click(within(wizard()).getByRole('combobox', { name: c.wizard.fields.type }))
    const option = await screen.findByRole('option', { name: c.wizard.types[type as 'confidential'] }); fireEvent.pointerDown(option); fireEvent.click(option)
  }
  typed(c.wizard.fields.clientId, clientId); next(c)
  if (type !== 'service_account') typed(c.wizard.steps.redirects, redirects)
  next(c)
  fireEvent.click(within(wizard()).getByRole('checkbox', { name: 'openid' })); fireEvent.click(within(wizard()).getByRole('checkbox', { name: 'email' })); next(c)
  await within(wizard()).findByText(c.wizard.review)
}
const secretNowhere = () => {
  expect(document.body.innerHTML).not.toContain(syntheticSecret)
  expect(JSON.stringify({ ...localStorage })).not.toContain(syntheticSecret); expect(JSON.stringify({ ...sessionStorage })).not.toContain(syntheticSecret)
}

test.each(locales)('the wizard announces the step, lists every value for review and sends nothing before submit in %s', async (locale) => {
  const c = copy[locale]
  await start(locale)
  const before = pageCalls(requests).length
  await toReview(c)
  expect((await within(wizard()).findAllByText(fill(c.wizard.stepCount, { step: '5', total: '5', label: c.wizard.steps.review }))).length).toBeGreaterThan(0)
  const review = within(wizard()).getByText(c.wizard.review).closest('section, div')!.parentElement!
  for (const value of [c.wizard.types.public, 'new-client', 'https://app.example.test/callback', 'openid, email']) expect(review).toHaveTextContent(value)
  expect(pageCalls(requests)).toHaveLength(before)
  expect(applicationReads(requests)).toHaveLength(1)
})

test('each step validates before moving on and keeps the entered values when going back', async () => {
  const c = copy.es
  await start('es')
  fireEvent.click(screen.getByRole('button', { name: c.wizard.open }))
  await screen.findByTestId('auth-wizard')
  next(c)
  next(c)
  expect(await within(wizard()).findByText(c.wizard.validation.clientId)).toBeVisible()
  typed(c.wizard.fields.clientId, 'kept-client'); next(c)
  next(c)
  expect(await within(wizard()).findByText(c.wizard.validation.redirects)).toBeVisible()
  typed(c.wizard.steps.redirects, 'sin-esquema'); next(c)
  expect(await within(wizard()).findByText(c.wizard.validation.redirects)).toBeVisible()
  press(c.wizard.back)
  expect(within(wizard()).getByLabelText(new RegExp(`^${c.wizard.fields.clientId}`))).toHaveValue('kept-client')
  expect(writes(requests)).toEqual([])
})

test.each(locales)('submit sends one idempotent POST and the client secret appears nowhere in %s', async (locale) => {
  const c = copy[locale]
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method))
  await start(locale, { [post]: created() })
  await toReview(c)
  press(c.wizard.confirm)
  expect((await screen.findAllByText(fill(c.wizard.created, { id: 'new-client' }))).length).toBeGreaterThan(0)
  const [request] = writes(requests)
  expect(writes(requests)).toHaveLength(1)
  expect(request.path).toBe(iamClientsPath)
  expect(request.body).toEqual({ clientType: 'public', clientId: 'new-client', redirectUris: ['https://app.example.test/callback'], scopes: ['openid', 'email'], permissions: [] })
  expect(request.headers.get('Idempotency-Key')).toBeTruthy(); expect(request.headers.get('X-Request-Id')).toMatch(/^wiz_/)
  secretNowhere()
  for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(syntheticSecret)
  // The wizard triggers no applications reload.
  expect(applicationReads(requests)).toHaveLength(1)
  fireEvent.click(within(wizard()).getByRole('button', { name: c.wizard.close }))
  await waitFor(() => expect(screen.queryByTestId('auth-wizard')).toBeNull())
  secretNowhere()
})

test('a service account sends an empty redirect list and skips the redirect rule', async () => {
  const c = copy.es
  await start('es', { [post]: created({ clientSecret: undefined }) })
  await toReview(c, { type: 'service_account' })
  press(c.wizard.confirm)
  await screen.findAllByText(fill(c.wizard.created, { id: 'new-client' }))
  expect(writes(requests)[0].body).toMatchObject({ clientType: 'service_account', redirectUris: [] })
})

test('a failed submit shows the error panel with Reintentar in the review step and keeps every value', async () => {
  const c = copy.es
  let attempts = 0
  await start('es', { [post]: () => { attempts += 1; return attempts === 1 ? failure(500)() : created()() } })
  await toReview(c, { type: 'confidential', clientId: 'kept-client' })
  press(c.wizard.confirm)
  const retry = await within(wizard()).findByRole('button', { name: c.failure.retry })
  expect(wizard()).toHaveTextContent('500'); expect(wizard()).toHaveTextContent('req_synthetic_console_auth')
  expect(wizard()).toHaveTextContent('kept-client'); expect(wizard()).toHaveTextContent(c.wizard.types.confidential)
  expect(screen.queryByText('synthetic-backend-message')).toBeNull()
  fireEvent.click(retry)
  expect((await screen.findAllByText(fill(c.wizard.created, { id: 'new-client' }))).length).toBeGreaterThan(0)
  expect(writes(requests)).toHaveLength(2)
  expect(writes(requests)[1].body).toMatchObject({ clientType: 'confidential', clientId: 'kept-client' })
  expect(applicationReads(requests)).toHaveLength(1)
})

test('without the manage_iam permission the wizard shows the deny reason and no stepper', async () => {
  const c = copy.es
  await start('es')
  const key = 'in-falcone.console-shell-session'
  const session = JSON.parse(sessionStorage.getItem(key)!); session.principal.platformRoles = ['tenant_viewer']; sessionStorage.setItem(key, JSON.stringify(session))
  fireEvent.click(screen.getByRole('button', { name: c.wizard.open }))
  const blocked = await screen.findByTestId('auth-wizard-blocked')
  expect(within(blocked).getByRole('heading', { name: c.wizard.blockedTitle })).toBeVisible()
  expect(blocked.textContent).not.toBe(c.wizard.blockedTitle)
  expect(screen.queryByTestId('auth-wizard')).toBeNull(); expect(screen.queryByRole('list', { name: c.wizard.stepsLabel })).toBeNull()
  expect(writes(requests)).toEqual([])
  fireEvent.click(within(blocked).getByRole('button', { name: c.wizard.close }))
  await waitFor(() => expect(screen.queryByTestId('auth-wizard-blocked')).toBeNull())
})

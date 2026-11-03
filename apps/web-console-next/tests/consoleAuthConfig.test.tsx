import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleAuthConfigPage from '../src/pages/consoleAuthConfig'
import { callbackUrl, config, configPath, forbiddenReason, noProviders, providerPath, providers, syntheticSecret } from './parity/pages/console-auth-config-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-auth-config-page.json'
import en from '../src/locales/en/pages.console-auth-config-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['tenant_owner'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))

const failure = (status: number, requestId = 'req_synthetic_auth_config', message = 'synthetic-error') => () => Response.json({ status, code: `HTTP_${status}`, message, requestId }, { status })
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const writes = () => calls().filter(({ method }) => method !== 'GET')
const setup = (routes: Record<string, unknown> = {}) => { requests = strictFetch({ [`GET ${configPath}`]: config, ...routes }) }
const open = () => render(<MemoryRouter><ConsoleAuthConfigPage /></MemoryRouter>)
const ready = () => screen.findByRole('group', { name: es.methodsTitle })
const button = (name: string) => screen.getByRole('button', { name })
// The kit header renders its actions twice (wide and narrow layouts); CSS hides one.
const reload = () => screen.getAllByRole('button', { name: es.reload })[0]
// A result is shown in the callout, the toast and the live region.
const seen = async (text: string) => { expect((await screen.findAllByText(text)).length).toBeGreaterThan(0) }
const checkbox = (key: keyof typeof es.methods) => screen.getByRole('checkbox', { name: new RegExp(es.methods[key].label) })
const ownerRoles = ['superadmin', 'tenant_owner', 'tenant_admin']

beforeEach(async () => {
  // JSDOM lacks PointerEvent, which Base UI uses when a checkbox is activated.
  vi.stubGlobal('PointerEvent', MouseEvent)
  await i18n.changeLanguage('es'); login(); context.roles = ['tenant_owner']
  context.value = { activeTenantId: 'synthetic-tenant', loading: false, error: null, tenants: [{ tenantId: 'synthetic-tenant', displayName: 'Synthetic Organization' }] }
})
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('renders the realm, the five login methods and the providers in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open()
  const copy = locale === 'es' ? es : en
  await screen.findByRole('group', { name: copy.methodsTitle })
  expect(screen.getByRole('heading', { name: copy.title, level: 1 })).toBeVisible()
  expect(screen.getByText('Synthetic Organization')).toBeVisible(); expect(screen.getByText('synthetic-realm')).toBeVisible()
  const values = { registrationAllowed: false, loginWithEmailAllowed: true, resetPasswordAllowed: true, rememberMe: false, verifyEmail: false }
  for (const [key, checked] of Object.entries(values)) {
    const box = screen.getByRole('checkbox', { name: new RegExp(copy.methods[key as keyof typeof values].label) })
    expect(box).toHaveAttribute('aria-checked', String(checked))
  }
  const table = screen.getByRole('table', { name: copy.providersTable })
  const google = within(table).getByRole('row', { name: /Google/ })
  expect(google).toHaveTextContent('google'); expect(google).toHaveTextContent(copy.enabled); expect(google).toHaveTextContent(copy.secretSet); expect(google).toHaveTextContent(callbackUrl)
  const gitlab = within(table).getByRole('row', { name: /GitLab/ })
  expect(gitlab).toHaveTextContent(copy.disabled); expect(gitlab).toHaveTextContent(copy.secretNotSet)
  expect(gitlab).toHaveTextContent('/realms/synthetic-realm/broker/gitlab/endpoint')
  expect(screen.getByRole('toolbar', { name: copy.toolbarLabel })).toBeVisible()
  expect(document.body).not.toHaveTextContent('pages.console-auth-config-page.')
  expect(document.documentElement.lang).toBe(locale)
  expect(calls()).toEqual([{ method: 'GET', path: configPath, body: undefined }])
})

test('with no active organization it asks for one and sends no request', async () => {
  context.value = { ...context.value, activeTenantId: null }
  setup(); open()
  expect(await screen.findByRole('heading', { name: es.selectOrganization })).toBeVisible()
  expect(calls()).toEqual([])
})

test('while loading the form and list are skeletons and Recargar is disabled', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${configPath}`]: async () => { await held; return Response.json(config) } }); open()
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  expect(reload()).toBeDisabled(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  release(); await ready(); expect(reload()).toBeEnabled()
})

test('saving sends only the changed keys, re-seeds the form and moves focus to the announcement', async () => {
  setup({ [`PUT ${configPath}`]: { ...config, registrationAllowed: true, rememberMe: true } }); open(); await ready()
  const save = button(es.save); expect(save).toBeDisabled()
  expect(button(es.discard)).toBeDisabled()
  fireEvent.click(checkbox('registrationAllowed')); fireEvent.click(checkbox('rememberMe'))
  expect(save).toBeEnabled(); expect(screen.getByText(es.unsaved)).toBeVisible()
  fireEvent.click(save)
  await screen.findByRole('region', { name: es.announcementRegion })
  expect(writes()).toEqual([{ method: 'PUT', path: configPath, body: { registrationAllowed: true, rememberMe: true } }])
  expect(checkbox('registrationAllowed')).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('region', { name: es.announcementRegion })).toHaveFocus()
  expect(within(screen.getByRole('region', { name: es.announcementRegion })).getByText(es.saved)).toBeVisible()
  expect(button(es.save)).toBeDisabled()
  expect(document.querySelectorAll('[aria-live]')).not.toHaveLength(0)
})

test('editing clears the previous result, Descartar reverts without a request and Recargar reissues the GET', async () => {
  setup({ [`PUT ${configPath}`]: { ...config, verifyEmail: true } }); open(); await ready()
  fireEvent.click(checkbox('verifyEmail')); fireEvent.click(button(es.save))
  await seen(es.saved)
  fireEvent.click(checkbox('rememberMe'))
  expect(screen.queryByRole('region', { name: es.announcementRegion })).not.toBeInTheDocument()
  fireEvent.click(button(es.discard))
  expect(checkbox('rememberMe')).toHaveAttribute('aria-checked', 'false')
  expect(button(es.discard)).toBeDisabled()
  expect(writes()).toHaveLength(1)
  fireEvent.click(reload()); await ready()
  expect(calls().filter(({ method }) => method === 'GET')).toHaveLength(2)
})

test.each([[403, 'errors.403'], [500, 'errors.5xx']] as const)('a failed save (%s) shows a callout, keeps the draft and never echoes the backend message', async (status, key) => {
  setup({ [`PUT ${configPath}`]: failure(status, 'req_synthetic_put', 'raw backend trace') }); open(); await ready()
  fireEvent.click(checkbox('verifyEmail')); fireEvent.click(button(es.save))
  await seen(es.errors[key.slice(7) as '403' | '5xx'])
  expect(screen.queryByText(/raw backend trace/)).not.toBeInTheDocument()
  expect(checkbox('verifyEmail')).toHaveAttribute('aria-checked', 'true'); expect(button(es.save)).toBeEnabled()
})

test('a read 403 shows the localized no-access state without the backend reason or the form', async () => {
  setup({ [`GET ${configPath}`]: failure(403, 'req_synthetic_403', forbiddenReason) }); open()
  expect(await screen.findByRole('heading', { name: es.noAccess })).toBeVisible()
  expect(screen.getByText(es.errors['403'])).toBeVisible()
  expect(screen.queryByText(new RegExp(forbiddenReason))).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /acceso|access/i })).not.toBeInTheDocument()
})

test('a read 404 links back to the overview', async () => {
  setup({ [`GET ${configPath}`]: failure(404) }); open()
  expect(await screen.findByRole('heading', { name: es.notFound })).toBeVisible()
  expect(screen.getByRole('link', { name: es.backToOverview })).toHaveAttribute('href', '/console/overview')
})

test('a 500 shows the status, the request id and a working retry', async () => {
  let attempt = 0
  setup({ [`GET ${configPath}`]: () => ++attempt === 1 ? Response.json({ status: 500, code: 'HTTP_500', message: 'synthetic-error', requestId: 'req_synthetic_500' }, { status: 500 }) : Response.json(config) }); open()
  expect(await screen.findByRole('heading', { name: es.loadError })).toBeVisible()
  expect(screen.getByText('req_synthetic_500')).toBeVisible(); expect(screen.getByText(es.errors['5xx'])).toBeVisible()
  fireEvent.click(button(es.retry)); await ready()
  expect(calls()).toHaveLength(2)
})

test('a network error shows the error panel and no stale configuration', async () => {
  let attempt = 0
  setup({ [`GET ${configPath}`]: () => { if (++attempt === 1) return Response.json(config); throw new TypeError('Failed to fetch') } }); open(); await ready()
  fireEvent.click(reload())
  expect(await screen.findByRole('heading', { name: es.loadError })).toBeVisible()
  expect(screen.getByText(es.loadFallback)).toBeVisible()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test.each(['tenant_viewer', 'tenant_developer', 'workspace_admin', 'platform_operator'])('%s gets a read-only view', async (role) => {
  context.roles = [role]; setup(); open(); await ready()
  expect(screen.getAllByRole('checkbox')).toHaveLength(5)
  for (const box of screen.getAllByRole('checkbox')) expect(box).toHaveAttribute('aria-disabled', 'true')
  for (const name of [es.save, es.discard, es.createProvider]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: new RegExp(`${es.edit}|${es.delete}|${es.disable}|${es.enable}`) })).not.toBeInTheDocument()
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  expect(screen.getByText(es.providersDescriptionRead)).toBeVisible()
  expect(screen.getByRole('button', { name: es.copyUrlNamed.replace('{name}', 'Google') })).toBeVisible()
})

test.each(ownerRoles)('%s sees the management controls', async (role) => {
  context.roles = [role]; setup(); open(); await ready()
  expect(button(es.createProvider)).toBeVisible(); expect(button(es.save)).toBeVisible()
})

test('with no providers the first-run state names the realm and offers creation only to managers', async () => {
  setup({ [`GET ${configPath}`]: noProviders }); open()
  expect(await screen.findByRole('heading', { name: es.emptyProviders })).toBeVisible()
  expect(screen.getByText(es.emptyProvidersDescription.replace('{realm}', 'synthetic-realm'))).toBeVisible()
  expect(screen.getAllByRole('button', { name: es.createProvider })).toHaveLength(1)
})

test('with no providers the create action is disabled while a login-method save is in flight', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${configPath}`]: noProviders, [`PUT ${configPath}`]: async () => { await held; return Response.json({ ...noProviders, rememberMe: true }) } }); open()
  await screen.findByRole('heading', { name: es.emptyProviders })
  expect(button(es.createProvider)).toBeEnabled()
  fireEvent.click(checkbox('rememberMe')); fireEvent.click(button(es.save))
  await waitFor(() => expect(button(es.createProvider)).toBeDisabled())
  fireEvent.click(button(es.createProvider))
  expect(screen.queryByRole('dialog', { name: providerDialogName })).not.toBeInTheDocument()
  release(); await waitFor(() => expect(button(es.createProvider)).toBeEnabled())
})

test('with no providers a read-only user gets no create action', async () => {
  context.roles = ['tenant_viewer']; setup({ [`GET ${configPath}`]: noProviders }); open()
  expect(await screen.findByRole('heading', { name: es.emptyProviders })).toBeVisible()
  expect(screen.getByText(es.emptyProvidersRead)).toBeVisible(); expect(screen.queryByRole('button', { name: es.createProvider })).not.toBeInTheDocument()
})

// Toasts also have role dialog, so match the provider dialog by its title.
const providerDialogName = /^(Crear|Editar) proveedor de identidad$/
const dialog = () => screen.findByRole('dialog', { name: providerDialogName })
const field = (scope: HTMLElement, label: string) => within(scope).getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement
async function chooseTemplate(scope: HTMLElement, name: string) {
  fireEvent.click(within(scope).getByRole('combobox', { name: es.fieldTemplate }))
  const option = await screen.findByRole('option', { name }); fireEvent.pointerDown(option); fireEvent.click(option)
}

test('creating a provider sends the legacy body once, clears the secret and never leaks it', async () => {
  setup({ [`PUT ${providerPath('github')}`]: { identityProviders: [providers.google, providers.gitlab, providers.github] } }); open(); await ready()
  fireEvent.click(button(es.createProvider)); const form = await dialog()
  await chooseTemplate(form, 'GitHub')
  expect(field(form, es.fieldAlias)).toHaveValue('github')
  fireEvent.change(field(form, es.fieldClientId), { target: { value: 'synthetic-id' } })
  fireEvent.change(field(form, es.fieldSecret), { target: { value: syntheticSecret } })
  fireEvent.click(within(form).getByRole('button', { name: es.dialogSave }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toEqual({ method: 'PUT', path: providerPath('github'), body: { providerId: 'github', displayName: '', enabled: true, config: { clientId: 'synthetic-id', defaultScope: '', clientSecret: syntheticSecret } } })
  await seen(es.providerUpdated)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: providerDialogName })).not.toBeInTheDocument())
  expect(screen.getByRole('row', { name: /GitHub/ })).toBeVisible()
  expect(document.body.innerHTML).not.toContain(syntheticSecret)
  expect(JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage))).not.toContain(syntheticSecret)
  expect(JSON.stringify(calls().filter((call) => call.path !== providerPath('github')))).not.toContain(syntheticSecret)
})

test('the form validates alias, client id and secret before any request', async () => {
  setup(); open(); await ready()
  fireEvent.click(button(es.createProvider)); const form = await dialog()
  await chooseTemplate(form, 'GitHub')
  fireEvent.change(field(form, es.fieldAlias), { target: { value: '-bad alias' } })
  fireEvent.click(within(form).getByRole('button', { name: es.dialogSave }))
  const summary = await within(form).findByRole('region', { name: es.validationTitle })
  for (const message of [es.validationAlias, es.validationClientId, es.validationSecret]) expect(within(summary).getByText(new RegExp(message.slice(0, 20)))).toBeVisible()
  expect(writes()).toEqual([])
  expect(field(form, es.fieldAlias)).toHaveAttribute('maxlength', '64'); expect(field(form, es.fieldName)).toHaveAttribute('maxlength', '256')
  expect(field(form, es.fieldClientId)).toHaveAttribute('maxlength', '4096'); expect(field(form, es.fieldScope)).toHaveAttribute('maxlength', '4096')
  expect(field(form, es.fieldSecret)).toHaveAttribute('maxlength', '4096')
  expect(field(form, es.fieldSecret)).toHaveAccessibleDescription(es.fieldSecretNewHelp)
})

test('a duplicate alias on create is reported and blocks submit', async () => {
  setup(); open(); await ready()
  fireEvent.click(button(es.createProvider)); const form = await dialog()
  expect(within(form).getByText(es.duplicateAlias)).toBeVisible()
  expect(within(form).getByRole('button', { name: es.dialogSave })).toBeDisabled()
  expect(writes()).toEqual([])
})

test('editing with an empty secret omits clientSecret and keeps the secret badge', async () => {
  setup({ [`PUT ${providerPath('google')}`]: (init: RequestInit) => Response.json({ identityProviders: [{ ...providers.google, displayName: JSON.parse(String(init.body)).displayName }, providers.gitlab] }) }); open(); await ready()
  fireEvent.click(button(es.editNamed.replace('{name}', 'Google'))); const form = await dialog()
  expect(field(form, es.fieldSecret)).toHaveValue(''); expect(field(form, es.fieldAlias)).toBeDisabled()
  expect(within(form).getByRole('combobox', { name: es.fieldTemplate })).toBeDisabled()
  expect(field(form, es.fieldSecret)).toHaveAccessibleDescription(es.fieldSecretSetHelp)
  fireEvent.change(field(form, es.fieldName), { target: { value: 'Updated' } })
  fireEvent.click(within(form).getByRole('button', { name: es.dialogSave }))
  await seen(es.providerUpdated)
  expect(writes()).toEqual([{ method: 'PUT', path: providerPath('google'), body: { providerId: 'google', displayName: 'Updated', enabled: true, config: { clientId: 'synthetic-google-client', defaultScope: 'openid email' } } }])
  expect(within(screen.getByRole('row', { name: /Updated/ })).getByText(es.secretSet)).toBeVisible()
})

test('a failed dialog save keeps the other fields, clears the secret and shows the localized error', async () => {
  setup({ [`PUT ${providerPath('github')}`]: failure(500, 'req_synthetic_dialog', 'raw backend trace') }); open(); await ready()
  fireEvent.click(button(es.createProvider)); const form = await dialog()
  await chooseTemplate(form, 'GitHub')
  fireEvent.change(field(form, es.fieldClientId), { target: { value: 'synthetic-id' } })
  fireEvent.change(field(form, es.fieldSecret), { target: { value: syntheticSecret } })
  fireEvent.click(within(form).getByRole('button', { name: es.dialogSave }))
  expect(await within(form).findByText(es.errors['5xx'])).toBeVisible()
  expect(screen.queryByText(/raw backend trace/)).not.toBeInTheDocument()
  expect(field(form, es.fieldClientId)).toHaveValue('synthetic-id'); expect(field(form, es.fieldSecret)).toHaveValue('')
  expect(document.body.innerHTML).not.toContain(syntheticSecret)
})

test('a failed dialog save remounts the secret input so the submitted value is not retained', async () => {
  setup({ [`PUT ${providerPath('github')}`]: failure(500, 'req_synthetic_dialog', 'raw backend trace') }); open(); await ready()
  fireEvent.click(button(es.createProvider)); const form = await dialog()
  await chooseTemplate(form, 'GitHub')
  fireEvent.change(field(form, es.fieldClientId), { target: { value: 'synthetic-id' } })
  const before = field(form, es.fieldSecret)
  fireEvent.change(before, { target: { value: syntheticSecret } })
  fireEvent.click(within(form).getByRole('button', { name: es.dialogSave }))
  await within(form).findByText(es.errors['5xx'])
  const after = field(form, es.fieldSecret)
  // The kit input keeps its own copy of the value, so the node must be replaced, not just emptied.
  expect(after).not.toBe(before); expect(after).toHaveValue('')
  expect(before.isConnected).toBe(false)
})

test('closing the dialog returns focus to its trigger', async () => {
  setup(); open(); await ready()
  const trigger = button(es.editNamed.replace('{name}', 'Google')); trigger.focus(); fireEvent.click(trigger)
  const form = await dialog(); fireEvent.click(within(form).getByRole('button', { name: es.cancel }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: providerDialogName })).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(writes()).toEqual([])
})

test('toggling sends only the provider id and the inverted flag and replaces the list', async () => {
  setup({ [`PUT ${providerPath('google')}`]: { identityProviders: [{ ...providers.google, enabled: false }, providers.gitlab] } }); open(); await ready()
  fireEvent.click(button(es.disableNamed.replace('{name}', 'Google')))
  await seen(es.providerUpdated)
  expect(writes()).toEqual([{ method: 'PUT', path: providerPath('google'), body: { providerId: 'google', enabled: false } }])
  expect(button(es.enableNamed.replace('{name}', 'Google'))).toBeVisible()
})

test.each([[409, es.providerConflict], [403, es.errors['403']]] as const)('a toggle failure (%s) shows its message', async (status, message) => {
  setup({ [`PUT ${providerPath('google')}`]: failure(status, 'req_synthetic_toggle', syntheticSecret) }); open(); await ready()
  fireEvent.click(button(es.disableNamed.replace('{name}', 'Google')))
  await seen(message)
  expect(screen.queryByText(syntheticSecret)).not.toBeInTheDocument()
})

test('Copiar URL copies the callback URL and announces it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  setup(); open(); await ready()
  fireEvent.click(screen.getByRole('button', { name: es.copyUrlNamed.replace('{name}', 'Google') }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(callbackUrl))
  await seen(es.urlCopied)
})

test('deleting asks first: cancel sends nothing, confirm sends DELETE and reloads', async () => {
  let reads = 0
  setup({ [`GET ${configPath}`]: () => Response.json(++reads === 1 ? config : { ...config, identityProviders: [providers.gitlab] }), [`DELETE ${providerPath('google')}`]: { deleted: true } }); open(); await ready()
  const trigger = button(es.deleteNamed.replace('{name}', 'Google')); trigger.focus(); fireEvent.click(trigger)
  let confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText(es.deleteDescription.replace('{name}', 'Google'))).toBeVisible(); expect(within(confirm).getByText(es.deleteImpact)).toBeVisible()
  fireEvent.click(within(confirm).getByRole('button', { name: es.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(writes()).toEqual([])
  fireEvent.click(button(es.deleteNamed.replace('{name}', 'Google')))
  confirm = await screen.findByRole('alertdialog')
  fireEvent.click(within(confirm).getByRole('button', { name: es.deleteConfirm }))
  await seen(es.providerDeleted.replace('{name}', 'Google'))
  await waitFor(() => expect(screen.queryByRole('row', { name: /Google/ })).not.toBeInTheDocument())
  expect(calls().map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${configPath}`, `DELETE ${providerPath('google')}`, `GET ${configPath}`])
})

test('a failed delete keeps the confirmation open with its error', async () => {
  setup({ [`DELETE ${providerPath('google')}`]: failure(500, 'req_synthetic_delete', 'raw backend trace') }); open(); await ready()
  fireEvent.click(button(es.deleteNamed.replace('{name}', 'Google')))
  const confirm = await screen.findByRole('alertdialog')
  fireEvent.click(within(confirm).getByRole('button', { name: es.deleteConfirm }))
  expect(await within(confirm).findByText(es.errors['5xx'])).toBeVisible()
  expect(screen.queryByText(/raw backend trace/)).not.toBeInTheDocument()
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(calls().filter(({ method }) => method === 'DELETE')).toHaveLength(1)
})

test('switching the organization reloads that organization and drops the previous data', async () => {
  const other = { ...config, tenantId: 'synthetic-other', realm: 'other-realm', identityProviders: [] }
  setup({ '/dev/null': null, 'GET /v1/tenants/synthetic-other/auth-config': other }); const view = open(); await ready()
  context.value = { ...context.value, activeTenantId: 'synthetic-other' }
  await act(async () => { view.rerender(<StrictMode><MemoryRouter><ConsoleAuthConfigPage /></MemoryRouter></StrictMode>) })
  expect(await screen.findByText('other-realm')).toBeVisible()
  expect(screen.queryByText('synthetic-realm')).not.toBeInTheDocument()
})

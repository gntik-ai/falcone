import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { applicationPath, applicationsGet, applicationsPath, portal, providersPath, webhook } from './parity/pages/console-auth-page.manifest'
import { applicationReads, copy, failure, accepted, fill, open, pageCalls, ready, type Locale, writes } from './consoleAuth-support'

let requests: ReturnType<typeof open>['requests']
const locales: Locale[] = ['es', 'en']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())
const start = async (locale: Locale, routes: Record<string, unknown> = {}, roles?: string[]) => {
  await i18n.changeLanguage(locale)
  ;({ requests } = open({ routes, roles }))
  return ready(locale)
}
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`))
const set = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const saved = (text: string) => screen.findAllByText(text)
const postApplication = `POST ${applicationsPath}`
const putPortal = `PUT ${applicationPath(portal.applicationId)}`
const rowName = (name: string) => screen.getByRole('button', { name })

test.each(locales)('creating an application sends the legacy POST, then exactly one list read, in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { [postApplication]: accepted })
  press(c.apps.createExternal)
  set(c.app.displayName, 'Partner Portal'); set(c.app.slug, 'partner-portal')
  set(c.app.redirectUris, 'https://partner.example.test/callback'); set(c.app.logoutUrl, 'https://partner.example.test/logout'); set(c.app.scopes, 'openid, profile')
  fireEvent.click(screen.getByRole('checkbox', { name: c.flows.oidc_authorization_code_pkce }))
  press(c.app.create)
  expect((await saved(c.feedback.appCreated)).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  const [post] = writes(requests)
  expect(post.method).toBe('POST'); expect(post.path).toBe(applicationsPath)
  expect(post.headers.get('Idempotency-Key')).toBeTruthy()
  expect(post.body).toEqual({
    entityType: 'external_application', displayName: 'Partner Portal', slug: 'partner-portal', protocol: 'oidc', desiredState: 'active', metadata: { managedBy: 'web-console', surface: 'console-auth' },
    redirectUris: ['https://partner.example.test/callback'], login: { redirectUris: ['https://partner.example.test/callback'], defaultRedirectUri: 'https://partner.example.test/callback' },
    logout: { frontChannelLogoutUri: 'https://partner.example.test/logout', postLogoutRedirectUris: ['https://partner.example.test/logout'] },
    scopes: [{ scopeName: 'openid' }, { scopeName: 'profile' }], authenticationFlows: ['oidc_authorization_code_pkce'], federatedProviders: [],
  })
  expect(writes(requests)).toHaveLength(1)
})

test('validation lists every problem, takes focus and sends no request', async () => {
  const c = copy.es
  await start('es')
  press(c.apps.createExternal)
  set(c.app.slug, 'slug-inválido'); set(c.app.redirectUris, 'nota-url')
  press(c.app.create)
  expect(await screen.findByText(c.validation.title)).toBeVisible()
  // The summary links to each invalid field; the field shows the same message inline.
  for (const [label, message] of [[c.app.displayName, c.validation.nameRequired], [c.app.slug, c.validation.slugFormat], [c.app.redirectUris, c.validation.redirectInvalid]]) {
    expect(screen.getByRole('link', { name: `${label}: ${message}` })).toHaveAttribute('href', `#${field(label).id}`)
    expect(screen.getByText(message)).toBeVisible()
    expect(field(label)).toHaveAttribute('aria-invalid', 'true')
  }
  expect(writes(requests)).toEqual([])
  expect(applicationReads(requests)).toHaveLength(1)
})

test('editing keeps the slug read-only and sends the legacy PUT with the existing metadata, then one list read', async () => {
  const c = copy.es
  await start('es', { [putPortal]: accepted })
  fireEvent.click(rowName(fill(c.apps.editNamed, { name: 'Portal Clientes' })))
  expect(field(c.app.slug)).toBeDisabled()
  set(c.app.displayName, 'Portal B2B'); set(c.app.redirectUris, 'https://b2b.example.test/callback')
  press(c.app.save)
  expect((await saved(c.feedback.appUpdated)).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  const [put] = writes(requests)
  expect(put.method).toBe('PUT'); expect(put.path).toBe(applicationPath(portal.applicationId))
  expect(put.body).toMatchObject({ displayName: 'Portal B2B', slug: 'portal-clientes', desiredState: 'active', metadata: { managedBy: 'seed' }, redirectUris: ['https://b2b.example.test/callback'], federatedProviders: portal.federatedProviders })
})

test('a failed save keeps the form values, shows an inline callout and sends no list read', async () => {
  const c = copy.es
  await start('es', { [putPortal]: failure(500) })
  fireEvent.click(rowName(fill(c.apps.editNamed, { name: 'Portal Clientes' })))
  set(c.app.displayName, 'Portal B2B')
  press(c.app.save)
  expect((await screen.findAllByText(c.errors.unavailable)).length).toBeGreaterThan(0)
  expect(field(c.app.displayName)).toHaveValue('Portal B2B')
  expect(screen.queryByText('synthetic-backend-message')).toBeNull()
  expect(applicationReads(requests)).toHaveLength(1)
})

test.each(locales)('soft delete asks for confirmation, sends desiredState soft_deleted and reloads once in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { [putPortal]: accepted })
  fireEvent.click(rowName(fill(c.apps.deleteNamed, { name: 'Portal Clientes' })))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Portal Clientes'); expect(dialog).toHaveTextContent(c.confirm.deleteImpact)
  expect(writes(requests)).toEqual([])
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.confirm }))
  expect((await saved(fill(c.feedback.appDeleted, { name: 'Portal Clientes' }))).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  expect(writes(requests)).toHaveLength(1)
  expect(writes(requests)[0].body).toMatchObject({ desiredState: 'soft_deleted', slug: 'portal-clientes' })
})

test('a failed soft delete keeps the dialog open with the error and reloads nothing', async () => {
  const c = copy.es
  await start('es', { [putPortal]: failure(500) })
  fireEvent.click(rowName(fill(c.apps.deleteNamed, { name: 'Portal Clientes' })))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.confirm }))
  expect(await within(dialog).findByText(c.errors.unavailable)).toBeVisible()
  expect(applicationReads(requests)).toHaveLength(1)
})

test('providers: disabled for api_key applications, add posts idempotently and reloads once', async () => {
  const c = copy.es
  await start('es', { [`POST ${providersPath(portal.applicationId)}`]: accepted })
  expect(screen.getByRole('button', { name: fill(c.apps.providersNamed, { name: webhook.displayName }) })).toBeDisabled()
  fireEvent.click(rowName(fill(c.apps.providersNamed, { name: 'Portal Clientes' })))
  expect(await screen.findByText(fill(c.panel.title, { name: 'Portal Clientes' }))).toBeVisible()
  set(c.provider.providerId, 'new-idp'); set(c.provider.alias, 'Partner IDP'); set(c.provider.displayName, 'Partner Login')
  set(c.provider.authorizationUrl, 'https://partner-idp.example.test/auth'); set(c.provider.tokenUrl, 'https://partner-idp.example.test/token')
  press(c.provider.create)
  expect((await saved(c.feedback.providerAdded)).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  const [post] = writes(requests)
  expect(post.method).toBe('POST'); expect(post.path).toBe(providersPath(portal.applicationId)); expect(post.headers.get('Idempotency-Key')).toBeTruthy()
  expect(post.body).toMatchObject({ providerId: 'new-idp', alias: 'Partner IDP', displayName: 'Partner Login', protocol: 'oidc', providerMode: 'manual_endpoints', enabled: true, authorizationUrl: 'https://partner-idp.example.test/auth', tokenUrl: 'https://partner-idp.example.test/token', requestedScopes: [], metadata: { managedBy: 'web-console', surface: 'console-auth' } })
  expect(writes(requests)).toHaveLength(1)
})

test('providers: editing puts the provider, toggling flips enabled and each reloads once', async () => {
  const c = copy.es
  const providerPath = `${providersPath(portal.applicationId)}/corp-oidc`
  await start('es', { [`PUT ${providerPath}`]: accepted })
  fireEvent.click(rowName(fill(c.apps.providersNamed, { name: 'Portal Clientes' })))
  await screen.findByText(fill(c.panel.title, { name: 'Portal Clientes' }))
  fireEvent.click(screen.getByRole('button', { name: fill(c.panel.disableNamed, { alias: 'Corp OIDC' }) }))
  expect((await saved(fill(c.feedback.providerToggled, { alias: 'Corp OIDC' }))).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  expect(writes(requests)[0]).toMatchObject({ method: 'PUT', path: providerPath, body: { providerId: 'corp-oidc', enabled: false } })
  // After the reload the panel is still open for the same application: edit the provider.
  fireEvent.click(await screen.findByRole('button', { name: fill(c.panel.editNamed, { alias: 'Corp OIDC' }) }))
  expect(field(c.provider.providerId)).toBeDisabled()
  set(c.provider.displayName, 'Corporate OIDC 2')
  press(c.provider.save)
  expect((await saved(c.feedback.providerUpdated)).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(3))
  expect(writes(requests)[1]).toMatchObject({ method: 'PUT', path: providerPath, body: { providerId: 'corp-oidc', displayName: 'Corporate OIDC 2', metadata: { managedBy: 'web-console', surface: 'console-auth' } } })
})

test('providers: detaching puts the application without that provider, behind a confirmation', async () => {
  const c = copy.es
  await start('es', { [putPortal]: accepted })
  fireEvent.click(rowName(fill(c.apps.providersNamed, { name: 'Portal Clientes' })))
  await screen.findByText(fill(c.panel.title, { name: 'Portal Clientes' }))
  fireEvent.click(screen.getByRole('button', { name: fill(c.panel.detachNamed, { alias: 'Corp OIDC' }) }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Corp OIDC'); expect(dialog).toHaveTextContent(c.confirm.detachImpact)
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.confirm }))
  expect((await saved(c.feedback.providerDetached)).length).toBeGreaterThan(0)
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  expect(writes(requests)).toHaveLength(1)
  expect(writes(requests)[0]).toMatchObject({ method: 'PUT', path: applicationPath(portal.applicationId), body: { federatedProviders: [] } })
})

test('provider validation covers the mode-specific rules without sending a request', async () => {
  const c = copy.es
  await start('es')
  fireEvent.click(rowName(fill(c.apps.providersNamed, { name: 'Portal Clientes' })))
  await screen.findByText(fill(c.panel.title, { name: 'Portal Clientes' }))
  fireEvent.click(screen.getByRole('button', { name: fill(c.panel.editNamed, { alias: 'Corp OIDC' }) }))
  set(c.provider.authorizationUrl, 'no-url'); set(c.provider.tokenUrl, ''); set(c.provider.userInfoUrl, 'tampoco')
  press(c.provider.save)
  for (const message of [c.validation.authorizationUrlInvalid, c.validation.tokenUrlInvalid, c.validation.userInfoUrlInvalid]) expect(await screen.findByText(message)).toBeVisible()
  expect(screen.getByRole('link', { name: `${c.provider.tokenUrl}: ${c.validation.tokenUrlInvalid}` })).toBeVisible()
  expect(writes(requests)).toEqual([])
})

test('the list read count never changes across reads when nothing is mutated', async () => {
  await start('es')
  fireEvent.click(rowName(fill(copy.es.apps.providersNamed, { name: 'Portal Clientes' })))
  await screen.findByText(fill(copy.es.panel.title, { name: 'Portal Clientes' }))
  fireEvent.click(screen.getByRole('button', { name: copy.es.panel.close }))
  expect(applicationReads(requests)).toHaveLength(1)
  expect(pageCalls(requests).filter(({ method }) => method !== 'GET')).toEqual([])
  expect(applicationsGet).toContain('limit=100')
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import ConsoleProfile from '../src/pages/consoleProfile'
import { PermissionsProvider } from '../src/shell/permissions'
import { SessionProvider } from '../src/shell/session'
import { changeLocale } from '../src/i18n'
import { login, renderWithSession, strictFetch } from './shell-support'
import es from '../src/locales/es/pages.console-profile-page.json'
import en from '../src/locales/en/pages.console-profile-page.json'

const context = vi.hoisted(() => vi.fn())
vi.mock('../src/shell/context', () => ({
  useConsoleContext: context,
  ConsoleContextProvider: ({ children }: { children: React.ReactNode }) => children,
}))
const activeContext = () => ({
  tenants: [{ tenantId: 'synthetic-tenant', displayName: 'Tenant Alpha' }],
  workspaces: [{ workspaceId: 'synthetic-workspace', displayName: 'Workspace Prod' }],
  activeTenantId: 'synthetic-tenant', activeWorkspaceId: 'synthetic-workspace', loading: false, error: null,
})
let network: ReturnType<typeof strictFetch>
beforeEach(() => {
  context.mockReturnValue(activeContext())
  network = strictFetch({})
})
afterEach(() => {
  network.verify()
  expect(network.mock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
const page = () => <PermissionsProvider><ConsoleProfile /></PermissionsProvider>
const mount = () => renderWithSession(page(), { route: '/console/profile' })
const identity = (copy: typeof es) => screen.getByRole('region', { name: copy.title })

test('ports the legacy tenant-owner identity and no-scaffolding assertions', () => {
  const session = login(['tenant_owner'])
  Object.assign(session.principal!, { username: 'operaciones', displayName: 'Operaciones Plataforma', primaryEmail: 'ops@example.com' })
  persistConsoleShellSession(session)
  mount()
  expect(screen.getByRole('heading', { name: /perfil de usuario/i })).toBeInTheDocument()
  expect(screen.getByText('Operaciones Plataforma')).toBeInTheDocument()
  expect(screen.getByText('tenant_owner')).toBeInTheDocument()
  const text = document.body.textContent ?? ''
  for (const value of ['ops@example.com', 'Tenant Alpha', 'Workspace Prod']) expect(text).toContain(value)
  for (const pattern of [/EP-\d+/, /US-UI/i, /consola base/i, /pantalla temporal/i, /entrada base/i, /iteración posterior/i]) expect(text).not.toMatch(pattern)
})

test('ports exactly two missing-context fallbacks', () => {
  login(['tenant_owner'])
  context.mockReturnValue({ ...activeContext(), activeTenantId: null, activeWorkspaceId: null })
  mount()
  expect(screen.getAllByText('Ninguna seleccionada')).toHaveLength(2)
})

for (const [locale, copy] of [['es', es], ['en', en]] as const) {
  test(`renders two raw roles, the highest role and semantic identity in ${locale}`, async () => {
    await changeLocale(locale)
    const session = login(['platform_auditor', 'tenant_admin'])
    mount()
    expect(screen.getByRole('heading', { name: copy.title, level: 1 })).toBeVisible()
    expect(screen.getByText(copy.roles.labels.tenant_admin)).toBeVisible()
    for (const role of session.principal!.platformRoles!) expect(screen.getByText(role)).toBeVisible()
    const card = identity(copy)
    expect(within(card).getByRole('heading', { name: session.principal!.displayName!, level: 2 })).toBeVisible()
    for (const label of Object.values(copy.fields)) expect(within(card).getByText(label).tagName).toBe('DT')
    expect(card.querySelectorAll('dt')).toHaveLength(card.querySelectorAll('dd').length)
    expect(document.querySelectorAll('input:not([aria-hidden="true"]), textarea, [type="submit"]')).toHaveLength(0)
    expect(document.body).not.toHaveTextContent(/Acme|req_8f2c41d07a9b|Add policy|Save changes|Discard/)
  })

  test(`renders the empty-session and no-roles copy without actions in ${locale}`, async () => {
    await changeLocale(locale)
    const session = login([])
    Object.assign(session.principal!, { displayName: undefined, username: undefined, primaryEmail: undefined })
    persistConsoleShellSession(session)
    context.mockReturnValue({ ...activeContext(), tenants: [], workspaces: [], activeTenantId: null, activeWorkspaceId: null })
    mount()
    expect(screen.getAllByText(copy.missingIdentity)).toHaveLength(2)
    expect(screen.getAllByText(copy.missingContext)).toHaveLength(2)
    expect(screen.getByText(copy.roles.labels.none)).toBeVisible()
    expect(screen.getByRole('heading', { name: copy.principalFallback })).toBeVisible()
    expect(screen.getByText(copy.secondaryFallback)).toBeVisible()
    const roles = screen.getByRole('region', { name: copy.roles.title })
    expect(within(roles).getByRole('heading', { name: copy.roles.emptyTitle })).toBeVisible()
    expect(within(roles).getByText(copy.roles.emptyDescription)).toBeVisible()
    expect(within(roles).queryByRole('button')).toBeNull()
    expect(within(roles).queryByRole('link')).toBeNull()
  })

  test(`hides identity and badges until the context resolves in ${locale}`, async () => {
    await changeLocale(locale)
    const session = login(['tenant_admin', 'platform_auditor'])
    context.mockReturnValue({ ...activeContext(), loading: true })
    const view = mount()
    expect(within(identity(copy)).getByRole('status')).toHaveTextContent(copy.loading.identity)
    expect(within(screen.getByRole('region', { name: copy.roles.title })).getByRole('status')).toHaveTextContent(copy.loading.roles)
    for (const value of [session.principal!.username!, session.principal!.primaryEmail!, 'tenant_admin', 'platform_auditor']) expect(document.body).not.toHaveTextContent(value)
    context.mockReturnValue(activeContext())
    view.rerender(<MemoryRouter><SessionProvider value={session}>{page()}</SessionProvider></MemoryRouter>)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('tenant_admin')).toBeVisible()
    expect(screen.getByText(session.principal!.username!)).toBeVisible()
  })

  for (const status of [403, 404, 500, 502, undefined]) {
    test(`keeps identity and roles but removes stale context for ${status ?? 'network'} in ${locale}`, async () => {
      await changeLocale(locale)
      login(['tenant_admin', 'platform_auditor'])
      context.mockReturnValue({ ...activeContext(), error: { status } })
      mount()
      const title = status === 403 ? copy.context.noAccessTitle : status === 404 ? copy.context.notFoundTitle : copy.context.errorTitle
      expect(screen.getByRole('heading', { name: title })).toBeVisible()
      for (const role of ['tenant_admin', 'platform_auditor']) expect(screen.getByText(role)).toBeVisible()
      expect(document.body).not.toHaveTextContent(/Tenant Alpha|Workspace Prod|req_8f2c41d07a9b|Reintentar|Retry|Request access|Solicitar acceso/)
      expect(screen.queryByRole('button')).toBeNull()
      if (status === 403 || status === 404) expect(screen.getByRole('link', { name: copy.context.back })).toHaveAttribute('href', '/console')
      else if (status) expect(screen.getByText(String(status))).toBeVisible()
    })
  }

  test(`updates selected context without remounting the page in ${locale}`, async () => {
    await changeLocale(locale)
    const session = login(['tenant_owner'])
    const view = mount()
    context.mockReturnValue({ ...activeContext(), tenants: [{ tenantId: 'other', displayName: 'Tenant Beta' }], workspaces: [{ workspaceId: 'other-workspace', displayName: 'Workspace Test' }], activeTenantId: 'other', activeWorkspaceId: 'other-workspace' })
    view.rerender(<MemoryRouter><SessionProvider value={session}>{page()}</SessionProvider></MemoryRouter>)
    expect(screen.getByText('Tenant Beta')).toBeVisible()
    expect(screen.getByText('Workspace Test')).toBeVisible()
    expect(screen.queryByText('Tenant Alpha')).toBeNull()
  })

  for (const roles of [['tenant_viewer'], ['platform_auditor'], []]) {
    test(`allows any authenticated session with ${roles.join(', ') || 'no roles'} in ${locale}`, async () => {
      await changeLocale(locale)
      login(roles)
      render(<MemoryRouter initialEntries={['/console/profile']}><App /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: copy.title, level: 1 })).toBeVisible()
    })
  }
}

function Location() {
  const navigate = useNavigate()
  return <>
    <output data-testid="profile-location">{useLocation().pathname}</output>
    <button onClick={() => navigate(-1)}>Back</button>
  </>
}
test.each(['/', '/next'])('uses in-app profile navigation under basename %s', async (basename) => {
  login(['tenant_owner'])
  const prefix = basename === '/' ? '' : basename
  render(<MemoryRouter basename={basename} initialEntries={[`${prefix}/console/profile`]}><App /><Location /></MemoryRouter>)
  const profile = await screen.findByRole('link', { name: 'Perfil' })
  expect(profile).toHaveAttribute('href', `${prefix}/console/profile`)
  expect(profile).toHaveAttribute('aria-current', 'page')
  profile.focus()
  expect(profile).toHaveFocus()
  expect(fireEvent.click(screen.getByRole('link', { name: 'Ajustes' }))).toBe(false)
  expect(await screen.findByRole('heading', { name: 'Ajustes de consola', level: 1 })).toBeVisible()
  expect(screen.getByTestId('profile-location')).toHaveTextContent('/console/settings')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByRole('heading', { name: es.title, level: 1 })).toBeVisible()
  expect(screen.getByTestId('profile-location')).toHaveTextContent('/console/profile')
})

test.each(['/', '/next'])('the compact section select navigates once under basename %s', async (basename) => {
  login(['tenant_owner'])
  const prefix = basename === '/' ? '' : basename
  render(<MemoryRouter basename={basename} initialEntries={[`${prefix}/console/profile`]}><App /><Location /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('combobox', { name: es.nav.label }))
  const option = within(await screen.findByRole('listbox')).getByRole('option', { name: es.nav.settings })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  expect(await screen.findByRole('heading', { name: 'Ajustes de consola', level: 1 })).toBeVisible()
  expect(screen.getByTestId('profile-location')).toHaveTextContent('/console/settings')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByRole('heading', { name: es.title, level: 1 })).toBeVisible()
  expect(screen.getByTestId('profile-location')).toHaveTextContent('/console/profile')
})

test.each([403, 404])('the %s back link reaches the console start', async (status) => {
  login(['tenant_owner'])
  context.mockReturnValue({ ...activeContext(), error: { status } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/profile']}><App /><Location /></MemoryRouter>)
  const back = await screen.findByRole('link', { name: es.context.back })
  expect(back).toHaveAttribute('href', '/console')
  back.focus()
  expect(back).toHaveFocus()
})

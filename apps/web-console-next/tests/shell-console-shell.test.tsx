import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { I18nProvider } from '@gntik-ai/ui'
import { App } from '../src/App'
import { Shell } from '../src/shell/Shell'
import { changeLocale } from '../src/i18n'
import { ready } from './parity/pages/consoleRuntime.manifest'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'

const contextKey = 'in-falcone.console-active-context'
const tenants = { items: [{ tenantId: 't1', displayName: 'Tenant One' }, { tenantId: 't2', displayName: 'Tenant Two' }] }
const workspaces = { items: [{ workspaceId: 'w1', tenantId: 't1', displayName: 'Workspace One' }, { workspaceId: 'w2', tenantId: 't1', displayName: 'Workspace Two' }] }
const names = { es: { region: 'Contexto activo', nav: 'Navegación de consola', account: /^Menú de la cuenta de Synthetic Operator$/, signOut: 'Cerrar sesión', workspace: 'Área de trabajo activa', tenant: 'Organización activa' },
  en: { region: 'Active context', nav: 'Console navigation', account: /^Account menu for Synthetic Operator$/, signOut: 'Sign out', workspace: 'Active workspace', tenant: 'Active tenant' } }

// Captured from the pre-ConsoleShell frame (label|href|aria-current) for the es locale on /console/overview.
const navBeforeConsoleShell: Record<string, string[]> = {
  superadmin: [
    'Runtime de funciones|/console/runtime|',
    'Vista general|/console/overview|page',
    'Mi plan|/console/my-plan|',
    'Resumen de asignación|/console/my-plan/allocation|',
    'Gestión de organizaciones|/console/tenants|',
    'Gestión de áreas de trabajo|/console/workspaces|',
    'DB del área de trabajo|/console/database|',
    'Servidores MCP|/console/mcp/servers|',
    'Flujos / workflows|/console/flows|',
    'Funciones: registro|/console/functions-registry|',
    'Funciones: administrar|/console/functions|',
    'Funciones: despliegue rápido|/console/functions/data|',
    'Acceso IAM|/console/iam-access|',
    'Miembros|/console/members|',
    'Planes|/console/plans|',
    'Autenticación|/console/auth|',
    'Autenticación de la organización|/console/auth-config|',
    'PostgreSQL|/console/postgres|',
    'MongoDB|/console/mongo|',
    'Kafka|/console/kafka|',
    'Datos: Postgres|/console/postgres/data|',
    'Datos: Mongo|/console/mongo/data|',
    'Datos: eventos|/console/events/data|',
    'Datos: tiempo real|/console/realtime/changes|',
    'Almacenamiento|/console/storage|',
    'Operaciones|/console/operations|',
    'Observabilidad|/console/observability|',
    'Cuentas de servicio|/console/service-accounts|',
    'Secretos del área de trabajo|/console/workspace-secrets|',
    'Cuotas|/console/quotas|',
  ],
  platform_admin: [
    'Runtime de funciones|/console/runtime|',
    'Vista general|/console/overview|page',
    'Mi plan|/console/my-plan|',
    'Resumen de asignación|/console/my-plan/allocation|',
    'Gestión de organizaciones|/console/tenants|',
    'Gestión de áreas de trabajo|/console/workspaces|',
    'DB del área de trabajo|/console/database|',
    'Servidores MCP|/console/mcp/servers|',
    'Flujos / workflows|/console/flows|',
    'Funciones: registro|/console/functions-registry|',
    'Funciones: administrar|/console/functions|',
    'Funciones: despliegue rápido|/console/functions/data|',
    'Miembros|/console/members|',
    'Autenticación de la organización|/console/auth-config|',
    'PostgreSQL|/console/postgres|',
    'MongoDB|/console/mongo|',
    'Kafka|/console/kafka|',
    'Datos: Postgres|/console/postgres/data|',
    'Datos: Mongo|/console/mongo/data|',
    'Datos: eventos|/console/events/data|',
    'Datos: tiempo real|/console/realtime/changes|',
    'Almacenamiento|/console/storage|',
    'Operaciones|/console/operations|',
    'Observabilidad|/console/observability|',
    'Cuentas de servicio|/console/service-accounts|',
    'Secretos del área de trabajo|/console/workspace-secrets|',
    'Cuotas|/console/quotas|',
  ],
  platform_operator: [
    'Runtime de funciones|/console/runtime|',
    'Vista general|/console/overview|page',
    'Mi plan|/console/my-plan|',
    'Resumen de asignación|/console/my-plan/allocation|',
    'Gestión de organizaciones|/console/tenants|',
    'Gestión de áreas de trabajo|/console/workspaces|',
    'DB del área de trabajo|/console/database|',
    'Servidores MCP|/console/mcp/servers|',
    'Flujos / workflows|/console/flows|',
    'Funciones: registro|/console/functions-registry|',
    'Funciones: administrar|/console/functions|',
    'Funciones: despliegue rápido|/console/functions/data|',
    'Miembros|/console/members|',
    'Autenticación de la organización|/console/auth-config|',
    'PostgreSQL|/console/postgres|',
    'MongoDB|/console/mongo|',
    'Kafka|/console/kafka|',
    'Datos: Postgres|/console/postgres/data|',
    'Datos: Mongo|/console/mongo/data|',
    'Datos: eventos|/console/events/data|',
    'Datos: tiempo real|/console/realtime/changes|',
    'Almacenamiento|/console/storage|',
    'Operaciones|/console/operations|',
    'Observabilidad|/console/observability|',
    'Cuentas de servicio|/console/service-accounts|',
    'Secretos del área de trabajo|/console/workspace-secrets|',
    'Cuotas|/console/quotas|',
  ],
  platform_auditor: [
    'Runtime de funciones|/console/runtime|',
    'Vista general|/console/overview|page',
    'Mi plan|/console/my-plan|',
    'Resumen de asignación|/console/my-plan/allocation|',
    'Servidores MCP|/console/mcp/servers|',
    'Flujos / workflows|/console/flows|',
    'Miembros|/console/members|',
    'Autenticación de la organización|/console/auth-config|',
    'PostgreSQL|/console/postgres|',
    'MongoDB|/console/mongo|',
    'Kafka|/console/kafka|',
    'Datos: Postgres|/console/postgres/data|',
    'Datos: Mongo|/console/mongo/data|',
    'Datos: eventos|/console/events/data|',
    'Datos: tiempo real|/console/realtime/changes|',
    'Almacenamiento|/console/storage|',
    'Operaciones|/console/operations|',
    'Observabilidad|/console/observability|',
    'Cuotas|/console/quotas|',
    'Gestión de áreas de trabajo|/console/workspaces|',
    'DB del área de trabajo|/console/database|',
    'Funciones: registro|/console/functions-registry|',
    'Funciones: administrar|/console/functions|',
    'Funciones: despliegue rápido|/console/functions/data|',
    'Cuentas de servicio|/console/service-accounts|',
  ],
  tenant_owner: [
    'Runtime de funciones|/console/runtime|',
    'Vista general|/console/overview|page',
    'Mi plan|/console/my-plan|',
    'Resumen de asignación|/console/my-plan/allocation|',
    'Gestión de áreas de trabajo|/console/workspaces|',
    'DB del área de trabajo|/console/database|',
    'Servidores MCP|/console/mcp/servers|',
    'Flujos / workflows|/console/flows|',
    'Funciones: registro|/console/functions-registry|',
    'Funciones: administrar|/console/functions|',
    'Funciones: despliegue rápido|/console/functions/data|',
    'Miembros|/console/members|',
    'Autenticación de la organización|/console/auth-config|',
    'PostgreSQL|/console/postgres|',
    'MongoDB|/console/mongo|',
    'Kafka|/console/kafka|',
    'Datos: Postgres|/console/postgres/data|',
    'Datos: Mongo|/console/mongo/data|',
    'Datos: eventos|/console/events/data|',
    'Datos: tiempo real|/console/realtime/changes|',
    'Almacenamiento|/console/storage|',
    'Operaciones|/console/operations|',
    'Observabilidad|/console/observability|',
    'Cuentas de servicio|/console/service-accounts|',
    'Secretos del área de trabajo|/console/workspace-secrets|',
    'Cuotas|/console/quotas|',
  ],
}

let requests: ReturnType<typeof strictFetch>
beforeEach(async () => { await changeLocale('es'); localStorage.clear() })
afterEach(() => { cleanup(); requests?.verify() })

function CurrentLocation() {
  const { pathname } = useLocation()
  return <output aria-label="Current location">{pathname}</output>
}
function openApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><CurrentLocation /><App /></MemoryRouter>)
}
const findSidebar = (locale: 'es' | 'en' = 'es') => screen.findByRole('complementary', { name: names[locale].nav })
const sidebar = (locale: 'es' | 'en' = 'es') => screen.getByRole('complementary', { name: names[locale].nav })

test('the frame source renders ConsoleShell and no longer composes SidebarLayout, AppSidebar or MobileNav', () => {
  const source = readFileSync(resolve(__dirname, '../src/shell/Shell.tsx'), 'utf8')
  expect(source).toMatch(/import \{[^}]*\bConsoleShell\b[^}]*\} from '@gntik-ai\/templates'/)
  for (const forbidden of ['SidebarLayout', 'AppSidebar', 'MobileNav']) expect(source).not.toMatch(new RegExp(`\\b${forbidden}\\b`))
})

test('the sidebar footer owns the account menu and the topbar carries no second user menu or Admin link', async () => {
  login(['superadmin'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  openApp('/console/overview')
  await screen.findByRole('heading', { name: 'Vista general de la consola' })
  expect(within(sidebar()).getByRole('button', { name: names.es.account })).toBeVisible()
  expect(screen.getAllByRole('button', { name: names.es.account })).toHaveLength(1)
  expect(screen.queryByRole('link', { name: 'Consola de administración' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: names.es.account }))
  expect(await screen.findByRole('menuitem', { name: 'Consola de administración' })).toBeVisible()
})

test.each([['Fallback User', 'Fallback User'], ['', 'synthetic-user']])('the account menu names the principal by displayName %j, then username', async (displayName, shown) => {
  const session = login(['tenant_owner'])
  session.principal!.displayName = displayName
  persistConsoleShellSession(session)
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  openApp('/console/overview')
  await screen.findByRole('heading', { name: 'Vista general de la consola' })
  fireEvent.click(within(sidebar()).getByRole('button', { name: `Menú de la cuenta de ${shown}` }))
  expect(await screen.findByText('synthetic@example.test')).toBeVisible()
})

test.each(['es', 'en'] as const)('the context region sits in the sidebar with its accessible name and settles aria-busy in %s', async (locale) => {
  await changeLocale(locale)
  login(['tenant_owner'], ['t1'])
  requests = strictFetch({ 'GET /v1/tenants/t1': { tenantId: 't1', displayName: 'Tenant One' }, [`GET ${workspaceUrl('t1')}`]: workspaces })
  openApp('/console/overview')
  const region = await screen.findByRole('region', { name: names[locale].region })
  expect(sidebar(locale)).toContainElement(region)
  expect(region.closest('main')).toBeNull()
  await waitFor(() => expect(region).toHaveAttribute('aria-busy', 'false'))
  expect(within(region).getByRole('combobox', { name: names[locale].tenant })).toBeVisible()
  expect(within(region).getByRole('button', { name: names[locale].workspace })).toBeVisible()
})

test('selecting a workspace in the sidebar header persists it without changing the pathname', async () => {
  login(['tenant_owner'], ['t1'])
  localStorage.setItem(contextKey, JSON.stringify({ userId: 'synthetic-user', tenantId: 't1', workspaceId: 'w1', updatedAt: '2026-01-01' }))
  requests = strictFetch({ 'GET /v1/tenants/t1': { tenantId: 't1', displayName: 'Tenant One' }, [`GET ${workspaceUrl('t1')}`]: workspaces })
  openApp('/console/overview')
  const switcher = await within(await findSidebar()).findByRole('button', { name: /Workspace One/ })
  expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/overview')
  fireEvent.click(switcher)
  fireEvent.click(await screen.findByRole('menuitemradio', { name: /Workspace Two/ }))
  await waitFor(() => expect(JSON.parse(localStorage.getItem(contextKey)!)).toMatchObject({ tenantId: 't1', workspaceId: 'w2' }))
  expect(within(sidebar()).getByRole('button', { name: /Workspace Two/ })).toBeVisible()
  expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/console\/overview$/)
})

test('selecting a tenant in the sidebar header switches the stored context and clears the route workspace override', async () => {
  login(['tenant_owner'], ['t1', 't2'])
  localStorage.setItem(contextKey, JSON.stringify({ userId: 'synthetic-user', tenantId: 't1', workspaceId: 'w1', updatedAt: '2026-01-01' }))
  requests = strictFetch({
    'GET /v1/workspaces/w2/consumption': { workspaceId: 'w2', tenantId: 't1', snapshotAt: '2026-06-01T12:00:00Z', dimensions: [] },
    'GET /v1/tenants/t1': tenants.items[0], 'GET /v1/tenants/t2': tenants.items[1],
    [`GET ${workspaceUrl('t1')}`]: workspaces, [`GET ${workspaceUrl('t2')}`]: { items: [] }
  })
  openApp('/console/workspaces/w2')
  expect(await within(await findSidebar()).findByRole('button', { name: /Workspace Two/ })).toBeVisible()
  fireEvent.click(within(sidebar()).getByRole('combobox', { name: names.es.tenant }))
  const option = await screen.findByRole('option', { name: 'Tenant Two' })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  await waitFor(() => expect(JSON.parse(localStorage.getItem(contextKey)!)).toEqual({ userId: 'synthetic-user', tenantId: 't2', workspaceId: null, updatedAt: expect.any(String) }))
})

test.each([['network', () => { throw new TypeError('Synthetic network failure') }], ['server error', () => new Response(null, { status: 500 })]] as const)('sign-out from the sidebar footer still lands on the login page after a %s failure', async (_label, respond) => {
  login(['tenant_owner'])
  requests = strictFetch({ 'GET /v1/auth/signups/policy': { registrationEnabled: false }, 'DELETE /v1/auth/login-sessions/synthetic-session': respond })
  renderWithSession(<I18nProvider locale="es"><CurrentLocation /><Routes>
    <Route path="/console" element={<Shell />}><Route path="overview" element={<h1>Overview page</h1>} /></Route>
    <Route path={consoleAuthConfig.loginPath} element={<h1>Configured login</h1>} />
  </Routes></I18nProvider>)
  fireEvent.click(await within(await findSidebar()).findByRole('button', { name: names.es.account }))
  fireEvent.click(await screen.findByRole('menuitem', { name: names.es.signOut }))
  expect(await screen.findByRole('heading', { name: 'Configured login' })).toBeVisible()
  expect(screen.getByLabelText('Current location')).toHaveTextContent(consoleAuthConfig.loginPath)
})

test.each(['plans', 'runtime'])('platform-global %s renders no context controls in the sidebar or the drawer', async (path) => {
  login()
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, 'GET /v1/platform/runtime/knative': ready, 'GET /v1/plans?page=1&pageSize=20': { items: [], total: 0, page: 1, pageSize: 20 } })
  openApp(`/console/${path}`)
  await screen.findByRole('heading', { name: path === 'runtime' ? 'Runtime de funciones' : 'Catálogo de planes' })
  const desktop = await findSidebar()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir navegación' }))
  const drawer = await screen.findByRole('dialog')
  for (const scope of [desktop, drawer]) {
    expect(within(scope).queryByRole('region', { name: 'Contexto activo', hidden: true })).not.toBeInTheDocument()
    expect(within(scope).queryByRole('combobox', { hidden: true })).not.toBeInTheDocument()
    expect(within(scope).queryByRole('button', { name: names.es.workspace, hidden: true })).not.toBeInTheDocument()
  }
})

test.each(['es', 'en'] as const)('the 375 px drawer repeats the nav hrefs, context controls and account menu, and closes after a nav click in %s', async (locale) => {
  await changeLocale(locale)
  login(['tenant_owner'], ['t1'])
  requests = strictFetch({ 'GET /v1/tenants/t1': tenants.items[0], [`GET ${workspaceUrl('t1')}`]: workspaces })
  openApp('/console/overview')
  await screen.findByRole('heading', { name: locale === 'es' ? 'Vista general de la consola' : 'Console overview' })
  const hrefs = (scope: HTMLElement) => Array.from(scope.querySelectorAll('nav a')).map((link) => link.getAttribute('href'))
  const desktop = hrefs(screen.getByRole('complementary', { name: names[locale].nav }))
  fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation' }))
  const drawer = await screen.findByRole('dialog')
  expect(hrefs(drawer)).toEqual(desktop)
  expect(within(drawer).getByRole('region', { name: names[locale].region })).toBeVisible()
  expect(within(drawer).getByRole('combobox', { name: names[locale].tenant })).toBeVisible()
  expect(within(drawer).getByRole('button', { name: names[locale].account })).toBeVisible()
  fireEvent.click(within(drawer).getByRole('link', { name: /Flujos|Flows/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('the theme control cycles light and dark, persists in falcone-next-theme and defaults to dark', async () => {
  login(['tenant_owner'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  const theme = () => screen.findByRole('button', { name: /^Tema: / })
  const first = openApp('/console/overview')
  expect(localStorage.getItem('falcone-next-theme')).toBeNull()
  expect(await theme()).toHaveAccessibleName(/^Tema: Oscuro/)
  expect(document.documentElement).toHaveClass('dark')
  expect(screen.queryByRole('button', { name: /Notific/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Buscar|Search/i })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Tema: / })).toHaveLength(1)
  for (let i = 0; i < 4 && localStorage.getItem('falcone-next-theme') !== 'light'; i++) fireEvent.click(await theme())
  expect(localStorage.getItem('falcone-next-theme')).toBe('light')
  await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
  first.unmount()
  openApp('/console/overview')
  expect(await theme()).toHaveAccessibleName(/^Tema: Claro/)
  for (let i = 0; i < 4 && localStorage.getItem('falcone-next-theme') !== 'dark'; i++) fireEvent.click(await theme())
  expect(localStorage.getItem('falcone-next-theme')).toBe('dark')
  await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
})

test.each(Object.keys(navBeforeConsoleShell))('the navigation labels, hrefs and current state for %s match the pre-ConsoleShell frame', async (role) => {
  login([role], ['t1'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, 'GET /v1/tenants/t1': { tenantId: 't1', displayName: 'Tenant One' }, [`GET ${workspaceUrl('t1')}`]: { items: [] } })
  openApp('/console/overview')
  const nav = within(await findSidebar()).getByRole('navigation', { name: names.es.nav })
  expect(Array.from(nav.querySelectorAll('a')).map((link) => `${link.textContent}|${link.getAttribute('href')}|${link.getAttribute('aria-current') ?? ''}`)).toEqual(navBeforeConsoleShell[role])
})

test('the scrolling main holds a keyboard tab stop even when the page content is inert', async () => {
  login(['tenant_owner'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  openApp('/console/overview')
  await screen.findByRole('heading', { name: 'Vista general de la consola' })
  const main = screen.getByRole('main')
  const stop = main.firstElementChild as HTMLElement
  expect(stop).toHaveAttribute('tabindex', '0')
  expect(stop.contains(screen.getByRole('heading', { name: 'Vista general de la consola' }))).toBe(true)
  stop.focus()
  expect(document.activeElement).toBe(stop)
})

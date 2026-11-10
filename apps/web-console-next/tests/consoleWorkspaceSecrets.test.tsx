import { readFileSync } from 'node:fs'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { login } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-workspace-secrets-page.json'
import en from '../src/locales/en/pages.console-workspace-secrets-page.json'
import { currentContext, gate, open, serve, setRoles, usedFixtures, workspaceContext } from './consoleWorkspaceSecrets-support'
import { canary, cursorPath, fixtureIds, secretsPath, typed } from './parity/pages/console-workspace-secrets-page.manifest'

let server: ReturnType<typeof serve>
beforeEach(() => { login(); workspaceContext('dev') })
afterEach(() => expect(server?.unmatched).toEqual([]))

const nameField = () => screen.getByLabelText('Nombre del secreto') as HTMLInputElement
const valueField = () => screen.getByLabelText('Valor del secreto') as HTMLInputElement
const descriptionField = () => screen.getByLabelText('Descripción del secreto (opcional)') as HTMLInputElement
const set = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
// Clearing is asserted as a boolean so a failure never prints the value.
const isBlank = (element: HTMLElement) => (element as HTMLInputElement).value === ''
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const listCalls = () => server.requests().filter(({ method }) => method === 'GET')

test('lists metadata rows with name, environment variable, function count, localized dates and a dash for missing values', async () => {
  server = serve('workspace-secrets.list.success')
  open()
  expect(await screen.findByRole('heading', { level: 1, name: 'Secretos del área de trabajo' })).toBeVisible()
  const table = await screen.findByRole('table')
  expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['db_password', 'api_key', 'smtp_user'])
  expect(within(table).getByText('DB_PASSWORD')).toBeVisible()
  expect(within(table).getByText('Synthetic database credential')).toBeVisible()
  // smtp_user has null timestamps: a dash, never 1 January 1970.
  const row = within(table).getByText('smtp_user').closest('tr')!
  expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(3)
  expect(row.querySelector('time')).toBeNull()
  expect(table.querySelectorAll('time').length).toBe(4)
  expect(screen.getByText('3 secretos')).toBeVisible()
  expect(within(table).getByText('Funciones que lo usan')).toBeVisible()
  expect(screen.getByText('Recuento informativo; puede ir por detrás del último despliegue.')).toBeVisible()
  expect(server.requests()).toEqual([{ method: 'GET', path: secretsPath, body: undefined }])
  expect(document.body.textContent).not.toContain(canary)
})

test('responsive columns hide header and body cells together, with no data-table control', async () => {
  server = serve('workspace-secrets.list.success')
  open()
  const table = await screen.findByRole('table')
  for (const [header, hidden] of [['Descripción', 'md'], ['Creado', 'lg'], ['Actualizado', 'xl']] as const) {
    const th = within(table).getByRole('columnheader', { name: header })
    expect(th).toHaveClass('hidden', `${hidden}:table-cell`)
    const index = Array.from(th.parentElement!.children).indexOf(th)
    for (const row of table.querySelectorAll('tbody tr')) expect(row.children[index]).toHaveClass('hidden', `${hidden}:table-cell`)
  }
  expect(table.closest('section')!.querySelector('caption, [role="status"]')).not.toBeNull()
  expect(screen.queryByRole('button', { name: /columnas|columns|densidad|density|vistas|views/i })).toBeNull()
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
})

test.each([['production', 'Producción'], ['prod', 'Producción'], ['staging', 'Entorno: staging']])('shows the %s environment badge inside the page header', async (environment, label) => {
  workspaceContext(environment)
  server = serve(environment === 'staging' ? 'shell.workspace-staging' : 'shell.workspace-production')
  open()
  const badge = await screen.findByTestId('workspace-secrets-stage-badge')
  expect(badge).toHaveTextContent(label)
  expect(badge.closest('dl')).not.toBeNull()
  expect(screen.getByText('Synthetic Tenant · Synthetic Workspace')).toBeVisible()
})

test('lists the breadcrumbs with the workspace link and the header badge copy', async () => {
  server = serve('workspace-secrets.list.success')
  open()
  const nav = await screen.findByRole('navigation', { name: 'Navegación de secretos del área de trabajo' })
  expect(within(nav).getByRole('link', { name: 'Áreas de trabajo' })).toHaveAttribute('href', '/console/workspaces')
  expect(within(nav).getByRole('link', { name: 'Synthetic Workspace' })).toHaveAttribute('href', '/console/workspaces/synthetic-workspace')
  expect(within(nav).getByText('Secretos')).toBeVisible()
  expect(screen.getAllByText('Secretos del área de trabajo').length).toBeGreaterThanOrEqual(2)
})

test('shows a loading skeleton for a delayed first request and the create form stays usable', async () => {
  server = serve('workspace-secrets.list.delayed')
  open()
  expect(screen.getByRole('status', { name: 'Cargando secretos' })).toBeVisible()
  expect(nameField()).not.toBeDisabled()
  expect(await screen.findByText('db_password')).toBeVisible()
  expect(screen.queryByRole('status', { name: 'Cargando secretos' })).toBeNull()
})

test.each([['dev', 'El área de trabajo "Synthetic Workspace" (dev) todavía no tiene secretos. Crea uno con el formulario de arriba.'], [null, 'El área de trabajo "Synthetic Workspace" todavía no tiene secretos. Crea uno con el formulario de arriba.']])('renders the first-run empty state for environment %s without a dangling separator', async (environment, description) => {
  workspaceContext(environment)
  server = serve('workspace-secrets.list.empty')
  open()
  expect(await screen.findByRole('heading', { name: 'No hay secretos en esta área de trabajo' })).toBeVisible()
  expect(screen.getByText(description)).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  // The empty-state action focuses the create form.
  click('Crear el primer secreto')
  await waitFor(() => expect(nameField()).toHaveFocus())
})

test('renders a non-array items response as an empty list', async () => {
  server = serve('workspace-secrets.list.empty')
  open()
  await screen.findByRole('heading', { name: 'No hay secretos en esta área de trabajo' })
})

test('a 501 renders only the blocked state with the header and breadcrumbs', async () => {
  server = serve('workspace-secrets.list.501')
  open()
  expect(await screen.findByRole('heading', { name: 'Servicio de secretos no disponible' })).toBeVisible()
  expect(screen.getByText(/OpenBao no está habilitado|OpenBao\) no está habilitado/)).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Navegación de secretos del área de trabajo' })).toBeVisible()
  expect(screen.queryByRole('toolbar')).toBeNull()
  expect(screen.queryByLabelText('Valor del secreto')).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Nuevo secreto' })).toBeNull()
})

test('a list 403 renders the no-access state with the legacy message and correlation id, without request access', async () => {
  server = serve('workspace-secrets.list.403')
  open()
  expect(await screen.findByRole('heading', { name: 'No tienes acceso a los secretos de esta área de trabajo' })).toBeVisible()
  expect(screen.getByText(`No tienes permisos para esta acción en esta área de trabajo. La autorización la decide el servidor. (correlación ${typed.correlationId})`)).toBeVisible()
  expect(screen.queryByRole('button', { name: /solicitar acceso|request access/i })).toBeNull()
  // A first-load failure never moves focus.
  expect(document.body).toHaveFocus()
})

test('a list 404 renders the non-leaking in-page not-found state', async () => {
  server = serve('workspace-secrets.list.404')
  open()
  expect(await screen.findByRole('heading', { name: 'Área de trabajo no disponible' })).toBeVisible()
  expect(screen.getByText(`El recurso no está disponible para este contexto. (correlación ${typed.correlationId})`)).toBeVisible()
  expect(document.body).toHaveFocus()
})

test('a list 500 then network then success shows the request id, clears rows and retries from the first page', async () => {
  server = serve('workspace-secrets.list.500-then-network-then-success')
  open()
  expect(await screen.findByRole('heading', { name: 'No se pudieron cargar los secretos' })).toBeVisible()
  expect(screen.getByText(typed.requestId)).toBeVisible()
  expect(document.body).toHaveFocus()
  click('Reintentar')
  await waitFor(() => expect(screen.queryByText(typed.requestId)).toBeNull())
  // The network failure shows no request id; the failed read left no stale rows.
  expect(await screen.findByRole('heading', { name: 'No se pudieron cargar los secretos' })).toBeVisible()
  expect(screen.queryByText(typed.requestId)).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toHaveFocus())
  click('Reintentar')
  expect(await screen.findByText('db_password')).toBeVisible()
  expect(listCalls().every(({ path }) => path === secretsPath)).toBe(true)
  expect(listCalls()).toHaveLength(3)
})

test('validates the name and value before any request and clears each error on edit', async () => {
  server = serve('workspace-secrets.create.validation-errors')
  open()
  await screen.findByText('db_password')
  click('Crear secreto')
  expect(screen.getByText('El nombre del secreto es obligatorio.')).toBeVisible()
  expect(screen.getByText('El valor del secreto es obligatorio.')).toBeVisible()
  expect(nameField()).toHaveAttribute('aria-invalid', 'true')
  expect(nameField().getAttribute('aria-describedby')).toContain(screen.getByText('El nombre del secreto es obligatorio.').id)
  expect(valueField().getAttribute('aria-describedby')).toContain(screen.getByText('Solo escritura: nunca se vuelve a mostrar tras guardarlo.').id)
  set(nameField(), 'Bad-Name')
  expect(screen.queryByText('El nombre del secreto es obligatorio.')).toBeNull()
  set(valueField(), 'x'.repeat(65536))
  click('Crear secreto')
  expect(screen.getByText('El nombre debe coincidir con ^[a-z][a-z0-9_-]{0,62}$ (minúsculas, empieza por letra).')).toBeVisible()
  expect(screen.getByText('El valor no puede superar 65535 caracteres.')).toBeVisible()
  set(nameField(), 'a'.repeat(64))
  click('Crear secreto')
  expect(screen.getByText(/El nombre debe coincidir/)).toBeVisible()
  expect(server.requests().filter(({ method }) => method === 'POST')).toEqual([])
  expect(screen.queryByText(/Variable de entorno:/)).not.toBeNull()
  set(nameField(), 'db_password')
  expect(screen.getAllByText('DB_PASSWORD', { selector: 'code' })).toHaveLength(2)
})

test('masks the value, never prefills it and offers no reveal toggle', async () => {
  server = serve('workspace-secrets.list.success')
  open()
  await screen.findByText('db_password')
  expect(valueField()).toHaveAttribute('type', 'password')
  expect(isBlank(valueField())).toBe(true)
  expect(screen.queryByRole('button', { name: /mostrar|ocultar|show|hide/i })).toBeNull()
  expect(descriptionField()).toHaveAttribute('placeholder', 'Nota no secreta para identificar el secreto')
  expect(screen.getByText('Crear secreto', { selector: 'h2' })).toBeVisible()
})

test('Nuevo secreto is the toolbar tab stop and focuses the name field', async () => {
  server = serve('workspace-secrets.list.success')
  open()
  await screen.findByText('db_password')
  const button = screen.getByRole('button', { name: 'Nuevo secreto' })
  expect(button.closest('[role="toolbar"]')).not.toBeNull()
  expect(button).toHaveAttribute('tabindex', '0')
  expect(screen.queryByRole('searchbox')).toBeNull()
  fireEvent.click(button)
  await waitFor(() => expect(nameField()).toHaveFocus())
})

test('paginates by cursor: the first request has none, Cargar más sends page[after], appends and focuses the first new row header', async () => {
  server = serve('workspace-secrets.list.paged')
  open()
  await screen.findByText('secret_25')
  expect(screen.getByText('25 secretos cargados Hay más secretos disponibles.')).toBeVisible()
  expect(listCalls()).toEqual([{ method: 'GET', path: secretsPath, body: undefined }])
  click('Cargar más secretos')
  await screen.findByText('secret_28')
  expect(listCalls().at(-1)).toEqual({ method: 'GET', path: cursorPath, body: undefined })
  expect(screen.queryByRole('button', { name: 'Cargar más secretos' })).toBeNull()
  expect(screen.getAllByRole('rowheader')).toHaveLength(28)
  await waitFor(() => expect(screen.getByRole('rowheader', { name: 'secret_26' })).toHaveFocus())
})

test('a next-page 500 keeps rows and the cursor and Reintentar re-sends the same page[after]', async () => {
  server = serve('workspace-secrets.list.page-2-500-then-network-then-success')
  open()
  await screen.findByText('secret_25')
  click('Cargar más secretos')
  expect(await screen.findByRole('heading', { name: 'No se pudo cargar la siguiente página de secretos' })).toBeVisible()
  expect(screen.getAllByRole('rowheader')).toHaveLength(25)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toHaveFocus())
  click('Reintentar')
  await waitFor(() => expect(screen.queryByText(typed.requestId)).toBeNull())
  await screen.findByRole('heading', { name: 'No se pudo cargar la siguiente página de secretos' })
  click('Reintentar')
  await screen.findByText('secret_28')
  expect(listCalls().slice(1).every(({ path }) => path === cursorPath)).toBe(true)
  expect(listCalls()).toHaveLength(4)
})

test.each([[403, 'No tienes acceso a los secretos de esta área de trabajo'], [404, 'Área de trabajo no disponible']])('a next-page %s renders the list state exactly as the first page and moves focus to its title', async (status, title) => {
  server = serve('workspace-secrets.list.paged')
  // The second page answers with the requested status instead of the manifest page.
  const original = server.mock.getMockImplementation()!
  server.mock.mockImplementation(async (input, init) => String(input) === cursorPath
    ? Response.json({ status, code: `HTTP_${status}`, message: 'synthetic-backend-reason', correlationId: typed.correlationId }, { status })
    : original(input, init))
  open()
  await screen.findByText('secret_25')
  click('Cargar más secretos')
  const heading = await screen.findByRole('heading', { name: title })
  expect(screen.queryByRole('table')).toBeNull()
  await waitFor(() => expect(heading).toHaveFocus())
})

test('a next page that settles after a first-page reload is discarded in both orders, and load-more is disabled during the refresh', async () => {
  for (const order of ['next-first', 'reload-first'] as const) {
    const gates = { next: gate(), reload: gate() }
    let reads = 0
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = init.method ?? 'GET', path = String(input)
      requests.push(`${method} ${path}`)
      if (method === 'GET' && path === secretsPath) {
        if (reads++ === 0) return Response.json({ items: [{ secretName: 'first_row', resolvedRefCount: 0 }], page: { size: 25, nextCursor: 'cursor-2' } })
        await gates.reload.promise
        return Response.json({ items: [{ secretName: 'created_row', resolvedRefCount: 0 }], page: { size: 25 } })
      }
      if (method === 'GET' && path === cursorPath) { await gates.next.promise; return Response.json({ items: [{ secretName: 'stale_row', resolvedRefCount: 0 }], page: { size: 25 } }) }
      if (method === 'POST' && path === secretsPath) return Response.json({ secretName: 'created_row' })
      throw new Error(`Unmatched request: ${method} ${path}`)
    }))
    const view = open()
    await screen.findByText('first_row')
    click('Cargar más secretos')
    await waitFor(() => expect(requests).toContain(`GET ${cursorPath}`))
    set(nameField(), 'created_row'); set(valueField(), canary)
    click('Crear secreto')
    await waitFor(() => expect(requests.filter((request) => request === `GET ${secretsPath}`)).toHaveLength(2))
    // While the post-write refresh runs, the quiet list stays and load-more cannot start another page.
    expect(screen.getByRole('button', { name: 'Cargar más secretos' })).toBeDisabled()
    if (order === 'next-first') { gates.next.release(); await settle(); gates.reload.release() } else { gates.reload.release(); await settle(); gates.next.release() }
    await screen.findByText('created_row')
    await settle()
    expect(screen.queryByText('stale_row')).toBeNull()
    expect(screen.queryByText('first_row')).toBeNull()
    expect(requests.filter((request) => request === `GET ${cursorPath}`)).toHaveLength(1)
    view.unmount()
  }
})

test('a failed post-write refresh shows no stale rows', async () => {
  server = serve('workspace-secrets.create.success')
  const original = server.mock.getMockImplementation()!
  let reads = 0
  server.mock.mockImplementation(async (input, init) => (String(input) === secretsPath && (init?.method ?? 'GET') === 'GET' && reads++ === 1)
    ? Response.json({ status: 500, code: 'HTTP_500', message: 'synthetic-backend-reason', requestId: typed.requestId }, { status: 500 })
    : original(input, init))
  open()
  await screen.findByText('db_password')
  set(nameField(), 'new_secret'); set(valueField(), canary)
  click('Crear secreto')
  expect(await screen.findByRole('heading', { name: 'No se pudieron cargar los secretos' })).toBeVisible()
  expect(screen.queryByText('db_password')).toBeNull()
})

test('no workspace sends no request and renders the legacy workspace-required state with the picker', async () => {
  workspaceContext('dev', { activeWorkspaceId: null, workspaces: [{ workspaceId: 'w2', tenantId: 't', displayName: 'Workspace Two' }] })
  server = serve('shell.no-active-workspace')
  const view = open()
  expect(await screen.findByRole('heading', { level: 1, name: 'Secretos del área de trabajo' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Selecciona un área de trabajo' })).toBeVisible()
  expect(screen.getByText('Elige un área de trabajo activa para gestionar sus secretos de función. Cada secreto pertenece a una única área de trabajo.')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Seleccionar área de trabajo' })).toBeVisible()
  expect(server.requests()).toEqual([])
  view.unmount()
})

test.each([['loading', 'Cargando áreas de trabajo'], ['error', 'No se pudieron cargar las áreas de trabajo']])('workspace %s state', async (state, title) => {
  workspaceContext('dev', { activeWorkspaceId: null, workspaces: [], loading: state === 'loading', error: state === 'error' ? { status: 500 } : null, reloadWorkspaces: vi.fn() })
  server = serve(state === 'loading' ? 'shell.workspace-loading' : 'shell.workspace-error')
  open()
  expect(await screen.findAllByText(title)).not.toHaveLength(0)
  expect(server.requests()).toEqual([])
  if (state === 'error') {
    click('Reintentar')
    // The workspace list is reloaded; the tenant list is not requested again.
    await waitFor(() => expect((currentContext() as { reloadWorkspaces: ReturnType<typeof vi.fn> }).reloadWorkspaces).toHaveBeenCalledTimes(1))
    expect((currentContext() as { reloadTenants: ReturnType<typeof vi.fn> }).reloadTenants).not.toHaveBeenCalled()
  }
})

test.each([[true, 'Crear área de trabajo'], [false, 'Esta organización todavía no tiene áreas de trabajo']])('with no workspaces the create link is shown only to roles that can create (%s) as a plain root-relative anchor', async (canCreate, text) => {
  workspaceContext('dev', { activeWorkspaceId: null, workspaces: [] })
  setRoles([canCreate ? 'superadmin' : 'tenant_viewer'])
  server = serve('shell.no-active-workspace')
  open()
  const node = await screen.findByText(new RegExp(text))
  if (canCreate) expect(node.closest('a')).toHaveAttribute('href', '/console/workspaces')
  expect(server.requests()).toEqual([])
})

test('renders the same states in English', async () => {
  await act(async () => { await i18n.changeLanguage('en') })
  server = serve('workspace-secrets.list.success')
  open()
  expect(await screen.findByRole('heading', { level: 1, name: 'Workspace secrets' })).toBeVisible()
  expect(screen.getByLabelText('Secret name')).toBeVisible()
  expect(screen.getByRole('button', { name: 'New secret' })).toBeVisible()
  expect(await screen.findByText('3 secrets')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Replace secret db_password' })).toBeVisible()
})

test('both catalogs carry the same keys and ICU plurals for the loaded counts', () => {
  const keys = (value: unknown, prefix = ''): string[] => typeof value === 'string' ? [prefix] : Object.entries(value as object).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
  expect(keys(es)).toEqual(keys(en))
  expect(es.paging.summary).toContain('plural')
  expect(en.paging.summary).toContain('plural')
})

test('every manifest fixture id is exercised by a unit, routing or parity test', () => {
  // Static check: each id must appear in at least one suite that drives it.
  const sources = ['tests/consoleWorkspaceSecrets.test.tsx', 'tests/consoleWorkspaceSecrets-actions.test.tsx', 'tests/consoleWorkspaceSecrets-routing.test.tsx', 'tests/parity/pages/console-workspace-secrets-page.spec.mjs']
    .map((file) => readFileSync(file, 'utf8')).join('\n').replace(/workspace-secrets\.list\.\$\{variant\}/g, ['401-refresh-ok', '401-after-refresh', '401-refresh-rejected'].map((variant) => `workspace-secrets.list.${variant}`).join(' '))
  expect(fixtureIds.filter((id) => !sources.includes(id))).toEqual([])
  expect(fixtureIds.length).toBeGreaterThan(30)
  expect([...usedFixtures].every((id) => fixtureIds.includes(id))).toBe(true)
})

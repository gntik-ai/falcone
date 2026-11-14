import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { account, keysPath, pg, query, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'
import { calls, choose, click, count, enterTarget, failing, open, setup, state, type } from './consolePostgresData-support'
let server: ReturnType<typeof setup>
afterEach(() => { server?.verify(); void changeLocale('es') })

// The #742 cases of the legacy ConsolePostgresDataPage test: the no-workspace guard offers an action.
test('[#742] offers a create-workspace link when the organization has no workspaces', () => {
  server = setup({}, { activeWorkspaceId: null, workspaces: [] }); open()
  expect(screen.getByText('Selecciona un área de trabajo para editar datos.')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Crear área de trabajo' })).toHaveAttribute('href', '/console/workspaces')
  expect(calls(server)).toEqual([]); expect(screen.queryByLabelText('Base de datos')).toBeNull()
})
test('[#742] denies the create link without the permission and explains who can create a workspace', () => {
  server = setup({}, { activeWorkspaceId: null, workspaces: [] }); state.allowed = false; open()
  expect(screen.queryByRole('link', { name: 'Crear área de trabajo' })).toBeNull(); expect(screen.getByText(/todavía no tiene áreas de trabajo/)).toBeVisible(); expect(calls(server)).toEqual([])
})
test('[#742] the picker activates the chosen workspace and sends no request', async () => {
  const selectWorkspace = vi.fn()
  server = setup({}, { activeWorkspaceId: null, workspaces: [{ workspaceId: 'wrk_1', displayName: 'Producción' }, { workspaceId: 'wrk_2', displayName: 'Staging' }], selectWorkspace }); open()
  await choose('Seleccionar área de trabajo', 'Staging'); expect(selectWorkspace).toHaveBeenCalledWith('wrk_2'); expect(calls(server)).toEqual([])
})
test('workspace loading renders its state and sends no request', () => {
  server = setup({}, { activeWorkspaceId: null, loading: true }); open()
  expect(screen.getByRole('heading', { name: 'Cargando áreas de trabajo' })).toBeVisible(); expect(calls(server)).toEqual([])
})
test.each([403, 500, undefined])('workspace error %s keeps Reintentar, which reloads the workspaces once', (status) => {
  const reloadWorkspaces = vi.fn()
  server = setup({}, { activeWorkspaceId: null, error: { status }, reloadWorkspaces }); open()
  click('Reintentar'); expect(reloadWorkspaces).toHaveBeenCalledTimes(1); expect(calls(server)).toEqual([])
})

test('legacy form-control-legibility case: database, schema and table are labelled inputs with the legacy ids and placeholders', () => {
  server = setup(); const { container } = open()
  for (const [id, label, placeholder] of [['pg-db', 'Base de datos', 'app_db'], ['pg-schema', 'Esquema', 'public'], ['pg-table', 'Tabla', 'accounts']]) {
    const input = container.querySelector(`#${id}`); expect(input).not.toBeNull(); expect(screen.getByLabelText(label)).toBe(input); expect(input).toHaveAttribute('placeholder', placeholder)
  }
  expect(screen.getByLabelText('Esquema')).toHaveValue('public')
})
test('renders the prompt and sends no rows or api-keys request until a database and a table are entered', async () => {
  server = setup(); open()
  expect(screen.getByText('Introduce una base de datos y una tabla para comenzar.')).toBeVisible()
  type('Base de datos', 'app_db'); type('Tabla', '   '); await new Promise((resolve) => setTimeout(resolve, 20))
  expect(screen.queryByTestId('pgdata-editor')).toBeNull(); expect(calls(server)).toEqual([])
})
test('a blank schema falls back to public and the target values are trimmed', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: pg['pg-rows-page1'] }); open()
  type('Esquema', '  '); type('Base de datos', ' app_db '); type('Tabla', ' accounts '); await screen.findByRole('table', { name: 'Filas de la tabla' })
  expect(calls(server).map(({ path }) => path).sort()).toEqual([keysPath(), rowsUrl()].sort())
  expect(screen.getByRole('heading', { name: 'public.accounts' })).toBeVisible()
})
test('shows the fixture columns and cells, the count in locale format and the key list with Revocar only on active keys', async () => {
  server = setup(); open(); await enterTarget()
  const table = screen.getByRole('table', { name: 'Filas de la tabla' })
  for (const column of ['id', 'email', 'plan']) expect(screen.getByRole('columnheader', { name: column })).toBeVisible()
  expect(table).toHaveTextContent('user1@example.test'); expect(screen.getByRole('heading', { name: 'Filas (60)' })).toBeVisible()
  const keys = await screen.findByRole('table', { name: 'Claves API del área de trabajo' })
  expect(keys).toHaveTextContent('fk_anon_ab12…'); expect(keys).toHaveTextContent('fk_svc_cd34…'); expect(keys).toHaveTextContent('Activa'); expect(keys).toHaveTextContent('Revocada')
  expect(screen.getAllByRole('button', { name: 'Revocar' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(25)
})
test('the count follows the locale number format', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: { ...pg['pg-rows-page1'], count: 1234 } }); await changeLocale('en'); open()
  type('Database', 'app_db'); type('Table', 'accounts'); expect(await screen.findByRole('heading', { name: 'Rows (1,234)' })).toBeVisible()
})

test('filters send column=op.value, split an in filter on commas and reset the cursor; a blank column is ignored', async () => {
  server = setup({ [`GET ${rowsUrl({ after: 'c1' })}`]: pg['pg-rows-page2'], [`GET ${rowsUrl({ filters: [['plan', 'eq.free']] })}`]: pg['pg-rows-empty'], [`GET ${rowsUrl({ filters: [['plan', 'eq.free'], ['id', 'in.(a,b)']] })}`]: pg['pg-rows-empty'], [`GET ${rowsUrl({ filters: [['id', 'in.(a,b)']] })}`]: pg['pg-rows-empty'] })
  open(); await enterTarget(); const before = calls(server).length
  click('Añadir filtro'); expect(calls(server)).toHaveLength(before)
  click('Siguiente'); await screen.findByText('user26@example.test')
  type('Columna', 'plan'); type('Valor', 'free'); click('Añadir filtro'); await screen.findByText('Todavía no hay filas.')
  expect(screen.getByText('plan eq free')).toBeVisible(); expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
  type('Columna', 'id'); await choose('Operador', 'in'); type('Valor (separado por comas)', ' a , b '); click('Añadir filtro')
  await waitFor(() => expect(count(server, rowsUrl({ filters: [['plan', 'eq.free'], ['id', 'in.(a,b)']] }))).toBe(1))
  expect(screen.getByText('id in a,b')).toBeVisible()
  fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0]); await waitFor(() => expect(count(server, rowsUrl({ filters: [['id', 'in.(a,b)']] }))).toBe(1))
})
test('the pager keeps a cursor stack: Siguiente sends page[after], Anterior returns to the first page', async () => {
  server = setup({ [`GET ${rowsUrl({ after: 'c1' })}`]: pg['pg-rows-page2'] }); open(); await enterTarget()
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
  click('Siguiente'); await screen.findByText('user26@example.test'); expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled()
  click('Anterior'); await screen.findByText('user1@example.test'); expect(count(server, rowsUrl())).toBe(2); expect(count(server, rowsUrl({ after: 'c1' }))).toBe(1)
})
test('every rows read caused by paging or filtering also re-reads the API keys, as legacy', async () => {
  server = setup({ [`GET ${rowsUrl({ after: 'c1' })}`]: pg['pg-rows-page2'], [`GET ${rowsUrl({ filters: [['plan', 'eq.free']] })}`]: pg['pg-rows-empty'] }); open(); await enterTarget()
  expect(count(server, keysPath())).toBe(1)
  click('Siguiente'); await screen.findByText('user26@example.test'); await waitFor(() => expect(count(server, keysPath())).toBe(2))
  click('Anterior'); await screen.findByText('user1@example.test'); await waitFor(() => expect(count(server, keysPath())).toBe(3))
  type('Columna', 'plan'); type('Valor', 'free'); click('Añadir filtro'); await screen.findByText('Todavía no hay filas.'); await waitFor(() => expect(count(server, keysPath())).toBe(4))
  expect(count(server, rowsUrl())).toBe(2); expect(count(server, rowsUrl({ after: 'c1' }))).toBe(1)
})
test('the page size select sends page[size] and starts again from the first page', async () => {
  server = setup({ [`GET ${rowsUrl({ size: 50 })}`]: pg['pg-rows-page1'] }); open(); await enterTarget(); await choose('Tamaño de página', '50')
  await waitFor(() => expect(count(server, rowsUrl({ size: 50 }))).toBe(1))
})
test('zero rows render the no-results state, keep the insert form and an empty key list renders its own state', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: pg['pg-rows-empty'], [`GET ${keysPath()}`]: pg['pg-api-keys-empty'] }); open(); type('Base de datos', 'app_db'); type('Tabla', 'accounts')
  expect(await screen.findByText('Todavía no hay filas.')).toBeVisible(); expect(await screen.findByText('Todavía no hay claves API.')).toBeVisible()
  expect(screen.getByLabelText('Fila nueva (JSON)')).toHaveValue('{}'); expect(screen.getByRole('button', { name: 'Emitir clave anónima' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Emitir clave de servicio' })).toBeEnabled()
})
test('rows 403 renders no-access without a request-access call, and the key panel stays', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: failing(403) }); open(); await enterTarget('accounts').catch(() => {}); type('Base de datos', 'app_db'); type('Tabla', 'accounts')
  expect(await screen.findByTestId('pgdata-rows')).toBeVisible(); await screen.findByText('Acceso denegado'); expect(screen.queryByRole('table', { name: 'Filas de la tabla' })).toBeNull()
  expect(await screen.findByRole('table', { name: 'Claves API del área de trabajo' })).toBeVisible(); expect(calls(server).every(({ method }) => method === 'GET')).toBe(true)
})
test('keys 403 renders no-access in the key panel and keeps the rows and both issue buttons', async () => {
  server = setup({ [`GET ${keysPath()}`]: failing(403) }); open(); await enterTarget(); await screen.findByTestId('pgdata-failure-keys')
  expect(screen.getByTestId('pgdata-failure-keys')).toHaveTextContent('Acceso denegado'); expect(screen.getByRole('table', { name: 'Filas de la tabla' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Emitir clave anónima' })).toBeEnabled()
})
test('rows 404 renders not-found; Volver clears the target, resets the schema, focuses Base de datos and sends no request', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: failing(404) }); open(); type('Esquema', 'public'); type('Base de datos', 'app_db'); type('Tabla', 'accounts')
  await screen.findByTestId('pgdata-not-found'); const before = calls(server).length
  click('Volver'); expect(screen.getByLabelText('Base de datos')).toHaveValue(''); expect(screen.getByLabelText('Tabla')).toHaveValue(''); expect(screen.getByLabelText('Esquema')).toHaveValue('public')
  expect(screen.getByText('Introduce una base de datos y una tabla para comenzar.')).toBeVisible(); await waitFor(() => expect(screen.getByLabelText('Base de datos')).toHaveFocus()); expect(calls(server)).toHaveLength(before)
})
test.each([500, 'network'] as const)('rows %s renders an error-panel; Reintentar repeats the identical request once and the rows are never shown as fresh', async (failure) => {
  server = setup({ [`GET ${rowsUrl({ size: 25 })}`]: failing(failure, pg['pg-rows-page1']) }); open(); type('Base de datos', 'app_db'); type('Tabla', 'accounts')
  const panel = await screen.findByTestId('pgdata-failure-rows'); expect(panel.textContent).not.toContain('raw-backend-message'); expect(screen.queryByRole('table', { name: 'Filas de la tabla' })).toBeNull()
  if (failure === 500) expect(panel).toHaveTextContent('pg-request')
  const before = count(server, rowsUrl()); fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
  await screen.findByRole('table', { name: 'Filas de la tabla' }); expect(count(server, rowsUrl())).toBe(before + 1)
})
test('keys 500 renders its own error-panel; Reintentar repeats GET api-keys once', async () => {
  server = setup({ [`GET ${keysPath()}`]: failing(500, pg['pg-api-keys']) }); open(); await enterTarget(); const panel = await screen.findByTestId('pgdata-failure-keys')
  const before = count(server, keysPath()); fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' })); await screen.findByRole('table', { name: 'Claves API del área de trabajo' }); expect(count(server, keysPath())).toBe(before + 1)
})
test('loading shows the table and key skeletons while both reads are pending', async () => {
  let release!: (response: Response) => void
  server = setup({ [`GET ${rowsUrl()}`]: () => new Promise<Response>((resolve) => { release = resolve }), [`GET ${keysPath()}`]: () => new Promise<Response>(() => {}) }); open(); type('Base de datos', 'app_db'); type('Tabla', 'accounts')
  expect(await screen.findByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'true'); expect(screen.getByTestId('pgdata-keys')).toHaveAttribute('aria-busy', 'true')
  release(Response.json(pg['pg-rows-page1'])); await screen.findByRole('table', { name: 'Filas de la tabla' }); expect(screen.getByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'false')
})
test('renders in English with the en catalog', async () => {
  server = setup(); await changeLocale('en'); open()
  expect(screen.getByRole('heading', { name: 'Data editor' })).toBeVisible(); expect(screen.getByText('Enter a database and a table to begin.')).toBeVisible()
  type('Database', 'app_db'); type('Table', 'accounts'); expect(await screen.findByRole('button', { name: 'Issue anon key' })).toBeVisible()
  expect(account(1).id).toBe('acc-1'); expect(query([['a', 'b']])).toBe('a=b')
})

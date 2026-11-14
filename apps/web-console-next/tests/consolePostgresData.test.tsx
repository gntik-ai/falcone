import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { baseRoutes, button, calls, click, enterTarget, failWith, loaded, ok, open, setup, settle, state, typeInto } from './consolePostgresData-support'
import { byKeyPath, fixtures, keysPath, rowsPath, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const writes = () => calls(server).filter((call) => call.method !== 'GET')
const count = (path: string) => calls(server).filter((call) => call.path === path).length
const notice = async (text: string) => { expect((await screen.findAllByText(text)).length).toBeGreaterThan(0) }
const loadedKeys = () => screen.findByText(/syn_anon_01/)
const choose = async (label: string, option: string) => { fireEvent.click(screen.getByRole('combobox', { name: label })); const item = await screen.findByRole('option', { name: option }); fireEvent.pointerDown(item); fireEvent.click(item) }
// Every request the page may send: rows, by-primary-key writes, api keys and the apikey preview. Nothing else.
const allowed = [/^GET \/v1\/postgres\/workspaces\/ws-1\/data\/[^/]+\/schemas\/[^/]+\/tables\/[^/]+\/rows\?/, /^POST \/v1\/postgres\/workspaces\/ws-1\/data\/[^/]+\/schemas\/[^/]+\/tables\/[^/]+\/rows$/, /^(PATCH|DELETE) \/v1\/postgres\/workspaces\/ws-1\/data\/[^/]+\/schemas\/[^/]+\/tables\/[^/]+\/rows\/by-primary-key\?id=/, /^(GET|POST) \/v1\/workspaces\/ws-1\/api-keys$/, /^DELETE \/v1\/workspaces\/ws-1\/api-keys\/[^/]+$/]

test('no rows or api-keys request until a database and a table are entered; schema falls back to public', async () => {
  server = setup(); open()
  expect(screen.getByText('Introduce una base de datos y una tabla para comenzar.')).toBeVisible(); expect(screen.getByLabelText('Esquema')).toHaveValue('public')
  typeInto('Base de datos', '  app_db  '); await settle(); expect(calls(server)).toEqual([])
  typeInto('Esquema', '   '); typeInto('Tabla', ' accounts '); await settle(); await loaded()
  expect(calls(server).map(({ method, path }) => `${method} ${path}`).sort()).toEqual([`GET ${keysPath}`, `GET ${rowsUrl()}`].sort())
  expect(screen.getByRole('heading', { name: 'public.accounts' })).toBeVisible()
})
test('renders fixture columns, the localized count and revoke only on active keys', async () => {
  server = setup(); open(); await enterTarget(); await loaded()
  const rows = screen.getByRole('table', { name: 'Filas de la tabla' })
  for (const column of ['id', 'email', 'plan']) expect(within(rows).getByRole('columnheader', { name: column })).toBeVisible()
  expect(within(rows).getByText('user3@example.test')).toBeVisible(); expect(screen.getByRole('heading', { name: 'Filas (60)' })).toBeVisible()
  const keys = screen.getByRole('table', { name: 'Claves API del área de trabajo' })
  expect(within(keys).getByText('syn_anon_01…')).toBeVisible(); expect(within(keys).getByText('syn_svc_01…')).toBeVisible(); expect(within(keys).getAllByRole('button', { name: /^Revocar/ })).toHaveLength(1)
  expect(within(keys).getByRole('button', { name: 'Revocar clave syn_anon_01' })).toBeVisible()
})
test('filters send column=op.value, split in lists, reset the cursor and reload keys with every rows reload', async () => {
  server = setup({ [`GET ${rowsUrl({ filters: [['id', 'in.(a,b)']] })}`]: fixtures['pg-rows-empty'], [`GET ${rowsUrl({ after: 'c1' })}`]: fixtures['pg-rows-page2'], [`GET ${rowsUrl({ after: 'c1', filters: [['id', 'in.(a,b)']] })}`]: fixtures['pg-rows-empty'] })
  open(); await enterTarget(); await loaded(); fireEvent.click(button('Añadir filtro')); await settle(); expect(count(rowsUrl())).toBe(1)
  click('Siguiente'); await screen.findByText('acc_26'); expect(button('Anterior')).toBeEnabled()
  typeInto('Columna', ' id '); await choose('Operador', 'in'); expect(screen.getByText('Valor (separado por comas)')).toBeVisible(); typeInto(/^Valor/, 'a, b'); click('Añadir filtro')
  expect(await screen.findByText('Todavía no hay filas.')).toBeVisible()
  const filtered = rowsUrl({ filters: [['id', 'in.(a,b)']] })
  expect(count(filtered)).toBe(1); expect(calls(server).some((call) => call.path.includes('page%5Bafter%5D=c1') && call.path.includes('id='))).toBe(false)
  expect(button('Anterior')).toBeDisabled(); expect(screen.getByText('id in a,b')).toBeVisible()
  expect(count(keysPath)).toBe(3); expect(screen.getByLabelText('Columna')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: /^Quitar filtro/ })); await screen.findByText('acc_01'); expect(count(keysPath)).toBe(4); expect(screen.queryByText('id in a,b')).toBeNull()
})
test('the pager sends page[size] and page[after], previous restores the first page and size changes reset the cursor', async () => {
  server = setup({ [`GET ${rowsUrl({ after: 'c1' })}`]: fixtures['pg-rows-page2'], [`GET ${rowsUrl({ size: 50 })}`]: fixtures['pg-rows-page1'] })
  open(); await enterTarget(); await loaded(); expect(button('Anterior')).toBeDisabled()
  click('Siguiente'); await screen.findByText('acc_26'); expect(button('Siguiente')).toBeDisabled(); expect(button('Anterior')).toBeEnabled()
  click('Anterior'); await screen.findByText('acc_01'); expect(count(rowsUrl())).toBe(2)
  click('Siguiente'); await screen.findByText('acc_26'); await choose('Tamaño de página', '50'); await screen.findByText('acc_01'); expect(button('Anterior')).toBeDisabled(); expect(count(rowsUrl({ size: 50 }))).toBe(1)
})
test('returning to a previously visited table starts at its first page with an empty cursor stack', async () => {
  const other = rowsUrl({ base: rowsPath.replace('/accounts/', '/orders/') })
  server = setup({ [`GET ${rowsUrl({ after: 'c1' })}`]: fixtures['pg-rows-page2'], [`GET ${other}`]: fixtures['pg-rows-empty'] })
  open(); await enterTarget(); await loaded(); click('Siguiente'); await screen.findByText('acc_26')
  typeInto('Tabla', 'orders'); await screen.findByText('Todavía no hay filas.'); expect(button('Anterior')).toBeDisabled()
  typeInto('Tabla', 'accounts'); await screen.findByText('acc_01'); expect(button('Anterior')).toBeDisabled()
  expect(calls(server).filter((call) => call.path.includes('/orders/')).every((call) => !call.path.includes('page%5Bafter%5D'))).toBe(true)
  expect(calls(server).filter((call) => call.path.includes('/accounts/rows?') && call.path.includes('page%5Bafter%5D'))).toHaveLength(1)
})
test('insert validates the JSON object, posts {values}, resets the form and reloads the current page', async () => {
  let inserted = false
  server = setup({ [`POST ${rowsPath}`]: () => { inserted = true; return Response.json(fixtures['pg-row-insert-ok']) }, [`GET ${rowsUrl()}`]: () => Response.json(inserted ? fixtures['pg-rows-after-insert'] : fixtures['pg-rows-page1']) })
  open(); await enterTarget(); await loaded()
  const field = screen.getByLabelText('Fila nueva (JSON)'); expect(field).toHaveValue('{}')
  fireEvent.change(field, { target: { value: '{nope' } }); click('Insertar'); expect(await screen.findByText('Fila nueva: JSON no válido')).toBeVisible()
  fireEvent.change(field, { target: { value: '[1]' } }); click('Insertar'); expect(await screen.findByText('Fila nueva: Se esperaba un objeto JSON')).toBeVisible(); expect(writes()).toEqual([])
  fireEvent.change(field, { target: { value: '{"email":"new@example.test"}' } }); click('Insertar')
  expect(await screen.findByText('new@example.test')).toBeVisible()
  expect(writes()).toEqual([expect.objectContaining({ method: 'POST', path: rowsPath, body: { values: { email: 'new@example.test' } } })])
  expect(field).toHaveValue('{}'); expect(screen.getByRole('heading', { name: 'Filas (61)' })).toBeVisible(); await notice('Fila insertada')
  expect(screen.queryByText(/Fila nueva:/)).toBeNull()
})
test('Guardar sends PATCH by primary key without id, closes the drawer, reloads and keeps focus on a stable control', async () => {
  let patched = false
  server = setup({ [`PATCH ${byKeyPath}?id=acc_01`]: () => { patched = true; return Response.json(fixtures['pg-row-patch-ok']) }, [`GET ${rowsUrl()}`]: () => Response.json(patched ? fixtures['pg-rows-after-patch'] : fixtures['pg-rows-page1']) })
  open(); await enterTarget(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Editar fila acc_01' }))
  const drawer = await screen.findByRole('dialog'); expect(within(drawer).getByRole('heading', { name: 'Editar fila acc_01' })).toBeVisible()
  const area = within(drawer).getByLabelText('Fila (JSON)') as HTMLTextAreaElement; expect(JSON.parse(area.value)).toMatchObject({ id: 'acc_01', plan: 'basic' })
  fireEvent.change(area, { target: { value: '{nope' } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' })); expect(await within(drawer).findByText('Fila editada: JSON no válido')).toBeVisible(); expect(writes()).toEqual([])
  fireEvent.change(area, { target: { value: JSON.stringify({ id: 'acc_01', plan: 'enterprise' }) } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' }))
  expect(await screen.findByText('enterprise')).toBeVisible(); await waitFor(() => expect(screen.queryByTestId('pgdata-drawer')).toBeNull())
  expect(writes()).toEqual([expect.objectContaining({ method: 'PATCH', path: `${byKeyPath}?id=acc_01`, body: { changes: { plan: 'enterprise' } } })])
  await notice('Fila actualizada')
  await waitFor(() => expect(document.activeElement).not.toBe(document.body)); expect(screen.getByRole('button', { name: 'Editar fila acc_01' })).toHaveFocus()
})
test('Eliminar needs the typed row id, Cancelar sends nothing and a confirmed delete sends one DELETE then reloads', async () => {
  let deleted = false
  server = setup({ [`DELETE ${byKeyPath}?id=acc_01`]: () => { deleted = true; return Response.json(fixtures['pg-row-delete-ok']) }, [`GET ${rowsUrl()}`]: () => Response.json(deleted ? fixtures['pg-rows-after-delete'] : fixtures['pg-rows-page1']) })
  open(); await enterTarget(); await loaded()
  const trigger = screen.getByRole('button', { name: 'Eliminar fila acc_01' }); fireEvent.click(trigger)
  let dialog = await screen.findByRole('alertdialog'); const confirm = within(dialog).getByRole('button', { name: 'Eliminar fila' })
  expect(confirm).toBeDisabled(); fireEvent.change(within(dialog).getByLabelText('Escribe acc_01 para confirmar'), { target: { value: 'acc_0' } }); expect(confirm).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([]); await waitFor(() => expect(trigger).toHaveFocus())
  fireEvent.click(trigger); dialog = await screen.findByRole('alertdialog'); fireEvent.keyDown(dialog, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([])
  fireEvent.click(trigger); dialog = await screen.findByRole('alertdialog'); fireEvent.change(within(dialog).getByLabelText('Escribe acc_01 para confirmar'), { target: { value: 'acc_01' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar fila' }))
  await waitFor(() => expect(screen.queryByText('acc_01')).toBeNull()); expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', path: `${byKeyPath}?id=acc_01` })])
  expect(screen.getByRole('heading', { name: 'Filas (59)' })).toBeVisible(); await notice('Fila eliminada'); await waitFor(() => expect(document.activeElement).not.toBe(document.body))
})
test('rows without a primary key id cannot be edited or deleted and send no request', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: { items: [{ email: 'anon@example.test' }], page: {}, count: 1 } }); open(); await enterTarget(); await screen.findByText('anon@example.test')
  fireEvent.click(screen.getByRole('button', { name: /^Editar fila/ })); expect(await screen.findByText('La fila no tiene clave primaria "id" para editarla')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /^Eliminar fila/ })); expect(await screen.findByText('La fila no tiene clave primaria "id" para eliminarla')).toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(writes()).toEqual([])
})
test('mutation failures show the server message in an inline callout and keep the form', async () => {
  server = setup({ [`POST ${rowsPath}`]: failWith(500, { message: 'duplicate key value' }) }); open(); await enterTarget(); await loaded()
  fireEvent.change(screen.getByLabelText('Fila nueva (JSON)'), { target: { value: '{"id":"acc_01"}' } }); click('Insertar')
  const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('duplicate key value'); expect(screen.getByLabelText('Fila nueva (JSON)')).toHaveValue('{"id":"acc_01"}'); expect(button('Insertar')).toBeEnabled()
})
test('empty rows keep the insert form; an empty key list explains itself while rows and issue buttons stay usable', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: fixtures['pg-rows-empty'], [`GET ${keysPath}`]: fixtures['pg-api-keys-empty'] }); open(); await enterTarget()
  expect(await screen.findByText('Todavía no hay filas.')).toBeVisible(); expect(await screen.findByText('Todavía no hay claves API.')).toBeVisible()
  expect(screen.getByLabelText('Fila nueva (JSON)')).toBeVisible(); expect(button('Emitir clave anónima')).toBeEnabled(); expect(button('Emitir clave de servicio')).toBeEnabled()
})
test('rows 403 shows no-access in place of the table and sends no request-access call', async () => {
  server = setup({ [`GET ${rowsUrl()}`]: failWith(403) }); open(); await enterTarget(); const panel = await screen.findByTestId('pgdata-failure-rows'); expect(within(panel).getByText('No tienes acceso')).toBeVisible(); expect(within(panel).queryByRole('button', { name: 'Reintentar' })).toBeNull()
  await loadedKeys(); expect(writes()).toEqual([])
})
test('keys 403 renders its own no-access state', async () => {
  server = setup({ [`GET ${keysPath}`]: failWith(403) }); open(); await enterTarget(); await screen.findByText('acc_01')
  const panel = await screen.findByTestId('pgdata-failure-keys'); expect(within(panel).getByText('No tienes acceso')).toBeVisible(); expect(within(panel).queryByRole('button', { name: 'Reintentar' })).toBeNull(); expect(screen.getByText('acc_01')).toBeVisible(); expect(writes()).toEqual([])
})
test('rows 404 shows not-found with Volver, which clears the target, shows the prompt, focuses Base de datos and sends nothing', async () => {
  server = setup({ [`GET ${rowsUrl({ base: rowsPath.replace('/app_db/schemas/public/tables/accounts', '/missing_db/schemas/private/tables/accounts') })}`]: failWith(404) })
  open(); await enterTarget('missing_db', 'accounts', 'private')
  const panel = await screen.findByTestId('pgdata-failure-rows'); expect(within(panel).getByText('No se encontró la tabla')).toBeVisible()
  const before = calls(server).length; fireEvent.click(within(panel).getByRole('button', { name: 'Volver' }))
  expect(await screen.findByText('Introduce una base de datos y una tabla para comenzar.')).toBeVisible()
  expect(screen.getByLabelText('Base de datos')).toHaveValue(''); expect(screen.getByLabelText('Tabla')).toHaveValue(''); expect(screen.getByLabelText('Esquema')).toHaveValue('public'); expect(screen.getByLabelText('Base de datos')).toHaveFocus()
  expect(calls(server)).toHaveLength(before)
})
test('500 shows request id and Reintentar repeats the identical request once; keys have their own retry', async () => {
  let rowsAttempts = 0, keysAttempts = 0
  server = setup({ [`GET ${rowsUrl({ size: 25 })}`]: () => ++rowsAttempts === 1 ? failWith(500)() : Response.json(fixtures['pg-rows-page1']), [`GET ${keysPath}`]: () => ++keysAttempts === 1 ? failWith(500)() : Response.json(fixtures['pg-api-keys']) })
  open(); await enterTarget()
  const rows = await screen.findByTestId('pgdata-failure-rows'); expect(rows).toHaveTextContent('pg-request'); expect(rows).toHaveTextContent('500')
  const before = calls(server).length; fireEvent.click(within(rows).getByRole('button', { name: 'Reintentar' })); await screen.findByText('acc_01')
  expect(calls(server).slice(before).map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${rowsUrl()}`])
  const keys = await screen.findByTestId('pgdata-failure-keys'); fireEvent.click(within(keys).getByRole('button', { name: 'Reintentar' })); await screen.findByText(/syn_anon_01/); expect(keysAttempts).toBe(2); expect(rowsAttempts).toBe(2)
})
test('a network failure clears the previous rows instead of showing them as fresh', async () => {
  let fail = false
  server = setup({ [`GET ${rowsUrl()}`]: () => fail ? Promise.reject(new TypeError('Failed to fetch')) : Response.json(fixtures['pg-rows-page1']), [`GET ${rowsUrl({ after: 'c1' })}`]: () => Promise.reject(new TypeError('Failed to fetch')) })
  open(); await enterTarget(); await loaded(); click('Siguiente')
  const panel = await screen.findByTestId('pgdata-failure-rows'); expect(panel).toHaveTextContent('No se pudo conectar con el servidor'); expect(screen.queryByText('acc_01')).toBeNull(); expect(screen.queryByRole('table', { name: 'Filas de la tabla' })).toBeNull()
  fail = true
})
test('rows loading shows a skeleton while the request is pending and announces once', async () => {
  let release!: (response: Response) => void
  server = setup({ [`GET ${rowsUrl()}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await enterTarget()
  expect(screen.getByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'true'); expect(screen.queryByRole('table', { name: 'Filas de la tabla' })).toBeNull()
  await act(async () => release(Response.json(fixtures['pg-rows-page1']))); await screen.findByText('acc_01'); expect(screen.getByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'false')
})
test('a late response for a previous target never replaces the current rows', async () => {
  let release!: (response: Response) => void
  const orders = rowsUrl({ base: rowsPath.replace('/accounts/', '/orders/') })
  server = setup({ [`GET ${orders}`]: () => Response.json({ items: [{ id: 'ord_1' }], page: {}, count: 1 }), [`GET ${rowsUrl()}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  open(); await enterTarget(); await waitFor(() => expect(release).toBeTypeOf('function')); typeInto('Tabla', 'orders'); await screen.findByText('ord_1')
  await act(async () => release(Response.json(fixtures['pg-rows-page1']))); expect(screen.queryByText('acc_01')).toBeNull(); expect(screen.getByText('ord_1')).toBeVisible()
})
test('a whole journey only sends allowed requests', async () => {
  server = setup({ [`POST ${rowsPath}`]: ok(fixtures['pg-row-insert-ok']), [`DELETE ${keysPath}/key-anon-1`]: ok(fixtures['pg-api-key-revoke-ok']) }); open(); await enterTarget(); await loaded()
  click('Insertar'); await settle(); await notice('Fila insertada');   expect(calls(server).every(({ method, path }) => allowed.some((pattern) => pattern.test(`${method} ${path}`)))).toBe(true)
  void state
})

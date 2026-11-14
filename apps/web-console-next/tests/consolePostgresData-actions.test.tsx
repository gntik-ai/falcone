import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { byKeyPath, keysAfterIssue, keysPath, pg, previewUrl, rowsPath, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'
import { calls, click, count, enterTarget, open, setup, type, writes } from './consolePostgresData-support'
let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const deferred = () => { let release!: (response: Response) => void; const promise = new Promise<Response>((resolve) => { release = resolve }); return { promise, release } }
const json = (value: unknown, status = 200) => Response.json(value, { status })
const dialog = (name: string | RegExp) => screen.getByRole('dialog', { name })
const alertDialog = () => screen.getByRole('alertdialog')

test('Insertar with invalid JSON or a non-object shows the parse error and sends no request', async () => {
  server = setup(); open(); await enterTarget(); const before = calls(server).length
  fireEvent.change(screen.getByLabelText('Fila nueva (JSON)'), { target: { value: '{oops' } }); click('Insertar')
  expect(await screen.findByText('Fila nueva: JSON no válido')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Fila nueva (JSON)'), { target: { value: '[1]' } }); click('Insertar')
  expect(await screen.findByText('Fila nueva: Se esperaba un objeto JSON')).toBeVisible(); expect(calls(server)).toHaveLength(before)
})
test('Insertar sends POST rows {values}, resets the form to {}, reloads the rows and announces Fila insertada', async () => {
  let reads = 0
  server = setup({ [`GET ${rowsUrl()}`]: () => json(++reads === 1 ? pg['pg-rows-page1'] : pg['pg-rows-after-insert']), [`POST ${rowsPath()}`]: pg['pg-row-insert-ok'] }); open(); await enterTarget()
  fireEvent.change(screen.getByLabelText('Fila nueva (JSON)'), { target: { value: '{"email":"new@example.test","plan":"free"}' } }); click('Insertar')
  expect((await screen.findAllByText('Fila insertada')).length).toBeGreaterThan(0); await screen.findByText('new@example.test')
  expect(writes(server)).toEqual([expect.objectContaining({ method: 'POST', path: rowsPath(), body: { values: { email: 'new@example.test', plan: 'free' } } })])
  expect(screen.getByLabelText('Fila nueva (JSON)')).toHaveValue('{}'); expect(screen.getByRole('heading', { name: 'Filas (61)' })).toBeVisible(); expect(count(server, rowsUrl())).toBe(2)
})
test('an insert error shows the server message in an inline callout', async () => {
  server = setup({ [`POST ${rowsPath()}`]: () => json({ message: 'insert exploded', code: 'X' }, 500) }); open(); await enterTarget(); click('Insertar')
  expect(await within(await screen.findByTestId('pgdata-error')).findByText('insert exploded')).toBeVisible(); expect(screen.getByRole('button', { name: 'Insertar' })).toBeEnabled()
})

test('Editar opens the drawer; Guardar sends PATCH by-primary-key?id= {changes} without id, closes the drawer and reloads', async () => {
  let reads = 0
  server = setup({ [`GET ${rowsUrl()}`]: () => json(++reads === 1 ? pg['pg-rows-page1'] : pg['pg-rows-after-patch']), [`PATCH ${byKeyPath()}?id=acc-1`]: pg['pg-row-patch-ok'] }); open(); await enterTarget()
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
  const drawer = await screen.findByRole('dialog', { name: 'Editar fila acc-1' }); const field = within(drawer).getByLabelText('Fila (JSON)')
  expect(JSON.parse((field as HTMLTextAreaElement).value)).toEqual({ id: 'acc-1', email: 'user1@example.test', plan: 'free' })
  fireEvent.change(field, { target: { value: '{"id":"acc-1","email":"edited@example.test"}' } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' }))
  await screen.findByText('edited@example.test'); await waitFor(() => expect(screen.queryByRole('dialog', { name: /Editar fila/ })).toBeNull())
  // Focus survives the reload: it lands on the re-rendered Editar control of the saved row, not on the body.
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Editar' })[0]).toHaveFocus())
  expect(writes(server)).toEqual([expect.objectContaining({ method: 'PATCH', path: `${byKeyPath()}?id=acc-1`, body: { changes: { email: 'edited@example.test' } } })])
  expect((await screen.findAllByText('Fila actualizada')).length).toBeGreaterThan(0)
})
test('the edit drawer validates JSON and an idle Cancelar closes it with no request', async () => {
  server = setup(); open(); await enterTarget(); fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]); const drawer = await screen.findByRole('dialog', { name: 'Editar fila acc-1' })
  fireEvent.change(within(drawer).getByLabelText('Fila (JSON)'), { target: { value: 'nope' } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' }))
  expect(await within(drawer).findByText('Fila editada: JSON no válido')).toBeVisible(); expect(writes(server)).toEqual([])
  fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(writes(server)).toEqual([])
})
test('idle Escape closes the edit drawer', async () => {
  server = setup(); open(); await enterTarget(); fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]); const drawer = await screen.findByRole('dialog', { name: 'Editar fila acc-1' })
  fireEvent.keyDown(drawer, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(writes(server)).toEqual([])
})
test.each([['Editar', 'editarla'], ['Eliminar', 'eliminarla']])('%s on a row without an id shows the missing-key error and sends no request', async (action, verb) => {
  server = setup({ [`GET ${rowsUrl()}`]: { items: [{ email: 'noid@example.test' }], page: {}, count: 1 } }); open(); await enterTarget(); fireEvent.click(screen.getAllByRole('button', { name: action })[0])
  expect(await screen.findByText(`La fila no tiene clave primaria "id" para ${verb}`)).toBeVisible(); expect(writes(server)).toEqual([]); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Eliminar opens confirm-destructive: the confirm stays disabled until the row id is typed, Cancelar sends nothing', async () => {
  server = setup(); open(); await enterTarget(); fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])
  const confirm = await screen.findByRole('alertdialog'); const input = within(confirm).getByLabelText('Escribe acc-1 para confirmar'); const submit = within(confirm).getByRole('button', { name: 'Eliminar fila' })
  expect(submit).toBeDisabled(); fireEvent.change(input, { target: { value: 'acc-' } }); expect(submit).toBeDisabled()
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes(server)).toEqual([])
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Eliminar' })[0]).toHaveFocus())
})
test('Escape closes the delete confirmation with no request', async () => {
  server = setup(); open(); await enterTarget(); fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]); const confirm = await screen.findByRole('alertdialog')
  fireEvent.keyDown(confirm, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes(server)).toEqual([])
})
test('a confirmed Eliminar sends one DELETE by-primary-key?id=, reloads the rows and announces Fila eliminada', async () => {
  let reads = 0
  server = setup({ [`GET ${rowsUrl()}`]: () => json(++reads === 1 ? pg['pg-rows-page1'] : pg['pg-rows-after-delete']), [`DELETE ${byKeyPath()}?id=acc-1`]: pg['pg-row-delete-ok'] }); open(); await enterTarget()
  fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]); const confirm = await screen.findByRole('alertdialog')
  fireEvent.change(within(confirm).getByLabelText('Escribe acc-1 para confirmar'), { target: { value: 'acc-1' } }); fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar fila' }))
  await waitFor(() => expect(screen.queryByText('user1@example.test')).toBeNull()); expect(screen.getByRole('heading', { name: 'Filas (59)' })).toBeVisible()
  expect(writes(server)).toEqual([expect.objectContaining({ method: 'DELETE', path: `${byKeyPath()}?id=acc-1`, body: undefined })]); expect((await screen.findAllByText('Fila eliminada')).length).toBeGreaterThan(0)
})

test('while an insert is pending Insertar, the row actions, Anterior and Siguiente are disabled; filters and issue buttons stay enabled; completion re-enables', async () => {
  const slow = deferred()
  server = setup({ [`POST ${rowsPath()}`]: () => slow.promise }); open(); await enterTarget(); click('Insertar')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Insertar' })).toBeDisabled())
  for (const name of ['Editar', 'Eliminar']) for (const button of screen.getAllByRole('button', { name })) expect(button).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
  for (const name of ['Añadir filtro', 'Emitir clave anónima', 'Emitir clave de servicio']) expect(screen.getByRole('button', { name })).toBeEnabled()
  expect(screen.getByRole('combobox', { name: 'Tamaño de página' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Revocar' })).toBeEnabled()
  const before = calls(server).length; click('Insertar'); expect(calls(server)).toHaveLength(before)
  slow.release(json(pg['pg-row-insert-ok'])); await waitFor(() => expect(screen.getByRole('button', { name: 'Insertar' })).toBeEnabled()); expect(screen.getAllByRole('button', { name: 'Editar' })[0]).toBeEnabled()
})
test('a pending mutation keeps the controls disabled when the database, schema or table changes, and the editor does not remount', async () => {
  const slow = deferred()
  server = setup({ [`POST ${rowsPath()}`]: () => slow.promise, [`GET ${rowsUrl({ table: 'orders' })}`]: pg['pg-rows-page1'] }); open(); await enterTarget()
  const editor = screen.getByTestId('pgdata-editor'); click('Insertar'); await waitFor(() => expect(screen.getByRole('button', { name: 'Insertar' })).toBeDisabled())
  type('Tabla', 'orders'); await waitFor(() => expect(count(server, rowsUrl({ table: 'orders' }))).toBe(1))
  expect(screen.getByTestId('pgdata-editor')).toBe(editor); expect(screen.getByRole('button', { name: 'Insertar' })).toBeDisabled()
  for (const button of await screen.findAllByRole('button', { name: 'Editar' })) expect(button).toBeDisabled()
  for (const button of screen.getAllByRole('button', { name: 'Eliminar' })) expect(button).toBeDisabled()
  const accounts = count(server, rowsUrl()); slow.release(json(pg['pg-row-insert-ok']))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Insertar' })).toBeEnabled()); expect(count(server, rowsUrl())).toBe(accounts)
})
test('the pending guard also survives the editor unmounting and remounting', async () => {
  const slow = deferred()
  server = setup({ [`POST ${rowsPath()}`]: () => slow.promise }); open(); await enterTarget(); click('Insertar'); await waitFor(() => expect(screen.getByRole('button', { name: 'Insertar' })).toBeDisabled())
  type('Tabla', ''); expect(screen.queryByTestId('pgdata-editor')).toBeNull(); type('Tabla', 'accounts'); await screen.findByRole('table', { name: 'Filas de la tabla' })
  expect(screen.getByRole('button', { name: 'Insertar' })).toBeDisabled(); slow.release(json(pg['pg-row-insert-ok'])); await waitFor(() => expect(screen.getByRole('button', { name: 'Insertar' })).toBeEnabled())
})
test('while a save is pending the drawer refuses Cancelar, Escape and Guardar clicks, and closes when it settles', async () => {
  const slow = deferred()
  server = setup({ [`PATCH ${byKeyPath()}?id=acc-1`]: () => slow.promise }); open(); await enterTarget(); fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
  const drawer = await screen.findByRole('dialog', { name: 'Editar fila acc-1' }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Guardar' })).toBeDisabled()); expect(within(drawer).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  const before = calls(server).length; fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' })); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' })); fireEvent.keyDown(drawer, { key: 'Escape' })
  expect(screen.getByRole('dialog', { name: 'Editar fila acc-1' })).toBeVisible(); expect(calls(server)).toHaveLength(before)
  // The kit hides the background while the modal drawer is open, so query it explicitly.
  expect(screen.getByRole('button', { name: 'Insertar', hidden: true })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Siguiente', hidden: true })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Anterior', hidden: true })).toBeDisabled()
  slow.release(json(pg['pg-row-patch-ok'])); await waitFor(() => expect(screen.queryByRole('dialog', { name: /Editar fila/ })).toBeNull())
})

test('an issued anon key is revealed once, masked; Copiar copies exactly it; the dialog drops it when closed and it never reaches storage', async () => {
  const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  let reads = 0
  server = setup({ [`POST ${keysPath()}`]: pg['pg-api-key-issue-anon'], [`GET ${keysPath()}`]: () => json(++reads === 1 ? pg['pg-api-keys'] : keysAfterIssue) }); open(); await enterTarget()
  click('Emitir clave anónima'); const reveal = await screen.findByRole('dialog', { name: 'Clave anónima emitida' })
  expect(writes(server)).toEqual([expect.objectContaining({ method: 'POST', path: keysPath(), body: { keyType: 'anon' } })])
  const field = within(reveal).getByLabelText('Clave API emitida') as HTMLInputElement; expect(field.value).not.toContain('synthetic-anon-key'); expect(field).toHaveAttribute('data-masked'); fireEvent.click(within(reveal).getByRole('button', { name: 'Mostrar clave' })); expect(field.value).toBe('synthetic-anon-key')
  expect(within(reveal).getByText('Copia esta clave ahora; no volverá a mostrarse:')).toBeVisible(); expect(within(reveal).getByTestId('pgdata-snippets')).toHaveTextContent('apikey: synthetic-anon-key')
  fireEvent.click(within(reveal).getByRole('button', { name: 'Copiar clave' })); await waitFor(() => expect(writeText).toHaveBeenCalledWith('synthetic-anon-key')); await within(reveal).findByRole('button', { name: 'Copiada' })
  for (const store of [localStorage, sessionStorage]) expect(JSON.stringify({ ...store })).not.toContain('synthetic-anon-key')
  expect(document.querySelector('[role="region"]')?.textContent ?? '').not.toContain('synthetic-anon-key')
  fireEvent.click(within(reveal).getByRole('button', { name: 'Cerrar' })); await waitFor(() => expect(screen.queryByRole('dialog', { name: /Clave anónima/ })).toBeNull()); expect(document.body.textContent).not.toContain('synthetic-anon-key')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Emitir clave anónima' })).toHaveFocus()); expect(await screen.findAllByRole('button', { name: 'Revocar' })).toHaveLength(2)
})
test('a service key is issued with keyType service, and a failed issue reports the server message', async () => {
  server = setup({ [`POST ${keysPath()}`]: pg['pg-api-key-issue-service'] }); open(); await enterTarget(); click('Emitir clave de servicio')
  await screen.findByRole('dialog', { name: 'Clave de servicio emitida' }); expect(writes(server)[0].body).toEqual({ keyType: 'service' })
})
test('a failed issue shows the server message and no reveal', async () => {
  server = setup({ [`POST ${keysPath()}`]: () => json({ message: 'issue denied' }, 500) }); open(); await enterTarget(); click('Emitir clave anónima')
  expect(await within(await screen.findByTestId('pgdata-error')).findByText('issue denied')).toBeVisible(); expect(screen.queryByRole('dialog')).toBeNull()
})
test('the preview sends only the apikey header with page[size]=10, shows its own table, and a second click while it runs sends nothing', async () => {
  const slow = deferred()
  server = setup({ [`POST ${keysPath()}`]: pg['pg-api-key-issue-anon'], [`GET ${previewUrl()}`]: () => slow.promise, [`GET ${keysPath()}`]: pg['pg-api-keys'] }); open(); await enterTarget()
  click('Emitir clave anónima'); const reveal = await screen.findByRole('dialog', { name: 'Clave anónima emitida' })
  fireEvent.click(within(reveal).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' })); // A running kit button is aria-disabled and stays focusable.
  await waitFor(() => expect(within(reveal).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' })).toHaveAttribute('aria-disabled', 'true'))
  fireEvent.click(within(reveal).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' })); expect(count(server, previewUrl())).toBe(1)
  slow.release(json(pg['pg-rows-preview-apikey'])); expect(await within(reveal).findByText('Preview row two')).toBeVisible(); expect(within(reveal).getByText('Vista previa con esta clave: 2 fila(s).')).toBeVisible()
  const preview = calls(server).find(({ path }) => path === previewUrl())!
  expect(preview.method).toBe('GET'); expect(preview.headers.get('apikey')).toBe('synthetic-anon-key'); expect(preview.headers.has('Authorization')).toBe(false)
  for (const name of ['Accept', 'Content-Type', 'X-API-Version', 'X-Correlation-Id']) expect(preview.headers.get(name)).toBeTruthy()
  expect(within(screen.getByTestId('pgdata-rows')).queryByText('Preview row one')).toBeNull()
})
test('a failed preview shows an inline callout with the server message', async () => {
  server = setup({ [`POST ${keysPath()}`]: pg['pg-api-key-issue-anon'], [`GET ${previewUrl()}`]: () => json({ message: 'key rejected' }, 401) }); open(); await enterTarget(); click('Emitir clave anónima')
  const reveal = await screen.findByRole('dialog', { name: 'Clave anónima emitida' }); fireEvent.click(within(reveal).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' }))
  expect(await within(reveal).findByText('key rejected')).toBeVisible(); expect(calls(server).filter(({ path }) => path.includes('/auth/')).length).toBe(0)
})

test('Revocar opens confirm-destructive, Cancelar sends nothing, and a confirmed revoke sends DELETE then reloads the key list', async () => {
  let reads = 0
  server = setup({ [`GET ${keysPath()}`]: () => json(++reads === 1 ? pg['pg-api-keys'] : pg['pg-api-keys-after-revoke']), [`DELETE ${keysPath()}/key-1`]: pg['pg-api-key-revoke-ok'] }); open(); await enterTarget()
  fireEvent.click(await screen.findByRole('button', { name: 'Revocar' })); let confirm = await screen.findByRole('alertdialog'); expect(within(confirm).getByRole('button', { name: 'Revocar clave' })).toBeDisabled()
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes(server)).toEqual([]); await waitFor(() => expect(screen.getByRole('button', { name: 'Revocar' })).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: 'Revocar' })); confirm = await screen.findByRole('alertdialog')
  fireEvent.change(within(confirm).getByLabelText('Escribe fk_anon_ab12 para confirmar'), { target: { value: 'fk_anon_ab12' } }); fireEvent.click(within(confirm).getByRole('button', { name: 'Revocar clave' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Revocar' })).toBeNull())
  expect(writes(server)).toEqual([expect.objectContaining({ method: 'DELETE', path: `${keysPath()}/key-1` })]); expect(count(server, keysPath())).toBe(2); expect((await screen.findAllByText('Clave revocada')).length).toBeGreaterThan(0)
})

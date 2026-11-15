import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { button, calls, click, enterTarget, failWith, loaded, open, setup, settle, typeInto } from './consoleMongoData-support'
import { docsPath, docsUrl, fixtures, keysPath, pageDocs } from './parity/pages/console-mongo-data-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const writes = () => calls(server).filter((call) => call.method !== 'GET')
const count = (path: string) => calls(server).filter((call) => call.path === path).length
const notice = async (text: string) => { expect((await screen.findAllByText(text)).length).toBeGreaterThan(0) }
// The live announcer keeps its last message outside the editor, so absence of a callout is asserted inside the editor.
const inEditor = () => within(screen.getByTestId('mongodata-editor'))
const choose = async (label: string, option: string) => { fireEvent.click(screen.getByRole('combobox', { name: label })); const item = await screen.findByRole('option', { name: option }); fireEvent.pointerDown(item); fireEvent.click(item) }
const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement
const idPath = (id: string) => `${docsPath}/${id}`
const confirmField = (dialog: HTMLElement, id: string) => within(dialog).getByLabelText(`Escribe ${id} para confirmar`)
const refunds = `/v1/mongo/workspaces/ws-1/data/catalog/collections/refunds/documents`

test('no request until a database and a collection are entered; both are trimmed', async () => {
  server = setup(); open()
  expect(screen.getByText('Introduce una base de datos y una colección para comenzar.')).toBeVisible()
  typeInto('Base de datos', '  catalog  '); await settle(); expect(calls(server)).toEqual([])
  typeInto('Colección', ' orders '); await settle(); await loaded()
  expect(calls(server).map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${docsUrl()}`])
  expect(screen.getByRole('heading', { name: 'catalog.orders' })).toBeVisible()
})
test('lists page[size]=25 with no filter, shows each document in a json viewer and its count', async () => {
  server = setup(); open(); await enterTarget(); await loaded()
  expect(screen.getByRole('heading', { name: 'Documentos (3)' })).toBeVisible()
  const table = screen.getByRole('table', { name: 'Documentos de la colección' })
  for (const id of ['ord_01', 'ord_02', 'ord_03']) expect(within(table).getByText(new RegExp(id))).toBeVisible()
  expect(within(table).getAllByRole('button', { name: /^Editar documento/ })).toHaveLength(3); expect(within(table).getAllByRole('button', { name: /^Eliminar documento/ })).toHaveLength(3)
  expect(calls(server)[0].path).toBe(`${docsPath}?page%5Bsize%5D=25`)
})
test('paging, filter, clear, page size and collection changes each drop page[after]', async () => {
  const paid = { status: 'paid' }
  server = setup({ [`GET ${docsUrl({ after: 'c1' })}`]: fixtures['mongo:documents-page-2'], [`GET ${docsUrl({ filter: paid })}`]: fixtures['mongo:documents-filtered-paid'], [`GET ${docsUrl({ size: 50 })}`]: fixtures['mongo:documents-size-50'], [`GET ${docsUrl({ size: 50, base: refunds })}`]: fixtures['mongo:documents-collection-refunds'] })
  open(); await enterTarget(); await loaded(); expect(button('Anterior')).toBeDisabled()
  click('Siguiente'); await screen.findByText(/ord_04/); expect(button('Siguiente')).toBeDisabled(); expect(button('Anterior')).toBeEnabled()
  click('Anterior'); await loaded(); expect(count(docsUrl())).toBe(2)
  click('Siguiente'); await screen.findByText(/ord_04/)
  fireEvent.change(field('Filtro (consulta MongoDB en JSON)'), { target: { value: '{"status":"paid"}' } }); click('Aplicar filtro')
  await waitFor(() => expect(screen.queryByText(/ord_04/)).toBeNull()); await screen.findByText(/ord_02/)
  expect(count(docsUrl({ filter: paid }))).toBe(1); expect(calls(server).some((call) => call.path.includes('filter') && call.path.includes('page%5Bafter%5D'))).toBe(false); expect(button('Anterior')).toBeDisabled()
  click('Limpiar'); await screen.findByText(/ord_03/); expect(field('Filtro (consulta MongoDB en JSON)')).toHaveValue('{}')
  expect(count(docsUrl())).toBe(3)
  click('Siguiente'); await screen.findByText(/ord_04/); await choose('Tamaño de página', '50'); await screen.findByText(/ord_03/); expect(button('Anterior')).toBeDisabled(); expect(count(docsUrl({ size: 50 }))).toBe(1)
  typeInto('Colección', 'refunds'); await screen.findByText(/ref_1/); expect(button('Anterior')).toBeDisabled()
  expect(calls(server).filter((call) => call.path.includes('/refunds/')).every((call) => !call.path.includes('page%5Bafter%5D'))).toBe(true)
})
test('Aplicar filtro with {} sends no filter; an invalid filter shows Filtro: and sends nothing', async () => {
  server = setup(); open(); await enterTarget(); await loaded()
  fireEvent.change(field('Filtro (consulta MongoDB en JSON)'), { target: { value: '{nope' } }); click('Aplicar filtro'); await notice('Filtro: JSON no válido')
  fireEvent.change(field('Filtro (consulta MongoDB en JSON)'), { target: { value: '[1]' } }); click('Aplicar filtro'); await notice('Filtro: Se esperaba un objeto JSON')
  expect(calls(server)).toHaveLength(1)
  fireEvent.change(field('Filtro (consulta MongoDB en JSON)'), { target: { value: '{}' } }); click('Aplicar filtro'); await waitFor(() => expect(count(docsUrl())).toBe(2)); expect(inEditor().queryByText(/^Filtro:/)).toBeNull()
})
test('insert validates the JSON object, posts {document}, resets the form and reloads', async () => {
  let inserted = false
  server = setup({ [`POST ${docsPath}`]: () => { inserted = true; return Response.json(fixtures['mongo:insert-ok']) }, [`GET ${docsUrl()}`]: () => Response.json(inserted ? fixtures['mongo:documents-after-insert'] : fixtures['mongo:documents-page-1']) })
  open(); await enterTarget(); await loaded()
  const area = field('Documento nuevo (JSON)'); expect(area).toHaveValue('{}')
  fireEvent.change(area, { target: { value: '{nope' } }); click('Insertar'); await notice('Documento nuevo: JSON no válido')
  fireEvent.change(area, { target: { value: '[1]' } }); click('Insertar'); await notice('Documento nuevo: Se esperaba un objeto JSON'); expect(writes()).toEqual([])
  fireEvent.change(area, { target: { value: '{"status":"new"}' } }); click('Insertar')
  await screen.findByText(/ord_07/); expect(writes()).toEqual([expect.objectContaining({ method: 'POST', path: docsPath, body: { document: { status: 'new' } } })])
  expect(area).toHaveValue('{}'); expect(screen.getByRole('heading', { name: 'Documentos (4)' })).toBeVisible(); expect((await screen.findAllByText('Documento insertado')).length).toBeGreaterThan(0)
  expect(inEditor().queryByText(/^Documento nuevo:/)).toBeNull()
})
test('insert-500 keeps the typed JSON and the list, shows the error in the insert form and a retry sends one POST', async () => {
  let attempts = 0, inserted = false
  server = setup({ [`POST ${docsPath}`]: () => { attempts++; if (attempts === 1) return failWith(500, { message: 'duplicate key value' })(); inserted = true; return Response.json(fixtures['mongo:insert-ok']) }, [`GET ${docsUrl()}`]: () => Response.json(inserted ? fixtures['mongo:documents-after-insert'] : fixtures['mongo:documents-page-1']) })
  open(); await enterTarget(); await loaded()
  fireEvent.change(field('Documento nuevo (JSON)'), { target: { value: '{"status":"new"}' } }); click('Insertar')
  await notice('duplicate key value'); expect(field('Documento nuevo (JSON)')).toHaveValue('{"status":"new"}'); expect(screen.queryByText(/ord_07/)).toBeNull()
  await waitFor(() => expect(button('Insertar')).toHaveFocus()); expect(count(docsUrl())).toBe(1)
  click('Insertar'); await screen.findByText(/ord_07/); expect(writes().map((call) => call.method)).toEqual(['POST', 'POST']); expect(field('Documento nuevo (JSON)')).toHaveValue('{}'); expect(inEditor().queryByText('duplicate key value')).toBeNull()
})
test('Guardar sends PATCH {update} without _id or id, closes the drawer, reloads and returns focus to Editar', async () => {
  let patched = false
  server = setup({ [`PATCH ${idPath('ord_01')}`]: () => { patched = true; return Response.json(fixtures['mongo:update-ok']) }, [`GET ${docsUrl()}`]: () => Response.json(patched ? fixtures['mongo:documents-after-update'] : fixtures['mongo:documents-page-1']) })
  open(); await enterTarget(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Editar documento ord_01' }))
  const drawer = await screen.findByRole('dialog'); expect(within(drawer).getByRole('heading', { name: 'Editar documento ord_01' })).toBeVisible()
  const area = within(drawer).getByLabelText('Documento (JSON)') as HTMLTextAreaElement; expect(JSON.parse(area.value)).toMatchObject({ _id: 'ord_01', status: 'pending' })
  fireEvent.change(area, { target: { value: '{nope' } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' })); expect(await within(drawer).findByText('Documento editado: JSON no válido')).toBeVisible(); expect(writes()).toEqual([])
  fireEvent.change(area, { target: { value: JSON.stringify({ _id: 'ord_01', id: 'x', status: 'shipped' }) } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' }))
  await screen.findByText(/shipped/); await waitFor(() => expect(screen.queryByTestId('mongodata-drawer')).toBeNull())
  expect(writes()).toEqual([expect.objectContaining({ method: 'PATCH', path: idPath('ord_01'), body: { update: { status: 'shipped' } } })])
  expect((await screen.findAllByText('Documento actualizado')).length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Editar documento ord_01' })).toHaveFocus())
})
test('update-500 keeps the drawer open with the edited JSON and the error, focus stays on Guardar and a retry sends one PATCH', async () => {
  let attempts = 0, patched = false
  server = setup({ [`PATCH ${idPath('ord_01')}`]: () => { attempts++; if (attempts === 1) return failWith(500, { message: 'write conflict' })(); patched = true; return Response.json(fixtures['mongo:update-ok']) }, [`GET ${docsUrl()}`]: () => Response.json(patched ? fixtures['mongo:documents-after-update'] : fixtures['mongo:documents-page-1']) })
  open(); await enterTarget(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Editar documento ord_01' }))
  const drawer = await screen.findByRole('dialog'); const area = within(drawer).getByLabelText('Documento (JSON)') as HTMLTextAreaElement
  fireEvent.change(area, { target: { value: '{"status":"shipped"}' } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' }))
  expect(await within(drawer).findByText('write conflict')).toBeVisible(); expect(area).toHaveValue('{"status":"shipped"}')
  await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Guardar' })).toHaveFocus()); expect(screen.getByRole('dialog')).toBe(drawer)
  fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' })); await waitFor(() => expect(screen.queryByTestId('mongodata-drawer')).toBeNull())
  expect(writes().map((call) => call.method)).toEqual(['PATCH', 'PATCH']); await screen.findByText(/shipped/)
})
test('Eliminar needs the exact typed _id, Cancelar and Escape send nothing and return focus, one DELETE then reloads and focuses a surviving row', async () => {
  let deleted = false
  server = setup({ [`DELETE ${idPath('ord_01')}`]: () => { deleted = true; return Response.json(fixtures['mongo:delete-ok']) }, [`GET ${docsUrl()}`]: () => Response.json(deleted ? fixtures['mongo:documents-after-delete'] : fixtures['mongo:documents-page-1']) })
  open(); await enterTarget(); await loaded()
  const trigger = screen.getByRole('button', { name: 'Eliminar documento ord_01' }); fireEvent.click(trigger)
  let dialog = await screen.findByRole('alertdialog'); expect(within(dialog).getByText(/ord_01/, { selector: '[data-slot="alert-dialog-description"], p, div' })).toBeVisible()
  const confirm = within(dialog).getByRole('button', { name: 'Eliminar documento' }); expect(confirm).toBeDisabled(); await waitFor(() => expect(confirmField(dialog, 'ord_01')).toHaveFocus())
  fireEvent.change(confirmField(dialog, 'ord_01'), { target: { value: 'ord_0' } }); expect(confirm).toBeDisabled(); fireEvent.change(confirmField(dialog, 'ord_01'), { target: { value: 'ORD_01' } }); expect(confirm).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([]); await waitFor(() => expect(trigger).toHaveFocus())
  fireEvent.click(trigger); dialog = await screen.findByRole('alertdialog'); fireEvent.keyDown(dialog, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([]); await waitFor(() => expect(trigger).toHaveFocus())
  fireEvent.click(trigger); dialog = await screen.findByRole('alertdialog'); fireEvent.change(confirmField(dialog, 'ord_01'), { target: { value: 'ord_01' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' }))
  await waitFor(() => expect(screen.queryByText(/ord_01/)).toBeNull()); expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', path: idPath('ord_01') })])
  expect(screen.getByRole('heading', { name: 'Documentos (2)' })).toBeVisible(); expect((await screen.findAllByText('Documento eliminado')).length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar documento ord_02' })).toHaveFocus())
})
test('delete-500 keeps the dialog open with the error and request id, the typed id and focus inside; a retry sends exactly one DELETE', async () => {
  let attempts = 0, deleted = false
  server = setup({ [`DELETE ${idPath('ord_01')}`]: () => { attempts++; if (attempts === 1) return failWith(500)(); deleted = true; return Response.json(fixtures['mongo:delete-ok']) }, [`GET ${docsUrl()}`]: () => Response.json(deleted ? fixtures['mongo:documents-after-delete'] : fixtures['mongo:documents-page-1']) })
  open(); await enterTarget(); await loaded(); const trigger = screen.getByRole('button', { name: 'Eliminar documento ord_01' }); fireEvent.click(trigger)
  const dialog = await screen.findByRole('alertdialog'); fireEvent.change(confirmField(dialog, 'ord_01'), { target: { value: 'ord_01' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' }))
  const error = await within(dialog).findByTestId('mongodata-confirm-error'); expect(error).toHaveTextContent('El servidor no pudo completar la solicitud'); expect(error).toHaveTextContent('mongo-request')
  expect(screen.getByRole('alertdialog')).toBe(dialog); expect(confirmField(dialog, 'ord_01')).toHaveValue('ord_01'); expect(screen.getByText(/ord_01/, { selector: '[data-testid="mongodata-documents"] *' })).toBeVisible()
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true)); expect(document.activeElement).not.toBe(document.body)
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Eliminar documento' })).toBeEnabled()); expect(count(docsUrl())).toBe(1)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes().map((call) => call.method)).toEqual(['DELETE', 'DELETE']); await waitFor(() => expect(screen.queryByText(/ord_01/)).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar documento ord_02' })).toHaveFocus())
})
test('Cancelar and Escape after a failed delete close the dialog, send nothing more and return focus to that row', async () => {
  server = setup({ [`DELETE ${idPath('ord_02')}`]: failWith(500) })
  open(); await enterTarget(); await loaded(); const trigger = screen.getByRole('button', { name: 'Eliminar documento ord_02' })
  for (const how of ['cancel', 'escape']) {
    fireEvent.click(trigger); const dialog = await screen.findByRole('alertdialog'); fireEvent.change(confirmField(dialog, 'ord_02'), { target: { value: 'ord_02' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' }))
    await within(dialog).findByTestId('mongodata-confirm-error')
    if (how === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' })); else fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); await waitFor(() => expect(trigger).toHaveFocus())
  }
  expect(writes().map((call) => call.method)).toEqual(['DELETE', 'DELETE'])
})
test('documents without _id or id cannot be edited or deleted and send no request', async () => {
  server = setup({ [`GET ${docsUrl()}`]: fixtures['mongo:document-without-id'] }); open(); await enterTarget(); await screen.findByText(/orphan/)
  fireEvent.click(screen.getByRole('button', { name: /^Editar documento/ })); await notice('El documento no tiene _id para editarlo')
  fireEvent.click(screen.getByRole('button', { name: /^Eliminar documento/ })); await notice('El documento no tiene _id para eliminarlo')
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(writes()).toEqual([])
})
test('a document keyed by id (no _id) is edited and deleted by that id', async () => {
  server = setup({ [`GET ${docsUrl()}`]: { items: [{ id: 'k 1', status: 'x' }], page: {} }, [`DELETE ${docsPath}/k%201`]: fixtures['mongo:delete-ok'] }); open(); await enterTarget(); await screen.findByText(/k 1/)
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar documento k 1' })); const dialog = await screen.findByRole('alertdialog'); fireEvent.change(confirmField(dialog, 'k 1'), { target: { value: 'k 1' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' }))
  await waitFor(() => expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', path: `${docsPath}/k%201` })]))
})
test('empty list, filtered no-results with Limpiar, and the insert form stay usable', async () => {
  server = setup({ [`GET ${docsUrl()}`]: fixtures['mongo:documents-empty'], [`GET ${docsUrl({ filter: { status: 'none' } })}`]: fixtures['mongo:documents-empty'] }); open(); await enterTarget()
  expect(await screen.findByText('Todavía no hay documentos.')).toBeVisible(); expect(field('Documento nuevo (JSON)')).toBeVisible(); expect(button('Emitir clave anónima')).toBeEnabled()
  fireEvent.change(field('Filtro (consulta MongoDB en JSON)'), { target: { value: '{"status":"none"}' } }); click('Aplicar filtro')
  const none = await screen.findByText('Ningún documento coincide con el filtro.'); expect(none).toBeVisible()
  const region = screen.getByTestId('mongodata-documents'); fireEvent.click(within(region).getByRole('button', { name: 'Limpiar' })); await screen.findByText('Todavía no hay documentos.'); expect(field('Filtro (consulta MongoDB en JSON)')).toHaveValue('{}')
})
test.each([[403, 'No tienes acceso'], [404, 'Colección no encontrada']])('list %s shows its in-page state and sends no write', async (status, title) => {
  server = setup({ [`GET ${docsUrl()}`]: failWith(status) }); open(); await enterTarget(); const panel = await screen.findByTestId('mongodata-failure-documents')
  expect(within(panel).getByText(title)).toBeVisible(); expect(within(panel).queryByRole('button', { name: 'Reintentar' })).toBeNull(); expect(writes()).toEqual([])
})
test('404 offers Volver, which clears the fields, focuses Base de datos and sends nothing', async () => {
  server = setup({ [`GET ${docsUrl()}`]: failWith(404) }); open(); await enterTarget(); const panel = await screen.findByTestId('mongodata-failure-documents')
  fireEvent.click(within(panel).getByRole('button', { name: 'Volver' })); expect(await screen.findByText('Introduce una base de datos y una colección para comenzar.')).toBeVisible()
  expect(screen.getByLabelText('Base de datos')).toHaveValue(''); expect(screen.getByLabelText('Colección')).toHaveValue(''); await waitFor(() => expect(screen.getByLabelText('Base de datos')).toHaveFocus()); expect(calls(server)).toHaveLength(1)
})
test.each([[500, 'mongo-request'], ['network', undefined]] as const)('list %s shows the error panel and Reintentar reloads once; the previous page is not shown as fresh', async (failure, requestId) => {
  let attempts = 0
  server = setup({ [`GET ${docsUrl()}`]: () => { attempts++; if (attempts === 1) return failure === 500 ? failWith(500)() : Promise.reject(new TypeError('Failed to fetch')) as unknown as Response; return Response.json(fixtures['mongo:documents-page-1']) } })
  open(); await enterTarget(); const panel = await screen.findByTestId('mongodata-failure-documents'); if (requestId) expect(panel).toHaveTextContent(requestId); expect(screen.queryByText(/ord_01/)).toBeNull()
  fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' })); await loaded(); expect(count(docsUrl())).toBe(2)
})
test('every request is one of the page requests: list, insert, patch, delete, issue key and the apikey preview', async () => {
  const allowed = [/^GET \/v1\/mongo\/workspaces\/ws-1\/data\/[^/]+\/collections\/[^/]+\/documents\?/, /^POST \/v1\/mongo\/workspaces\/ws-1\/data\/[^/]+\/collections\/[^/]+\/documents$/, /^(PATCH|DELETE) \/v1\/mongo\/workspaces\/ws-1\/data\/[^/]+\/collections\/[^/]+\/documents\/[^/]+$/, /^POST \/v1\/workspaces\/ws-1\/api-keys$/]
  server = setup({ [`POST ${docsPath}`]: fixtures['mongo:insert-ok'], [`PATCH ${idPath('ord_01')}`]: fixtures['mongo:update-ok'], [`DELETE ${idPath('ord_01')}`]: fixtures['mongo:delete-ok'], [`POST ${keysPath}`]: fixtures['mongo:anon-key-issued-synthetic'] })
  open(); await enterTarget(); await loaded()
  click('Insertar'); await waitFor(() => expect(count(docsUrl())).toBe(2))
  fireEvent.click(await screen.findByRole('button', { name: 'Editar documento ord_01' })); fireEvent.click(await within(await screen.findByTestId('mongodata-drawer')).findByRole('button', { name: 'Guardar' })); await waitFor(() => expect(count(docsUrl())).toBe(3))
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar documento ord_01' })); const dialog = await screen.findByRole('alertdialog'); fireEvent.change(confirmField(dialog, 'ord_01'), { target: { value: 'ord_01' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' })); await waitFor(() => expect(count(docsUrl())).toBe(4))
  // The kit keeps the rest of the page aria-hidden until the closing dialog has finished, so wait for it before looking for the next button.
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  fireEvent.click(await screen.findByRole('button', { name: 'Emitir clave anónima' })); await screen.findByTestId('mongodata-reveal')
  const sent = calls(server).map(({ method, path }) => `${method} ${path}`)
  for (const request of sent) expect(allowed.some((rule) => rule.test(request)), request).toBe(true)
  expect(sent.some((request) => /postgres|imports|exports|^PUT/.test(request))).toBe(false); expect(sent.filter((request) => /api-keys/.test(request))).toEqual([`POST ${keysPath}`])
  expect(pageDocs(1, 1)).toHaveLength(1)
}, 30000)

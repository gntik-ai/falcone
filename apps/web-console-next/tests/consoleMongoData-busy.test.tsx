import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { button, calls, click, enterTarget, loaded, open, settle, typeInto, setup } from './consoleMongoData-support'
import { docsPath, docsUrl, fixtures } from './parity/pages/console-mongo-data-page.manifest'

// These journeys chain several async waits; the default 1 s wait is too short when the suite runs under load.
configure({ asyncUtilTimeout: 5000 })
let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const writes = () => calls(server).filter((call) => call.method !== 'GET')
const refunds = '/v1/mongo/workspaces/ws-1/data/catalog/collections/refunds/documents'
const hold = () => { const slot: { release?: (response: Response) => void } = {}; return { slot, route: () => new Promise<Response>((resolve) => { slot.release = resolve }) } }

test('a pending insert keeps Insertar, Editar, Eliminar, Anterior and Siguiente disabled even after the collection changes, and settling re-enables them', async () => {
  const slow = hold()
  server = setup({ [`POST ${docsPath}`]: slow.route, [`GET ${docsUrl({ base: refunds })}`]: fixtures['mongo:documents-collection-refunds'] })
  open(); await enterTarget(); await loaded(); click('Insertar'); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  for (const control of [button('Insertar'), ...screen.queryAllByRole('button', { name: /^(Editar|Eliminar) documento/ })]) expect(control).toBeDisabled()
  typeInto('Colección', 'refunds'); await screen.findByText(/ref_1/)
  expect(button('Insertar')).toBeDisabled(); expect(button('Siguiente')).toBeDisabled(); expect(button('Anterior')).toBeDisabled()
  for (const control of screen.queryAllByRole('button', { name: /^(Editar|Eliminar) documento/ })) expect(control).toBeDisabled()
  fireEvent.click(button('Insertar')); expect(writes()).toHaveLength(1)
  typeInto('Colección', 'orders'); await loaded(); expect(button('Insertar')).toBeDisabled()
  await act(async () => slow.slot.release!(Response.json(fixtures['mongo:insert-ok']))); await waitFor(() => expect(button('Insertar')).toBeEnabled())
  expect(screen.getAllByRole('button', { name: /^Editar documento/ })[0]).toBeEnabled()
})
test('while an insert is pending, page size, the filter and the key button stay enabled', async () => {
  const slow = hold()
  server = setup({ [`POST ${docsPath}`]: slow.route }); open(); await enterTarget(); await loaded(); click('Insertar'); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  expect(button('Insertar')).toBeDisabled(); expect(screen.getByRole('combobox', { name: 'Tamaño de página' })).toBeEnabled(); expect(screen.getByLabelText('Filtro (consulta MongoDB en JSON)')).toBeEnabled()
  expect(button('Aplicar filtro')).toBeEnabled(); expect(button('Limpiar')).toBeEnabled(); expect(button('Emitir clave anónima')).toBeEnabled()
  await act(async () => slow.slot.release!(Response.json(fixtures['mongo:insert-ok']))); await settle()
})
test('a pending patch keeps the drawer open: Cancelar is disabled and Escape or an outside press send nothing; idle dismissals close it and return focus to Editar', async () => {
  const slow = hold()
  let reads = 0; server = setup({ [`PATCH ${docsPath}/ord_01`]: slow.route, [`GET ${docsUrl()}`]: () => Response.json(++reads === 1 ? fixtures['mongo:documents-page-1'] : fixtures['mongo:documents-after-update']) })
  open(); await enterTarget(); await loaded()
  const editor = screen.getByRole('button', { name: 'Editar documento ord_01' })
  fireEvent.click(editor); let drawer = await screen.findByTestId('mongodata-drawer'); fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByTestId('mongodata-drawer')).toBeNull()); await waitFor(() => expect(editor).toHaveFocus())
  fireEvent.click(editor); drawer = await screen.findByTestId('mongodata-drawer'); fireEvent.keyDown(drawer, { key: 'Escape' }); await waitFor(() => expect(screen.queryByTestId('mongodata-drawer')).toBeNull()); await waitFor(() => expect(editor).toHaveFocus())
  fireEvent.click(editor); drawer = await screen.findByTestId('mongodata-drawer'); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' })); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  expect(within(drawer).getByRole('button', { name: 'Cancelar' })).toBeDisabled(); expect(within(drawer).getByRole('button', { name: 'Guardar' })).toBeDisabled()
  fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' })); fireEvent.keyDown(drawer, { key: 'Escape' }); fireEvent.pointerDown(document.body); fireEvent.click(document.body)
  await settle(); expect(screen.getByTestId('mongodata-drawer')).toBeVisible(); expect(writes()).toHaveLength(1)
  for (const name of ['Insertar', 'Anterior', 'Siguiente']) expect(screen.getByRole('button', { name, hidden: true })).toBeDisabled()
  await act(async () => slow.slot.release!(Response.json(fixtures['mongo:update-ok']))); await waitFor(() => expect(screen.queryByTestId('mongodata-drawer')).toBeNull())
  await screen.findByText(/shipped/); await waitFor(() => expect(document.activeElement).not.toBe(document.body)); expect(button('Insertar')).toBeEnabled()
}, 30000)
test('a pending delete cannot be dismissed: Cancelar is disabled, Escape sends nothing, and the confirm sends one DELETE', async () => {
  const slow = hold()
  server = setup({ [`DELETE ${docsPath}/ord_01`]: slow.route }); open(); await enterTarget(); await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar documento ord_01' })); const dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByLabelText('Escribe ord_01 para confirmar'), { target: { value: 'ord_01' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar documento' }))
  await waitFor(() => expect(slow.slot.release).toBeTypeOf('function')); expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.keyDown(within(dialog).getByLabelText('Escribe ord_01 para confirmar'), { key: 'Enter' }); await settle(); expect(screen.getByRole('alertdialog')).toBe(dialog); expect(writes()).toHaveLength(1)
  await act(async () => slow.slot.release!(Response.json(fixtures['mongo:delete-ok']))); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
})

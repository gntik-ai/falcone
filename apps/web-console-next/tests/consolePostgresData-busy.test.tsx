import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { button, calls, click, enterTarget, loaded, open, settle, typeInto, setup } from './consolePostgresData-support'
import { byKeyPath, fixtures, rowsPath, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const writes = () => calls(server).filter((call) => call.method !== 'GET')
const ordersRows = rowsPath.replace('/accounts/', '/orders/')
const ordersPage = { items: [{ id: 'ord_1' }], page: {}, count: 1 }
const hold = () => { const slot: { release?: (response: Response) => void } = {}; return { slot, route: () => new Promise<Response>((resolve) => { slot.release = resolve }) } }
const mutationControls = () => [button('Insertar'), ...screen.queryAllByRole('button', { name: /^(Editar|Eliminar) fila/ })]

test('a pending insert keeps Insertar, Editar, Eliminar, Anterior and Siguiente disabled even after the target changes, and settling re-enables them', async () => {
  const slow = hold()
  server = setup({ [`POST ${rowsPath}`]: slow.route, [`GET ${rowsUrl({ base: ordersRows })}`]: { ...ordersPage, items: [{ id: 'ord_1' }], page: { after: 'o2' } } })
  open(); await enterTarget(); await loaded(); click('Insertar'); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  for (const control of mutationControls()) expect(control).toBeDisabled()
  typeInto('Tabla', 'orders'); await screen.findByText('ord_1')
  expect(button('Insertar')).toBeDisabled(); expect(button('Siguiente')).toBeDisabled(); expect(button('Anterior')).toBeDisabled()
  for (const control of screen.queryAllByRole('button', { name: /^(Editar|Eliminar) fila/ })) expect(control).toBeDisabled()
  fireEvent.click(button('Insertar')); expect(writes()).toHaveLength(1)
  typeInto('Tabla', 'accounts'); await screen.findByText('acc_01'); expect(button('Insertar')).toBeDisabled()
  await act(async () => slow.slot.release!(Response.json(fixtures['pg-row-insert-ok']))); await waitFor(() => expect(button('Insertar')).toBeEnabled())
  expect(screen.getAllByRole('button', { name: /^Editar fila/ })[0]).toBeEnabled()
})
test('while an insert is pending, page size, filter fields, Añadir filtro, Quitar, issue buttons and Revocar stay enabled', async () => {
  const slow = hold()
  server = setup({ [`POST ${rowsPath}`]: slow.route, [`GET ${rowsUrl({ filters: [['id', 'eq.acc_01']] })}`]: fixtures['pg-rows-empty'] }); open(); await enterTarget(); await loaded()
  typeInto('Columna', 'id'); typeInto(/^Valor/, 'acc_01'); click('Añadir filtro'); await screen.findByText('Todavía no hay filas.')
  click('Insertar'); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  expect(button('Insertar')).toBeDisabled(); expect(screen.getByRole('combobox', { name: 'Tamaño de página' })).toBeEnabled(); expect(screen.getByLabelText('Columna')).toBeEnabled(); expect(button('Añadir filtro')).toBeEnabled()
  expect(screen.getByRole('button', { name: /^Quitar filtro/ })).toBeEnabled(); expect(button('Emitir clave anónima')).toBeEnabled(); expect(button('Emitir clave de servicio')).toBeEnabled(); expect(screen.getByRole('button', { name: 'Revocar clave syn_anon_01' })).toBeEnabled()
  await act(async () => slow.slot.release!(Response.json(fixtures['pg-row-insert-ok']))); await settle()
})
test('a pending patch keeps the drawer open: Cancelar is disabled and Escape or an outside press send nothing; idle dismissals close it and return focus to Editar', async () => {
  const slow = hold()
  // The first rows read is the page1 fixture; later reads return the patched rows.
  let reads = 0; server = setup({ [`PATCH ${byKeyPath}?id=acc_01`]: slow.route, [`GET ${rowsUrl()}`]: () => Response.json(++reads === 1 ? fixtures['pg-rows-page1'] : fixtures['pg-rows-after-patch']) })
  open(); await enterTarget(); await loaded()
  const editor = screen.getByRole('button', { name: 'Editar fila acc_01' })
  // Idle: Cancelar closes and focus returns to Editar.
  fireEvent.click(editor); let drawer = await screen.findByTestId('pgdata-drawer'); fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByTestId('pgdata-drawer')).toBeNull()); await waitFor(() => expect(editor).toHaveFocus())
  // Idle: Escape closes and focus returns to Editar.
  fireEvent.click(editor); drawer = await screen.findByTestId('pgdata-drawer'); fireEvent.keyDown(drawer, { key: 'Escape' }); await waitFor(() => expect(screen.queryByTestId('pgdata-drawer')).toBeNull()); await waitFor(() => expect(editor).toHaveFocus())
  // Busy: nothing dismisses the drawer.
  fireEvent.click(editor); drawer = await screen.findByTestId('pgdata-drawer'); fireEvent.click(within(drawer).getByRole('button', { name: 'Guardar' })); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  expect(within(drawer).getByRole('button', { name: 'Cancelar' })).toBeDisabled(); expect(within(drawer).getByRole('button', { name: 'Guardar' })).toBeDisabled()
  fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' })); fireEvent.keyDown(drawer, { key: 'Escape' }); fireEvent.pointerDown(document.body); fireEvent.click(document.body)
  await settle(); expect(screen.getByTestId('pgdata-drawer')).toBeVisible(); expect(writes()).toHaveLength(1)
  // The background controls are hidden from the accessibility tree, so query them with includeHidden.
  for (const name of ['Insertar', 'Anterior', 'Siguiente']) expect(screen.getByRole('button', { name, hidden: true })).toBeDisabled()
  await act(async () => slow.slot.release!(Response.json(fixtures['pg-row-patch-ok']))); await waitFor(() => expect(screen.queryByTestId('pgdata-drawer')).toBeNull())
  await screen.findByText('enterprise'); await waitFor(() => expect(document.activeElement).not.toBe(document.body)); expect(button('Insertar')).toBeEnabled()
})
test('the busy state is shared: a pending insert also keeps the drawer from being saved', async () => {
  const slow = hold()
  server = setup({ [`POST ${rowsPath}`]: slow.route }); open(); await enterTarget(); await loaded(); click('Insertar'); await waitFor(() => expect(slow.slot.release).toBeTypeOf('function'))
  expect(screen.getByRole('button', { name: 'Editar fila acc_01' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Editar fila acc_01' })); expect(screen.queryByTestId('pgdata-drawer')).toBeNull()
  await act(async () => slow.slot.release!(Response.json(fixtures['pg-row-insert-ok']))); await settle()
})

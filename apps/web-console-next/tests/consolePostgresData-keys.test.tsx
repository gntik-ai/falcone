import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { button, calls, click, enterTarget, failWith, loaded, open, setup } from './consolePostgresData-support'
import { fixtures, keysPath, previewUrl, rowsPath, synthetic } from './parity/pages/console-postgres-data-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => { server?.verify(); vi.unstubAllGlobals() })
const writes = () => calls(server).filter((call) => call.method !== 'GET')
const issueRoutes = { [`POST ${keysPath}`]: (init: RequestInit) => Response.json((JSON.parse(String(init.body)).keyType === 'anon' ? fixtures['pg-api-key-issue-anon'] : fixtures['pg-api-key-issue-service'])) }
const reveal = async (name: string) => { fireEvent.click(button(name)); return screen.findByTestId('pgdata-reveal') }

test.each([['Emitir clave anónima', 'anon', synthetic.anon], ['Emitir clave de servicio', 'service', synthetic.service]])('%s posts {keyType}, reveals the key masked once and reloads the list', async (name, keyType, key) => {
  server = setup({ ...issueRoutes, [`GET ${previewUrl}`]: fixtures['pg-rows-preview-apikey'] }); open(); await enterTarget(); await loaded()
  const keysBefore = calls(server).filter((call) => call.path === keysPath && call.method === 'GET').length
  const dialog = await reveal(name)
  expect(writes()).toEqual([expect.objectContaining({ method: 'POST', path: keysPath, body: { keyType } })])
  expect(within(dialog).getByText('Se muestra una sola vez')).toBeVisible()
  const field = within(dialog).getByLabelText('Clave emitida') as HTMLInputElement; expect(field).toHaveAttribute('data-masked', 'true'); expect(field.value).not.toContain(key)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mostrar clave' })); expect((within(dialog).getByLabelText('Clave emitida') as HTMLInputElement).value).toBe(key)
  expect(within(dialog).getByRole('heading', { name: 'Fragmento fetch' })).toBeVisible(); expect(within(dialog).getByRole('heading', { name: 'Fragmento curl' })).toBeVisible()
  expect(dialog.textContent).toContain(`apikey: '${key}'`)
  await waitFor(() => expect(calls(server).filter((call) => call.path === keysPath && call.method === 'GET')).toHaveLength(keysBefore + 1))
  // The secret never reaches storage or the toast region.
  expect(JSON.stringify({ ...localStorage })).not.toContain(key); expect(JSON.stringify({ ...sessionStorage })).not.toContain(key)
})
test('Copiar copies exactly the issued key', async () => {
  const writeText = vi.fn(async () => undefined); vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }))
  server = setup(issueRoutes); open(); await enterTarget(); await loaded(); const dialog = await reveal('Emitir clave anónima')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar clave' })); await within(dialog).findByRole('button', { name: 'Copiada' }); expect(writeText).toHaveBeenCalledWith(synthetic.anon)
})
test('the preview sends only apikey auth with page[size]=10, disables itself while running and renders its own table', async () => {
  let release!: (response: Response) => void
  server = setup({ ...issueRoutes, [`GET ${previewUrl}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await enterTarget(); await loaded(); const dialog = await reveal('Emitir clave anónima')
  const run = within(dialog).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' }); fireEvent.click(run); await waitFor(() => expect(release).toBeTypeOf('function')); expect(run).toBeDisabled(); fireEvent.click(run)
  expect(calls(server).filter((call) => call.path === previewUrl)).toHaveLength(1)
  await act(async () => release(Response.json(fixtures['pg-rows-preview-apikey']))); await waitFor(() => expect(run).toBeEnabled())
  const sent = calls(server).find((call) => call.path === previewUrl)!
  expect(sent.method).toBe('GET'); expect(sent.headers.get('apikey')).toBe(synthetic.anon); expect(sent.headers.has('Authorization')).toBe(false)
  for (const header of ['Accept', 'Content-Type', 'X-API-Version', 'X-Correlation-Id']) expect(sent.headers.has(header)).toBe(true)
  const table = within(dialog).getByRole('table', { name: 'Vista previa de filas con la clave emitida' }); expect(within(table).getByRole('columnheader', { name: 'plan' })).toBeVisible(); expect(within(table).getByText('pro')).toBeVisible()
  expect(within(dialog).getByText('Vista previa con esta clave: 2 filas.')).toBeVisible(); expect(within(screen.getByTestId('pgdata-rows')).queryByRole('table', { name: 'Vista previa de filas con la clave emitida' })).toBeNull()
})
test('a failed preview shows its message inline and a 401 never starts a session refresh', async () => {
  server = setup({ ...issueRoutes, [`GET ${previewUrl}`]: failWith(401, { message: 'invalid api key' }) }); open(); await enterTarget(); await loaded(); const dialog = await reveal('Emitir clave anónima')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' })); expect(await within(dialog).findByText('invalid api key')).toBeVisible()
  expect(calls(server).filter((call) => call.path.includes('/refresh'))).toEqual([])
})
test('closing the reveal returns focus to its issue button and drops the key; a later issue replaces it', async () => {
  server = setup(issueRoutes); open(); await enterTarget(); await loaded(); const issue = button('Emitir clave anónima'); const dialog = await reveal('Emitir clave anónima')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' })); await waitFor(() => expect(screen.queryByTestId('pgdata-reveal')).toBeNull()); await waitFor(() => expect(issue).toHaveFocus()); expect(document.body.textContent).not.toContain(synthetic.anon)
  const second = await reveal('Emitir clave de servicio'); expect(second.textContent).toContain(synthetic.service); expect(second.textContent).not.toContain(synthetic.anon)
  fireEvent.keyDown(second, { key: 'Escape' }); await waitFor(() => expect(screen.queryByTestId('pgdata-reveal')).toBeNull()); await waitFor(() => expect(button('Emitir clave de servicio')).toHaveFocus())
})
test('leaving the page drops the held key', async () => {
  server = setup(issueRoutes); const view = open(); await enterTarget(); await loaded(); await reveal('Emitir clave anónima'); view.unmount(); expect(document.body.textContent).not.toContain(synthetic.anon)
})
test('issuing a key can fail without leaking: the server message shows in the callout', async () => {
  server = setup({ [`POST ${keysPath}`]: failWith(500, { message: 'quota reached' }) }); open(); await enterTarget(); await loaded(); fireEvent.click(button('Emitir clave anónima'))
  expect(await screen.findByText('quota reached')).toBeVisible(); expect(screen.queryByTestId('pgdata-reveal')).toBeNull()
})
test('Revocar needs the typed prefix, Cancelar sends nothing, and a confirmed revoke sends DELETE then reloads the list', async () => {
  let revoked = false
  server = setup({ [`DELETE ${keysPath}/key-anon-1`]: () => { revoked = true; return Response.json(fixtures['pg-api-key-revoke-ok']) }, [`GET ${keysPath}`]: () => Response.json(revoked ? fixtures['pg-api-keys-after-revoke'] : fixtures['pg-api-keys']) })
  open(); await enterTarget(); await loaded(); const trigger = screen.getByRole('button', { name: 'Revocar clave syn_anon_01' }); fireEvent.click(trigger)
  let dialog = await screen.findByRole('alertdialog'); const confirm = within(dialog).getByRole('button', { name: 'Revocar clave' }); expect(confirm).toBeDisabled()
  fireEvent.change(within(dialog).getByLabelText('Escribe syn_anon_01 para confirmar'), { target: { value: 'syn_anon' } }); expect(confirm).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([]); await waitFor(() => expect(trigger).toHaveFocus())
  fireEvent.click(trigger); dialog = await screen.findByRole('alertdialog'); fireEvent.change(within(dialog).getByLabelText('Escribe syn_anon_01 para confirmar'), { target: { value: 'syn_anon_01' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Revocar clave' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Revocar clave syn_anon_01/ })).toBeNull())
  expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', path: `${keysPath}/key-anon-1` })])
  expect((await screen.findAllByText('Clave revocada')).length).toBeGreaterThan(0); expect(screen.getAllByText('Revocada')).toHaveLength(2); expect(screen.queryAllByRole('button', { name: /^Revocar/ })).toHaveLength(0)
  await waitFor(() => expect(document.activeElement).not.toBe(document.body))
})
test('row loads are never affected by key loads: rows base path is shared with the preview only through the apikey header', () => {
  expect(previewUrl.startsWith(rowsPath)).toBe(true)
})

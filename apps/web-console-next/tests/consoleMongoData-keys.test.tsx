import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { button, calls, click, enterTarget, failWith, loaded, open, setup } from './consoleMongoData-support'
import { fixtures, keysPath, previewUrl, synthetic } from './parity/pages/console-mongo-data-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => { server?.verify(); vi.unstubAllGlobals() })
const writes = () => calls(server).filter((call) => call.method !== 'GET')
const issueRoute = { [`POST ${keysPath}`]: fixtures['mongo:anon-key-issued-synthetic'] }
const reveal = async () => { fireEvent.click(button('Emitir clave anónima')); return screen.findByTestId('mongodata-reveal') }

test('Emitir clave anónima posts {keyType:"anon"}, reveals the key masked once with both snippets and never lists keys', async () => {
  server = setup(issueRoute); open(); await enterTarget(); await loaded()
  const dialog = await reveal()
  expect(writes()).toEqual([expect.objectContaining({ method: 'POST', path: keysPath, body: { keyType: 'anon' } })])
  expect(within(dialog).getByText('Se muestra una sola vez')).toBeVisible()
  const field = within(dialog).getByLabelText('Clave emitida') as HTMLInputElement; expect(field).toHaveAttribute('data-masked', 'true'); expect(field.value).not.toContain(synthetic.anon)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mostrar clave' })); expect((within(dialog).getByLabelText('Clave emitida') as HTMLInputElement).value).toBe(synthetic.anon)
  expect(within(dialog).getByRole('heading', { name: 'Fragmento fetch' })).toBeVisible(); expect(within(dialog).getByRole('heading', { name: 'Fragmento curl' })).toBeVisible()
  expect(dialog.textContent).toContain(`apikey: '${synthetic.anon}'`); expect(dialog.textContent).toContain('/v1/mongo/workspaces/ws-1/data/catalog/collections/orders/documents')
  expect(calls(server).filter((call) => call.path === keysPath)).toHaveLength(1)
  // The secret never reaches storage, the toast region or the live announcer.
  expect(JSON.stringify({ ...localStorage })).not.toContain(synthetic.anon); expect(JSON.stringify({ ...sessionStorage })).not.toContain(synthetic.anon)
  for (const region of document.querySelectorAll('[aria-live], [role="region"]')) if (!dialog.contains(region)) expect(region.textContent).not.toContain(synthetic.anon)
})
test('Copiar copies exactly the issued key', async () => {
  const writeText = vi.fn(async () => undefined); vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }))
  server = setup(issueRoute); open(); await enterTarget(); await loaded(); const dialog = await reveal()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar clave' })); await within(dialog).findByRole('button', { name: 'Copiada' }); expect(writeText).toHaveBeenCalledWith(synthetic.anon)
})
test('the preview is a GET with page[size]=10 and only apikey auth, is single-flight and renders each document in a json viewer', async () => {
  let release!: (response: Response) => void
  server = setup({ ...issueRoute, [`GET ${previewUrl}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await enterTarget(); await loaded(); const dialog = await reveal()
  const run = within(dialog).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' }); fireEvent.click(run); await waitFor(() => expect(release).toBeTypeOf('function')); expect(run).toBeDisabled(); fireEvent.click(run)
  expect(calls(server).filter((call) => call.path === previewUrl)).toHaveLength(1)
  await act(async () => release(Response.json(fixtures['mongo:preview-2']))); await waitFor(() => expect(run).toBeEnabled())
  const sent = calls(server).find((call) => call.path === previewUrl)!
  expect(sent.method).toBe('GET'); expect(sent.headers.get('apikey')).toBe(synthetic.anon); expect(sent.headers.has('Authorization')).toBe(false); expect(sent.body).toBeUndefined()
  for (const header of ['Accept', 'Content-Type', 'X-API-Version', 'X-Correlation-Id']) expect(sent.headers.has(header)).toBe(true)
  expect(within(dialog).getByText('Vista previa con esta clave: 2 documentos.')).toBeVisible(); expect(within(dialog).getByText(/ord_02/)).toBeVisible()
  expect(within(screen.getByTestId('mongodata-documents')).queryByTestId('mongodata-preview')).toBeNull()
})
test('a failed preview shows its message locally and a 401 never starts a session refresh, replay or logout', async () => {
  server = setup({ ...issueRoute, [`GET ${previewUrl}`]: failWith(401, { message: 'invalid api key' }) }); open(); await enterTarget(); await loaded(); const dialog = await reveal()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ejecutar vista previa de solo lectura' })); expect(await within(dialog).findByText('invalid api key')).toBeVisible()
  expect(calls(server).filter((call) => call.path.includes('/refresh'))).toEqual([]); expect(calls(server).filter((call) => call.path === previewUrl)).toHaveLength(1); expect(screen.getByTestId('mongodata-reveal')).toBeVisible()
})
test('closing the reveal returns focus to Emitir clave anónima and drops the key; Escape does the same', async () => {
  server = setup(issueRoute); open(); await enterTarget(); await loaded(); const issue = button('Emitir clave anónima'); let dialog = await reveal()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' })); await waitFor(() => expect(screen.queryByTestId('mongodata-reveal')).toBeNull()); await waitFor(() => expect(issue).toHaveFocus()); expect(document.body.textContent).not.toContain(synthetic.anon)
  dialog = await reveal(); fireEvent.keyDown(dialog, { key: 'Escape' }); await waitFor(() => expect(screen.queryByTestId('mongodata-reveal')).toBeNull()); await waitFor(() => expect(button('Emitir clave anónima')).toHaveFocus()); expect(document.body.textContent).not.toContain(synthetic.anon)
})
test('leaving the page drops the held key', async () => {
  server = setup(issueRoute); const view = open(); await enterTarget(); await loaded(); await reveal(); view.unmount(); expect(document.body.textContent).not.toContain(synthetic.anon)
})
test('issuing a key can fail without leaking: the server message shows in the callout and no dialog opens', async () => {
  server = setup({ [`POST ${keysPath}`]: failWith(500, { message: 'quota reached' }) }); open(); await enterTarget(); await loaded(); click('Emitir clave anónima')
  expect((await screen.findAllByText('quota reached')).length).toBeGreaterThan(0); expect(screen.queryByTestId('mongodata-reveal')).toBeNull(); expect(button('Emitir clave anónima')).toBeEnabled()
})

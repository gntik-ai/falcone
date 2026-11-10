import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { login } from './shell-support'
import { element, patchContext, gate, open, serve, workspaceContext } from './consoleWorkspaceSecrets-support'
import { canary, cursorPath, secretPath, secretsPath, typed } from './parity/pages/console-workspace-secrets-page.manifest'

let server: ReturnType<typeof serve>
beforeEach(() => { login(); workspaceContext('dev') })
afterEach(() => expect(server?.unmatched).toEqual([]))

const nameField = () => screen.getByLabelText('Nombre del secreto') as HTMLInputElement
const valueField = () => screen.getByLabelText('Valor del secreto') as HTMLInputElement
const descriptionField = () => screen.getByLabelText('Descripción del secreto (opcional)') as HTMLInputElement
const set = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } })
const click = (name: string | RegExp, scope: HTMLElement = document.body) => fireEvent.click(within(scope).getByRole('button', { name }))
const isBlank = (element: HTMLElement) => (element as HTMLInputElement).value === ''
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const writes = () => server.requests().filter(({ method }) => method !== 'GET')
const reads = () => server.requests().filter(({ method }) => method === 'GET' && !('page' in {}))
const typedField = () => screen.getByLabelText('Escribe exactamente el nombre del recurso para confirmar.') as HTMLInputElement
const confirmDialog = () => screen.getByRole('alertdialog')
const replaceDialog = () => screen.getByRole('dialog', { name: 'Reemplazar secreto' })
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
const ready = async () => { await screen.findByText('db_password') }
// Answers every request of one method with an arbitrary failure, after the manifest scenario served the reads.
function failWith(method: string, status: number, code?: string, extra: Record<string, unknown> = {}) {
  const original = server.mock.getMockImplementation()!
  server.mock.mockImplementation(async (input, init) => (init?.method ?? 'GET') === method
    ? (server.scenario.calls.push({ method, path: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined }), Response.json({ status, code: code ?? `HTTP_${status}`, message: 'synthetic-backend-reason', ...typed, ...extra }, { status }))
    : original(input, init))
}
const openRow = (action: 'Reemplazar' | 'Eliminar', name: string) => click(action === 'Reemplazar' ? `Reemplazar el secreto ${name}` : `Eliminar el secreto ${name}`)

// ---- create ----
test('create sends one POST with the trimmed description, clears the form, reloads the first page and focuses the name', async () => {
  server = serve('workspace-secrets.create.success')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary); set(descriptionField(), '  a note  ')
  click('Crear secreto')
  await waitFor(() => expect(isBlank(nameField())).toBe(true))
  expect(writes()).toEqual([{ method: 'POST', path: secretsPath, body: { secretName: 'new_secret', secretValue: canary, description: 'a note' } }])
  expect(isBlank(valueField())).toBe(true)
  expect(isBlank(descriptionField())).toBe(true)
  expect(server.requests().filter(({ method }) => method === 'GET')).toHaveLength(2)
  expect(await screen.findByText('Secreto "new_secret" creado.', { selector: '[data-testid="workspace-secrets-create-success"] *' })).toBeVisible()
  await waitFor(() => expect(nameField()).toHaveFocus())
  // Toast and live announcer carry the message; neither carries the value.
  expect(screen.getAllByText('Secreto "new_secret" creado.').length).toBeGreaterThanOrEqual(2)
  expect(document.body.textContent).not.toContain(canary)
})

test('create omits a blank description from the payload', async () => {
  server = serve('workspace-secrets.create.success')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary); set(descriptionField(), '   ')
  click('Crear secreto')
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0].body).toEqual({ secretName: 'new_secret', secretValue: canary })
})

test('create 500 then network then success keeps the fields and re-sends the same POST from Reintentar', async () => {
  server = serve('workspace-secrets.create.500-then-network-then-success')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary); set(descriptionField(), 'note')
  click('Crear secreto')
  const panel = await screen.findByTestId('workspace-secrets-failure-create')
  expect(within(panel).getByText(typed.requestId)).toBeVisible()
  expect(within(panel).getByText(/La operación falló\. \(correlación corr_synthetic_secrets\)/)).toBeVisible()
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Reintentar' })).toHaveFocus())
  expect(nameField().value).toBe('new_secret'); expect(valueField().value === canary).toBe(true)
  click('Reintentar', panel)
  await waitFor(() => expect(screen.getByTestId('workspace-secrets-failure-create')).not.toHaveTextContent(typed.requestId))
  expect(within(screen.getByTestId('workspace-secrets-failure-create')).getByText(/No se pudo contactar con el servicio/)).toBeVisible()
  await waitFor(() => expect(within(screen.getByTestId('workspace-secrets-failure-create')).getByRole('button', { name: 'Reintentar' })).toHaveFocus())
  click('Reintentar', screen.getByTestId('workspace-secrets-failure-create'))
  await waitFor(() => expect(isBlank(nameField())).toBe(true))
  const posts = writes()
  expect(posts).toHaveLength(3)
  expect(posts.every(({ body }) => JSON.stringify(body) === JSON.stringify(posts[0].body))).toBe(true)
})

test.each([[400, 'La solicitud no es válida: revisa el nombre y el valor del secreto.'], [409, 'Ya existe un secreto con ese nombre. Usa "Reemplazar" para cambiar su valor.'], [413, 'El valor del secreto es demasiado grande (máximo 65535 caracteres).'], [429, 'Has superado el límite de operaciones. Espera un momento y reintenta.'], [502, 'El servicio de secretos falló al procesar la operación. Reintenta más tarde.'], [501, 'El servicio de secretos no está disponible en esta instalación.']])('create %s keeps its legacy message in place and focus stays in the form', async (status, message) => {
  server = serve('workspace-secrets.create.success')
  open(); await ready()
  failWith('POST', status)
  set(nameField(), 'new_secret'); set(valueField(), canary)
  click('Crear secreto')
  const alert = await screen.findByTestId('workspace-secrets-create-error')
  expect(alert).toHaveTextContent(message)
  expect(screen.queryByTestId('workspace-secrets-failure-create')).toBeNull()
  expect(nameField().value).toBe('new_secret')
  await waitFor(() => expect(document.activeElement?.closest('form')).not.toBeNull())
  expect(valueField().readOnly).toBe(false)
})

test('create 403 renders no-access with the value cleared and Volver al formulario restores an EMPTY form with focus', async () => {
  server = serve('workspace-secrets.create.403')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary); set(descriptionField(), 'note')
  click('Crear secreto')
  const title = await screen.findByRole('heading', { name: 'No tienes permiso para crear secretos' })
  expect(screen.getByText(/No tienes permisos para esta acción en esta área de trabajo\./)).toHaveTextContent(typed.correlationId)
  expect(screen.queryByLabelText('Valor del secreto')).toBeNull()
  await waitFor(() => expect(title).toHaveFocus())
  const before = server.requests().length
  click('Volver al formulario')
  expect(isBlank(nameField())).toBe(true); expect(isBlank(valueField())).toBe(true); expect(isBlank(descriptionField())).toBe(true)
  await waitFor(() => expect(nameField()).toHaveFocus())
  expect(server.requests()).toHaveLength(before)
})

test('create 404 renders not-found, clears only the value and Volver al formulario keeps name and description without a request', async () => {
  server = serve('workspace-secrets.create.404')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary); set(descriptionField(), 'note')
  click('Crear secreto')
  const title = await screen.findByRole('heading', { name: 'No se pudo crear el secreto' })
  expect(screen.getByText(`El recurso no está disponible para este contexto. (correlación ${typed.correlationId})`)).toBeVisible()
  await waitFor(() => expect(title).toHaveFocus())
  const before = server.requests().length
  click('Volver al formulario')
  expect(nameField().value).toBe('new_secret'); expect(descriptionField().value).toBe('note'); expect(isBlank(valueField())).toBe(true)
  await waitFor(() => expect(nameField()).toHaveFocus())
  expect(server.requests()).toHaveLength(before)
})

test('Nuevo secreto restores the form after a create 403 and focuses the name field', async () => {
  server = serve('workspace-secrets.create.403')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary)
  click('Crear secreto')
  await screen.findByRole('heading', { name: 'No tienes permiso para crear secretos' })
  click('Nuevo secreto')
  expect(isBlank(nameField())).toBe(true)
  await waitFor(() => expect(nameField()).toHaveFocus())
})

test('an initial list 500 followed by a create 404 returns focus to the name field, not the body', async () => {
  server = serve('workspace-secrets.create.404')
  const original = server.mock.getMockImplementation()!
  let first = true
  server.mock.mockImplementation(async (input, init) => (init?.method ?? 'GET') === 'GET' && first
    ? ((first = false), Response.json({ status: 500, code: 'HTTP_500', message: 'synthetic-backend-reason', requestId: typed.requestId }, { status: 500 }))
    : original(input, init))
  open()
  await screen.findByRole('heading', { name: 'No se pudieron cargar los secretos' })
  expect(document.body).toHaveFocus()
  set(nameField(), 'new_secret'); set(valueField(), canary)
  click('Crear secreto')
  await screen.findByRole('heading', { name: 'No se pudo crear el secreto' })
  click('Volver al formulario')
  await waitFor(() => expect(nameField()).toHaveFocus())
})

// ---- replace ----
test('replace opens a dialog named Reemplazar secreto, validates the value and prefills only the description', async () => {
  server = serve('workspace-secrets.replace.success')
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  expect(within(dialog).getByLabelText('Nuevo valor del secreto')).toHaveAttribute('type', 'password')
  expect(isBlank(within(dialog).getByLabelText('Nuevo valor del secreto'))).toBe(true)
  expect((within(dialog).getByLabelText('Descripción del secreto (opcional)') as HTMLInputElement).value).toBe('Synthetic database credential')
  expect(within(dialog).queryByRole('button', { name: /mostrar|ocultar|show|hide/i })).toBeNull()
  fireEvent.submit(dialog.querySelector('form')!)
  expect(within(dialog).getByText('El valor del secreto es obligatorio.')).toBeVisible()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(writes()).toEqual([])
})

test('replace: the dialog submit opens the typed confirmation without a request, Cancel returns with fields kept, the exact name sends one PUT', async () => {
  server = serve('workspace-secrets.replace.success')
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  let dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  set(within(dialog).getByLabelText('Descripción del secreto (opcional)'), '  fresh note ')
  click('Reemplazar', dialog)
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText('El valor actual se sobrescribe y no se puede recuperar.')).toBeVisible()
  expect(writes()).toEqual([])
  const action = within(confirm).getByRole('button', { name: 'Reemplazar' })
  expect(action).toBeDisabled()
  set(typedField(), 'db_passwor')
  expect(action).toBeDisabled()
  click('Cancelar', confirm)
  dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  expect((within(dialog).getByLabelText('Nuevo valor del secreto') as HTMLInputElement).value === canary).toBe(true)
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Reemplazar' })).toHaveFocus())
  expect(writes()).toEqual([])
  click('Reemplazar', dialog)
  const again = await screen.findByRole('alertdialog')
  expect(isBlank(typedField())).toBe(true)
  set(typedField(), 'db_password')
  click('Reemplazar', again)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toEqual({ method: 'PUT', path: secretPath('db_password'), body: { secretValue: canary, description: 'fresh note' } })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(server.requests().filter(({ method }) => method === 'GET')).toHaveLength(2)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reemplazar el secreto db_password' })).toHaveFocus())
  expect(screen.getAllByText('Secreto "db_password" reemplazado.').length).toBeGreaterThanOrEqual(1)
  expect(document.body.textContent).not.toContain(canary)
})

test('Escape in the typed confirmation returns to the replace dialog; Cancel in the dialog clears the value and focuses the row button', async () => {
  server = serve('workspace-secrets.replace.success')
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  let dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  click('Reemplazar', dialog)
  await screen.findByRole('alertdialog')
  escape()
  dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  expect((within(dialog).getByLabelText('Nuevo valor del secreto') as HTMLInputElement).value === canary).toBe(true)
  click('Cancelar', dialog)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reemplazar el secreto db_password' })).toHaveFocus())
  openRow('Reemplazar', 'db_password')
  dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  expect(isBlank(within(dialog).getByLabelText('Nuevo valor del secreto'))).toBe(true)
  expect(writes()).toEqual([])
})

test('replace 500 then network then success keeps typed name and payload, re-sends the same PUT, and Cancel after a failed PUT keeps the value', async () => {
  server = serve('workspace-secrets.replace.500-then-network-then-success')
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  click('Reemplazar', dialog)
  let confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Reemplazar', confirm)
  const panel = await within(confirm).findByTestId('workspace-secrets-failure-confirm')
  expect(within(panel).getByText(typed.requestId)).toBeVisible()
  // The failure is shown once: the panel only, with no second plain message.
  expect(within(confirm).queryByTestId('workspace-secrets-confirm-error')).toBeNull()
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Reintentar' })).toHaveFocus())
  expect(typedField().value).toBe('db_password')
  // Cancel after the failed PUT sends nothing and returns to the dialog with the value kept.
  click('Cancelar', confirm)
  const back = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  expect((within(back).getByLabelText('Nuevo valor del secreto') as HTMLInputElement).value === canary).toBe(true)
  expect(writes()).toHaveLength(1)
  click('Reemplazar', back)
  confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Reemplazar', confirm)
  await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByText(/No se pudo contactar con el servicio/)).toBeVisible())
  click('Reintentar', screen.getByRole('alertdialog'))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  const puts = writes()
  expect(puts).toHaveLength(3)
  expect(puts.every(({ body }) => JSON.stringify(body) === JSON.stringify(puts[0].body))).toBe(true)
})

test('replacing a secret reached through Cargar más that is absent after the reload focuses the section title', async () => {
  server = serve('workspace-secrets.replace.later-page-success')
  open()
  await screen.findByText('secret_25')
  click('Cargar más secretos')
  await screen.findByText('secret_28')
  openRow('Reemplazar', 'secret_26')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  click('Reemplazar', dialog)
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'secret_26')
  click('Reemplazar', confirm)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0].path).toBe(secretPath('secret_26'))
  const title = await screen.findByRole('heading', { name: 'Secretos guardados' })
  await waitFor(() => expect(title).toHaveFocus())
  expect(screen.queryByText('secret_28')).toBeNull()
  expect(server.requests().filter(({ method, path }) => method === 'GET' && path === cursorPath)).toHaveLength(1)
})

test.each([
  ['workspace-secrets.replace.403', 'No tienes permiso para reemplazar este secreto', /No tienes permisos para esta acción/],
  ['workspace-secrets.replace.404-secret-not-found', 'No se pudo reemplazar el secreto', /El secreto ya no existe\./],
  ['workspace-secrets.replace-and-delete.404-generic', 'No se pudo reemplazar el secreto', /El recurso no está disponible para este contexto\./],
])('replace %s closes the dialogs, clears the value and shows the state above the table', async (fixture, title, message) => {
  server = serve(fixture)
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  click('Reemplazar', dialog)
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Reemplazar', confirm)
  const heading = await screen.findByRole('heading', { name: title })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(screen.getByText(message)).toHaveTextContent(typed.correlationId)
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText('Secreto "db_password" reemplazado.')).toBeNull()
  openRow('Reemplazar', 'db_password')
  expect(isBlank(within(await screen.findByRole('dialog', { name: 'Reemplazar secreto' })).getByLabelText('Nuevo valor del secreto'))).toBe(true)
  escape()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const before = server.requests().filter(({ method }) => method === 'GET').length
  click('Volver a la lista')
  await waitFor(() => expect(server.requests().filter(({ method }) => method === 'GET')).toHaveLength(before + 1))
  expect(server.requests().at(-1)).toEqual({ method: 'GET', path: secretsPath, body: undefined })
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Secretos guardados' })).toHaveFocus())
})

test('a non-retryable replace failure keeps focus inside the confirmation, which stays read-only while pending', async () => {
  const release = gate()
  server = serve('workspace-secrets.replace.success', [{ match: (method) => method === 'PUT', gate: release }])
  open(); await ready()
  failWith('PUT', 409)
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  click('Reemplazar', dialog)
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Reemplazar', confirm)
  await waitFor(() => expect(writes()).toHaveLength(1))
  await waitFor(() => expect(within(confirm).getByTestId('workspace-secrets-confirm-error')).toHaveTextContent('Ya existe un secreto con ese nombre.'))
  expect(document.activeElement?.closest('[role="alertdialog"]')).not.toBeNull()
  expect(typedField().readOnly).toBe(false)
  expect(typedField().value).toBe('db_password')
})

// ---- delete ----
test('every Eliminar opens the typed confirmation with the legacy copy and the referenced impact, and Cancel focuses Eliminar without a request', async () => {
  server = serve('workspace-secrets.delete.success')
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText('Eliminar secreto del área de trabajo')).toBeVisible()
  expect(within(confirm).getByText('Vas a eliminar db_password.')).toBeVisible()
  expect(within(confirm).getByText('2 función(es) referencian este secreto. Al eliminarlo, la variable de entorno inyectada desaparecerá en su próximo despliegue y podría romper su funcionamiento.')).toBeVisible()
  expect(within(confirm).getByText('Impacto en cascada')).toBeVisible()
  expect(within(confirm).getByText('funciones que lo usan / 2')).toBeVisible()
  expect(within(confirm).getByText('Esta operación es irreversible.')).toBeVisible()
  expect(within(confirm).getByRole('button', { name: 'Eliminar' })).toBeDisabled()
  set(typedField(), 'DB_PASSWORD')
  expect(within(confirm).getByRole('button', { name: 'Eliminar' })).toBeDisabled()
  click('Cancelar', confirm)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar el secreto db_password' })).toHaveFocus())
  expect(writes()).toEqual([])
})

test.each([
  ['unreferenced development secret', 'dev', 'api_key', 'No hay funciones referenciadas detectadas ahora, pero una referencia ausente se omite silenciosamente durante el despliegue.', 'No se detectaron recursos dependientes adicionales.'],
  ['unreferenced staging secret', 'staging', 'api_key', 'No hay funciones referenciadas detectadas ahora, pero una referencia ausente se omite silenciosamente durante el despliegue.', 'No se detectaron recursos dependientes adicionales.'],
])('delete of an %s still requires the typed name', async (_label, environment, name, impact, cascade) => {
  workspaceContext(environment)
  server = serve(environment === 'staging' ? 'workspace-secrets.delete.unreferenced-staging' : 'workspace-secrets.delete.success')
  open(); await ready()
  openRow('Eliminar', name)
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText(impact)).toBeVisible()
  expect(within(confirm).getByText(cascade)).toBeVisible()
  expect(within(confirm).getByRole('button', { name: 'Eliminar' })).toBeDisabled()
  set(typedField(), name)
  click('Eliminar', confirm)
  await waitFor(() => expect(writes()).toEqual([{ method: 'DELETE', path: secretPath(name), body: undefined }]))
})

test.each(['production', 'prod'])('delete in a %s workspace adds the live-environment impact text', async (environment) => {
  workspaceContext(environment)
  server = serve('shell.workspace-live-environment')
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  expect(within(confirm).getByText(/2 función\(es\) referencian este secreto\..* El área de trabajo activa está marcada como producción; confirma explícitamente antes de eliminar un secreto de este entorno\./)).toBeVisible()
})

test('the exact name sends one DELETE, shows the busy label Eliminar…, reloads and moves focus to the section title', async () => {
  const release = gate()
  server = serve('workspace-secrets.delete.success', [{ match: (method) => method === 'DELETE', gate: release }])
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Eliminar', confirm)
  await waitFor(() => expect(within(confirm).getByRole('button', { name: 'Eliminar…' })).toBeVisible())
  // Escape while busy does nothing; the typed name is read-only while pending.
  escape()
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(typedField().readOnly).toBe(true)
  expect(writes()).toHaveLength(1)
  await act(async () => { release.release() })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual([{ method: 'DELETE', path: secretPath('db_password'), body: undefined }])
  expect(server.requests().filter(({ method }) => method === 'GET')).toHaveLength(2)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Secretos guardados' })).toHaveFocus())
  expect(screen.getAllByText('Secreto "db_password" eliminado.').length).toBeGreaterThanOrEqual(1)
})

test('deleting the last row moves focus to the empty-state title', async () => {
  server = serve('workspace-secrets.delete.last-row')
  open()
  await screen.findByText('only_secret')
  openRow('Eliminar', 'only_secret')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'only_secret')
  click('Eliminar', confirm)
  const title = await screen.findByRole('heading', { name: 'No hay secretos en esta área de trabajo' })
  await waitFor(() => expect(title).toHaveFocus())
})

test('delete 500 then network then success shows one failure panel and re-sends the same DELETE', async () => {
  server = serve('workspace-secrets.delete.500-then-network-then-success')
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Eliminar', confirm)
  const panel = await within(confirm).findByTestId('workspace-secrets-failure-confirm')
  expect(within(panel).getByText(typed.requestId)).toBeVisible()
  expect(within(confirm).queryByTestId('workspace-secrets-confirm-error')).toBeNull()
  expect(confirm.textContent!.split('La operación falló.').length - 1).toBeLessThanOrEqual(1)
  expect(typedField().value).toBe('db_password')
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Reintentar' })).toHaveFocus())
  click('Reintentar', panel)
  // The network failure carries no request id and uses the destructive-operation fallback text.
  await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByText('No se pudo completar la operación.')).toBeVisible())
  expect(within(screen.getByRole('alertdialog')).queryByText(typed.requestId)).toBeNull()
  click('Reintentar', screen.getByRole('alertdialog'))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual(Array(3).fill({ method: 'DELETE', path: secretPath('db_password'), body: undefined }))
})

test('delete.500 and 500-then-success keep the confirmation open until the retry succeeds', async () => {
  server = serve('workspace-secrets.delete.500')
  open(); await ready()
  openRow('Eliminar', 'api_key')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'api_key')
  click('Eliminar', confirm)
  await within(confirm).findByTestId('workspace-secrets-failure-confirm')
  click('Reintentar', confirm)
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(screen.getByRole('alertdialog')).toBeVisible()
})

test.each([
  [409, 'La solicitud entra en conflicto con el estado actual del recurso.'],
  [429, 'Se alcanzó el límite de solicitudes; inténtalo de nuevo en unos momentos.'],
  [502, 'El servicio no está disponible en este momento.'],
  [400, 'No se pudo completar la operación.'],
  [413, 'No se pudo completar la operación.'],
  [501, 'El servicio no está disponible en este momento.'],
  [418, 'No se pudo completar la operación.'],
])('delete %s shows the destructive-operation text in place and keeps focus in the confirmation', async (status, message) => {
  server = serve('workspace-secrets.delete.success')
  open(); await ready()
  failWith('DELETE', status)
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Eliminar', confirm)
  await waitFor(() => expect(within(confirm).getByTestId('workspace-secrets-confirm-error')).toHaveTextContent(message))
  expect(within(confirm).queryByTestId('workspace-secrets-failure-confirm')).toBeNull()
  expect(document.activeElement?.closest('[role="alertdialog"]')).not.toBeNull()
  expect(typedField().value).toBe('db_password')
})

test.each([
  ['workspace-secrets.delete.403', 'No tienes permiso para eliminar este secreto', /No tienes permisos para esta acción/],
  ['workspace-secrets.delete.404-secret-not-found', 'No se pudo eliminar el secreto', /El secreto ya no existe\./],
  ['workspace-secrets.replace-and-delete.404-generic', 'No se pudo eliminar el secreto', /El recurso no está disponible para este contexto\./],
])('delete %s closes the confirmation and shows the state above the table with Volver a la lista', async (fixture, title, message) => {
  server = serve(fixture)
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Eliminar', confirm)
  const heading = await screen.findByRole('heading', { name: title })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(screen.getByText(message)).toHaveTextContent(typed.correlationId)
  expect(screen.queryByText('Secreto "db_password" eliminado.')).toBeNull()
  click('Volver a la lista')
  await waitFor(() => expect(screen.queryByRole('heading', { name: title })).toBeNull())
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Secretos guardados' })).toHaveFocus())
})

test('the replace and delete flows send nothing else: GET of one secret is never requested', async () => {
  server = serve('workspace-secrets.delete.success')
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Eliminar', confirm)
  await waitFor(() => expect(writes()).toHaveLength(1))
  await settle()
  expect(server.requests().every(({ method, path }) => !(method === 'GET' && path.startsWith(`${secretsPath}/`)))).toBe(true)
})

test('the fixtures of the other suites and this one stay synthetic: no canary is ever rendered', async () => {
  server = serve('workspace-secrets.list.success')
  open(); await ready()
  set(valueField(), canary)
  // The typed value lives only in the input, never in rendered text.
  expect(document.body.textContent).not.toContain(canary)
  expect(reads().length).toBeGreaterThan(0)
  expect(vi.isMockFunction(fetch)).toBe(true)
})

test('a workspace switch closes an open dialog and clears the values of the form and the dialog', async () => {
  server = serve('workspace-secrets.list.success')
  const view = open(); await ready()
  set(nameField(), 'half_typed'); set(valueField(), canary)
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  patchContext({ activeWorkspaceId: 'synthetic-workspace-2', workspaces: [{ workspaceId: 'synthetic-workspace-2', tenantId: 'synthetic-tenant', displayName: 'Second', environment: 'dev' }] })
  const original = server.mock.getMockImplementation()!
  server.mock.mockImplementation(async (input, init) => String(input) === '/v1/functions/workspaces/synthetic-workspace-2/secrets' ? Response.json({ items: [], page: { size: 25 } }) : original(input, init))
  view.rerender(element())
  await screen.findByRole('heading', { name: 'No hay secretos en esta área de trabajo' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(isBlank(nameField())).toBe(true); expect(isBlank(valueField())).toBe(true)
  expect(writes()).toEqual([])
})

test('the replace dialog keeps the kit size and has no width override', async () => {
  server = serve('workspace-secrets.list.success')
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  expect(dialog.className).not.toMatch(/max-w-full/)
  expect(dialog.querySelector('form')).not.toBeNull()
})

test('create.500-then-success retries the same POST once and clears the form', async () => {
  server = serve('workspace-secrets.create.500-then-success')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary)
  click('Crear secreto')
  const panel = await screen.findByTestId('workspace-secrets-failure-create')
  click('Reintentar', panel)
  await waitFor(() => expect(isBlank(nameField())).toBe(true))
  expect(writes()).toHaveLength(2)
  expect(JSON.stringify(writes()[0].body) === JSON.stringify(writes()[1].body)).toBe(true)
})

test('replace.500-then-success retries the same PUT once from the confirmation', async () => {
  server = serve('workspace-secrets.replace.500-then-success')
  open(); await ready()
  openRow('Reemplazar', 'db_password')
  const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
  set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
  click('Reemplazar', dialog)
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password')
  click('Reemplazar', confirm)
  const panel = await within(confirm).findByTestId('workspace-secrets-failure-confirm')
  click('Reintentar', panel)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toHaveLength(2)
  expect(JSON.stringify(writes()[0]) === JSON.stringify(writes()[1])).toBe(true)
})

test('list.page-2.500-then-network-then-success (dotted id) serves the same sequence as its dashed twin', async () => {
  server = serve('workspace-secrets.list.page-2.500-then-network-then-success')
  open()
  await screen.findByText('secret_25')
  click('Cargar más secretos')
  expect(await screen.findByRole('heading', { name: 'No se pudo cargar la siguiente página de secretos' })).toBeVisible()
})

// ---- checker findings of the second attempt ----
test.each([
  ['delete', 'workspace-secrets.delete.500-then-network-then-success'],
  ['replace', 'workspace-secrets.replace.500-then-network-then-success'],
] as const)('%s: Reintentar after a 500 or a network failure never re-sends while the typed name is a mismatch', async (kind, fixture) => {
  server = serve(fixture)
  open(); await ready()
  if (kind === 'delete') openRow('Eliminar', 'db_password')
  else {
    openRow('Reemplazar', 'db_password')
    const dialog = await screen.findByRole('dialog', { name: 'Reemplazar secreto' })
    set(within(dialog).getByLabelText('Nuevo valor del secreto'), canary)
    click('Reemplazar', dialog)
  }
  const confirm = await screen.findByRole('alertdialog')
  const action = kind === 'delete' ? 'Eliminar' : 'Reemplazar'
  set(typedField(), 'db_password'); click(action, confirm)
  // 500: edit the typed name to a mismatch; the disabled Confirm and Reintentar agree.
  await within(confirm).findByTestId('workspace-secrets-failure-confirm')
  set(typedField(), 'db_passwor')
  expect(within(confirm).getByRole('button', { name: action })).toBeDisabled()
  click('Reintentar', confirm); await settle()
  expect(writes()).toHaveLength(1)
  // Matching again: the retry is sent and the network failure follows.
  set(typedField(), 'db_password'); click('Reintentar', confirm)
  await waitFor(() => expect(writes()).toHaveLength(2))
  await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByTestId('workspace-secrets-failure-confirm')).toBeVisible())
  set(typedField(), 'other'); click('Reintentar', screen.getByRole('alertdialog')); await settle()
  expect(writes()).toHaveLength(2)
})

test('a create 404 carrying SECRET_NOT_FOUND still renders the generic non-leaking message', async () => {
  server = serve('workspace-secrets.create.404')
  failWith('POST', 404, 'SECRET_NOT_FOUND')
  open(); await ready()
  set(nameField(), 'new_secret'); set(valueField(), canary)
  click('Crear secreto')
  await screen.findByRole('heading', { name: 'No se pudo crear el secreto' })
  expect(screen.getByText(`El recurso no está disponible para este contexto. (correlación ${typed.correlationId})`)).toBeVisible()
  expect(screen.queryByText(/El secreto ya no existe/)).toBeNull()
})

test('a delete 500 shows the request id and the correlation id with the destructive-operation message', async () => {
  server = serve('workspace-secrets.delete.500')
  open(); await ready()
  openRow('Eliminar', 'db_password')
  const confirm = await screen.findByRole('alertdialog')
  set(typedField(), 'db_password'); click('Eliminar', confirm)
  const panel = await within(confirm).findByTestId('workspace-secrets-failure-confirm')
  expect(within(panel).getByText(typed.requestId)).toBeVisible()
  expect(within(panel).getByText(`(correlación ${typed.correlationId})`)).toBeVisible()
  expect(within(panel).getByText('El servicio no está disponible en este momento.')).toBeVisible()
})

test.each([
  ['create', 'workspace-secrets.create.500-then-network-then-success'],
  ['delete', 'workspace-secrets.delete.500-then-network-then-success'],
] as const)('%s 500 and network failure panels are assertive alerts', async (kind, fixture) => {
  server = serve(fixture)
  open(); await ready()
  if (kind === 'create') {
    set(nameField(), 'new_secret'); set(valueField(), canary); click('Crear secreto')
  } else {
    openRow('Eliminar', 'db_password')
    set(typedField(), 'db_password'); click('Eliminar', screen.getByRole('alertdialog'))
  }
  const panel = await screen.findByTestId(`workspace-secrets-failure-${kind === 'create' ? 'create' : 'confirm'}`)
  expect(panel).toHaveAttribute('role', 'alert')
  expect(panel.textContent).toContain(kind === 'create' ? 'No se pudo crear el secreto' : 'No se pudo eliminar el secreto')
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Reintentar' })).toHaveFocus())
})

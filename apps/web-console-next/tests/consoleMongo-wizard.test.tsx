import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { calls, changeLocale, open, press, ready, setup, settle, state, shellContext } from './consoleMongo-support'
import { contract, fixtures, idempotency, metrics, metricPaths, response, submitPath, urls } from './parity/pages/console-mongo-page.manifest'

let server: ReturnType<typeof setup>
beforeEach(async () => { await changeLocale('es') })
afterEach(() => { vi.useRealTimers(); server?.verify(); cleanup(); localStorage.clear() })
const KEY = /^[A-Za-z0-9._:-]{8,128}$/
const post = `POST ${submitPath}`
const posts = () => calls(server).filter(({ method }) => method === 'POST')
const keys = () => posts().map(({ headers }) => headers.get('Idempotency-Key'))
const sequence = (...names: string[]) => { let index = 0; return () => response(names[Math.min(index++, names.length - 1)]) }
// Toasts are dialogs too, so the wizard is found by its test id. The footer follows the header, so the last match is the footer button.
const dialog = () => screen.getByTestId('mongo-wizard')
const inside = (name: string | RegExp) => { const all = within(dialog()).getAllByRole('button', { name }); return all[all.length - 1] }
const maybe = (name: string | RegExp) => within(dialog()).queryByRole('button', { name })
const next = () => fireEvent.click(inside('Siguiente'))
async function wizard({ name = 'ventas', engine, items = [] as string[], stop = 'review' }: { name?: string; engine?: 'postgresql' | 'mongodb'; items?: string[]; stop?: 'review' | 'config' | 'engine' } = {}) {
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva base de datos' })); await screen.findByTestId('mongo-wizard'); next()
  fireEvent.change(within(dialog()).getByLabelText('Nombre'), { target: { value: name } })
  if (engine === 'postgresql') { fireEvent.click(within(dialog()).getByRole('combobox')); const option = await screen.findByRole('option', { name: 'PostgreSQL' }); fireEvent.pointerDown(option); fireEvent.click(option) }
  if (stop === 'engine') return
  next(); for (const item of items) fireEvent.click(within(dialog()).getByRole('checkbox', { name: item }))
  if (stop === 'config') return
  next(); await within(dialog()).findByRole('button', { name: 'Confirmar' })
}
const confirm = async () => { fireEvent.click(inside('Confirmar')); await settle() }
const retry = async () => { fireEvent.click(within(dialog()).getByRole('button', { name: 'Reintentar' })); await settle() }
const success = () => screen.queryByTestId('mongo-wizard-result')
const run = (routes: Record<string, unknown> = {}) => { server = setup({ ...routes }); open() }

test('a Mongo create sends one POST with the legacy body and one valid key; success links to /console/mongo', async () => {
  run({ [post]: sequence('create-success') }); await wizard({ items: ['users'] }); await confirm()
  expect(posts()).toHaveLength(1)
  expect(posts()[0].path).toBe(submitPath); expect(posts()[0].body).toEqual({ engine: 'mongodb', name: 'ventas', extensions: [], collections: ['users'] }); expect(Object.keys(posts()[0].body)).not.toContain('workspaceId')
  expect(keys()[0]).toMatch(KEY); expect(posts()[0].headers.get('X-Request-Id')).toBeTruthy()
  const result = await screen.findByTestId('mongo-wizard-result'); expect(within(result).getByText('Base de datos creada correctamente')).toBeVisible(); expect(within(result).getByRole('link', { name: 'Abrir bases de datos MongoDB' })).toHaveAttribute('href', '/console/mongo')
  expect(result).toHaveFocus(); expect(maybe('Confirmar')).toBeNull(); expect(inside('Cerrar')).toBeVisible()
})
test('selecting users then switching to PostgreSQL clears the selection and sends the PostgreSQL body; the credential never reaches the page', async () => {
  run({ [post]: () => response('create-postgres-credential') }); await wizard({ stop: 'config', items: ['users'] })
  fireEvent.click(inside('Anterior')); await wizard2()
  async function wizard2() {
    fireEvent.click(within(dialog()).getByRole('combobox')); const option = await screen.findByRole('option', { name: 'PostgreSQL' }); fireEvent.pointerDown(option); fireEvent.click(option)
    next(); expect(within(dialog()).getByRole('checkbox', { name: 'uuid-ossp' })).not.toBeChecked(); expect(within(dialog()).queryByRole('checkbox', { name: 'users' })).toBeNull()
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'pgcrypto' })); next()
  }
  await confirm(); expect(posts()[0].body).toEqual({ engine: 'postgresql', name: 'ventas', extensions: ['pgcrypto'], collections: [] })
  const result = await screen.findByTestId('mongo-wizard-result'); expect(within(result).getByRole('link')).toHaveAttribute('href', '/console/postgres'); expect(within(result).getByText('pg-created')).toBeVisible()
  const secret = idempotency['create-postgres-credential'].body as { connection: { password: string; host: string } }
  for (const value of [secret.connection.password, secret.connection.host, 'saga-1']) {
    expect(document.documentElement.outerHTML).not.toContain(value); expect(JSON.stringify({ ...localStorage })).not.toContain(value); expect(JSON.stringify({ ...sessionStorage })).not.toContain(value)
    expect(Array.from(document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).map((node) => node.textContent).join(' ')).not.toContain(value)
  }
})
test('Mongo is preselected and changing the engine clears the chosen items', async () => {
  run(); await wizard({ stop: 'engine' }); expect(within(dialog()).getByRole('combobox')).toHaveTextContent('MongoDB')
  next(); fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'orders' })); fireEvent.click(inside('Anterior'))
  fireEvent.click(within(dialog()).getByRole('combobox')); const option = await screen.findByRole('option', { name: 'PostgreSQL' }); fireEvent.pointerDown(option); fireEvent.click(option); next()
  expect(within(dialog()).getByRole('checkbox', { name: 'uuid-ossp' })).not.toBeChecked(); expect(within(dialog()).getByRole('checkbox', { name: 'pgcrypto' })).not.toBeChecked()
})
test('step validation: workspace, name and exhausted quota', async () => {
  server = setup({ ...metrics, [`GET ${metricPaths[2]}`]: fixtures.quotaExhausted }); open()
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva base de datos' })); await screen.findByTestId('mongo-wizard'); next()
  expect(inside('Siguiente')).toBeDisabled(); expect(within(dialog()).getByText('El nombre es obligatorio.')).toBeVisible()
  fireEvent.change(within(dialog()).getByLabelText('Nombre'), { target: { value: ' ' } }); expect(inside('Siguiente')).toBeDisabled()
  fireEvent.change(within(dialog()).getByLabelText('Nombre'), { target: { value: 'ventas' } })
  await waitFor(() => expect(within(dialog()).getByText('La cuota disponible para este recurso está agotada.')).toBeVisible()); expect(inside('Siguiente')).toBeDisabled()
  expect(calls(server).filter(({ path }) => path.startsWith('/v1/metrics')).map(({ path }) => path).sort()).toEqual([...metricPaths].sort())
})
test('step 0 without a workspace blocks Área de trabajo', async () => {
  server = setup({}, { activeWorkspaceId: null }); open(); fireEvent.click(await screen.findByRole('button', { name: 'Nueva base de datos' })); await screen.findByTestId('mongo-wizard')
  expect(within(dialog()).getByText('Selecciona un área de trabajo.')).toBeVisible(); expect(inside('Siguiente')).toBeDisabled()
})
test.each(['create-500', 'create-network'])('%s then success: two POSTs, identical body, the same key; success only after the second', async (first) => {
  const answers = first === 'create-network' ? [() => { throw new TypeError('raw-backend-message') }, () => response('create-success')] : [() => response('create-500'), () => response('create-success')]
  let index = 0; run({ [post]: () => answers[index++]() }); await wizard({ items: ['users'] }); await confirm()
  const panel = await screen.findByTestId('mongo-wizard-outcome'); expect(within(panel).getByText('No se pudo crear la base de datos')).toBeVisible(); expect(panel.textContent).not.toContain('raw-backend-message')
  if (first === 'create-500') { expect(panel).toHaveTextContent('req-mongo-500'); expect(panel).toHaveTextContent('502') } else expect(panel).toHaveTextContent(/wiz_/)
  expect(success()).toBeNull(); expect(document.querySelector('[role="status"][data-testid="mongo-wizard-result"]')).toBeNull(); expect(within(dialog()).getByText('ventas')).toBeVisible(); expect(inside('Confirmar')).toBeVisible(); expect(panel).toHaveFocus()
  await retry(); await screen.findByTestId('mongo-wizard-result')
  expect(posts()).toHaveLength(2); expect(posts()[1].body).toEqual(posts()[0].body); expect(keys()[0]).toMatch(KEY); expect(keys()[1]).toBe(keys()[0]); expect(screen.getByTestId('mongo-wizard-result')).toHaveFocus()
})
test('a lost response followed by a replayed 201 shows success exactly once', async () => {
  let index = 0; run({ [post]: () => [() => { throw new TypeError('lost') }, () => response('create-replayed')][index++]() }); await wizard({ items: ['orders'] }); await confirm(); await screen.findByTestId('mongo-wizard-outcome'); await retry()
  expect(await screen.findAllByTestId('mongo-wizard-result')).toHaveLength(1); expect(posts()).toHaveLength(2); expect(new Set(keys()).size).toBe(1)
})
test('create-500-500-then-success: after the failed Reintentar focus stays on Reintentar', async () => {
  run({ [post]: sequence('create-500', 'create-500', 'create-success') }); await wizard(); await confirm(); await screen.findByTestId('mongo-wizard-outcome'); await retry()
  await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'Reintentar' })).toHaveFocus()); expect(success()).toBeNull()
  await retry(); await screen.findByTestId('mongo-wizard-result'); expect(new Set(keys()).size).toBe(1); expect(posts()).toHaveLength(3)
})
test('an Anterior edit followed by Confirmar sends a new key and the edited body', async () => {
  run({ [post]: sequence('create-500', 'create-success') }); await wizard({ items: ['users'] }); await confirm(); await screen.findByTestId('mongo-wizard-outcome')
  fireEvent.click(inside('Anterior')); fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'orders' })); next(); await confirm(); await screen.findByTestId('mongo-wizard-result')
  expect(posts()).toHaveLength(2); expect(keys()[1]).not.toBe(keys()[0]); expect(keys()[1]).toMatch(KEY); expect(posts()[1].body).toEqual({ engine: 'mongodb', name: 'ventas', extensions: [], collections: ['users', 'orders'] })
})
test('503 IDEMPOTENCY_UNAVAILABLE shows the error panel and Reintentar reuses the key', async () => {
  run({ [post]: sequence('create-503', 'create-success') }); await wizard(); await confirm(); const panel = await screen.findByTestId('mongo-wizard-outcome'); expect(panel).toHaveTextContent('503'); await retry(); await screen.findByTestId('mongo-wizard-result'); expect(keys()[1]).toBe(keys()[0])
})
test('400 INVALID_IDEMPOTENCY_KEY shows the generic panel, no automatic retry, and the next submit uses a new key', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); run({ [post]: sequence('create-400-key', 'create-success') }); await wizard(); await confirm()
  const panel = await screen.findByTestId('mongo-wizard-outcome'); expect(panel).toHaveTextContent('No se pudo enviar la solicitud. Inténtalo de nuevo.'); expect(panel.textContent).not.toContain('raw-backend-message')
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) }); expect(posts()).toHaveLength(1)
  await retry(); await screen.findByTestId('mongo-wizard-result'); expect(keys()[1]).not.toBe(keys()[0]); expect(keys()[1]).toMatch(KEY)
})
test('409 IDEMPOTENCY_KEY_IN_PROGRESS retries after one second with the same key at most five times, then offers a manual Reintentar', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); run({ [post]: sequence('create-in-progress', 'create-in-progress', 'create-in-progress', 'create-in-progress', 'create-in-progress', 'create-in-progress', 'create-success') })
  await wizard(); await confirm(); const callout = await screen.findByTestId('mongo-wizard-outcome'); expect(callout).toHaveTextContent('Tu base de datos todavía se está creando. Volveremos a comprobarlo en un momento.')
  expect(within(dialog()).queryByRole('button', { name: 'Reintentar' })).toBeNull(); expect(inside('Confirmar')).toBeDisabled(); expect(posts()).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(900) }); expect(posts()).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(200) }); expect(posts()).toHaveLength(2)
  for (let attempt = 3; attempt <= 6; attempt++) { await act(async () => { await vi.advanceTimersByTimeAsync(1000) }); expect(posts()).toHaveLength(attempt) }
  await act(async () => { await vi.advanceTimersByTimeAsync(20000) }); expect(posts()).toHaveLength(6); expect(new Set(keys()).size).toBe(1); expect(success()).toBeNull()
  await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'Reintentar' })).toBeVisible()); await retry(); await screen.findByTestId('mongo-wizard-result'); expect(posts()).toHaveLength(7); expect(new Set(keys()).size).toBe(1)
})
test('closing the wizard cancels the pending in-progress retry', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); run({ [post]: sequence('create-in-progress') }); await wizard(); await confirm(); await screen.findByTestId('mongo-wizard-outcome')
  fireEvent.click(inside('Cerrar')); await act(async () => { await vi.advanceTimersByTimeAsync(10000) }); expect(posts()).toHaveLength(1)
})
test('409 IDEMPOTENCY_REPLAY_UNAVAILABLE is a callout, never a failure: list refreshed, engine link, only Cerrar, focus on the callout', async () => {
  run({ [post]: sequence('create-500', 'create-replay-unavailable') }); await wizard(); await confirm(); await screen.findByTestId('mongo-wizard-outcome'); await retry()
  await waitFor(() => expect(calls(server).filter(({ path }) => path === urls.databases())).toHaveLength(2))
  const callout = await screen.findByTestId('mongo-wizard-outcome'); expect(callout).toHaveTextContent('La base de datos se creó, pero sus datos de conexión de un solo uso no se pueden volver a mostrar.'); expect(within(callout).getByRole('link', { name: 'Ir a PostgreSQL para rotar la credencial' })).toHaveAttribute('href', '/console/postgres')
  expect(callout).toHaveFocus(); expect(success()).toBeNull(); expect(maybe('Confirmar')).toBeNull(); expect(maybe('Reintentar')).toBeNull(); expect(maybe('Anterior')).toBeNull(); expect(inside('Cerrar')).toBeVisible(); expect(screen.queryByText('No se pudo crear la base de datos')).toBeNull()
  expect(new Set(keys()).size).toBe(1)
})
test('422 IDEMPOTENCY_KEY_MISMATCH keeps the form and the next submit uses a new key', async () => {
  run({ [post]: sequence('create-mismatch', 'create-success') }); await wizard({ items: ['users'] }); await confirm()
  const callout = await screen.findByTestId('mongo-wizard-outcome'); expect(callout).toHaveTextContent('Esta configuración no coincide con la solicitud ya enviada. Revísala y vuelve a enviarla.'); expect(callout).toHaveFocus(); expect(within(dialog()).getByText('ventas')).toBeVisible(); expect(success()).toBeNull()
  await confirm(); await screen.findByTestId('mongo-wizard-result'); expect(keys()[1]).not.toBe(keys()[0]); expect(posts()[1].body).toEqual(posts()[0].body)
})
test('403 shows no-access with Confirmar disabled, the values visible and only Cerrar', async () => {
  run({ [post]: sequence('create-403') }); await wizard(); await confirm(); const panel = await screen.findByTestId('mongo-wizard-outcome')
  expect(within(panel).getByText('Sin acceso')).toBeVisible(); expect(panel.textContent).not.toContain('raw-backend-message'); expect(inside('Confirmar')).toBeDisabled(); expect(within(dialog()).getByText('ventas')).toBeVisible(); expect(maybe('Anterior')).toBeNull(); expect(maybe('Reintentar')).toBeNull(); expect(inside('Cerrar')).toBeVisible(); expect(panel).toHaveFocus(); expect(success()).toBeNull()
})
test('409 DB_ALREADY_PROVISIONED shows a localized callout without Reintentar and no success', async () => {
  run({ [post]: sequence('create-409') }); await wizard(); await confirm(); const callout = await screen.findByTestId('mongo-wizard-outcome')
  expect(callout).toHaveTextContent('El recurso ya existe o entra en conflicto con otro.'); expect(callout.textContent).not.toContain('raw-backend-message'); expect(maybe('Reintentar')).toBeNull(); expect(success()).toBeNull(); expect(document.querySelector('[data-testid="mongo-wizard-result"]')).toBeNull()
})
test('a 401 is refreshed once and the POST is replayed with its body and key; a rejected refresh sends no replay', async () => {
  let count = 0
  run({ [post]: () => ++count === 1 ? Response.json({}, { status: 401 }) : response('create-success'), 'POST /v1/auth/login-sessions/synthetic-session/refresh': async () => Response.json((await import('@in-falcone/console-api/fixtures')).buildConsoleRefreshSessionFixture()) })
  await wizard({ items: ['users'] }); await confirm(); await screen.findByTestId('mongo-wizard-result'); expect(posts().filter(({ path }) => path === submitPath)).toHaveLength(2)
  const [first, second] = posts().filter(({ path }) => path === submitPath); expect(second.body).toEqual(first.body); expect(second.headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'))
})
test('the Mongo 201 shows success only once even when the response repeats the replay header', async () => {
  run({ [post]: sequence('create-replayed') }); await wizard(); await confirm(); expect(await screen.findAllByTestId('mongo-wizard-result')).toHaveLength(1); expect(posts()).toHaveLength(1)
})
test('without provision permission the wizard renders no-access and sends no write', async () => {
  server = setup(); open(); await ready(); state.allowed = false; const before = calls(server).length
  fireEvent.click(screen.getByRole('button', { name: 'Nueva base de datos' })); expect(await screen.findByText('Acceso bloqueado')).toBeVisible(); expect(within(dialog()).getByText(/Tu rol actual|Tu sesión actual|Tu rol \(/)).toBeVisible()
  expect(within(dialog()).queryByRole('button', { name: 'Confirmar' })).toBeNull(); await waitFor(() => expect(calls(server).slice(before).map(({ path }) => path).sort()).toEqual([...metricPaths].sort())); expect(calls(server).slice(before).every(({ method }) => method === 'GET')).toBe(true)
})
test('closing the wizard discards values, error and key; a reopened wizard starts empty and signs a new key', async () => {
  run({ [post]: sequence('create-500', 'create-success') }); await wizard(); await confirm(); await screen.findByTestId('mongo-wizard-outcome')
  fireEvent.click(inside('Cerrar')); await waitFor(() => expect(screen.queryByTestId('mongo-wizard')).toBeNull())
  await wizard(); expect(within(dialog()).queryByTestId('mongo-wizard-outcome')).toBeNull(); await confirm(); await screen.findByTestId('mongo-wizard-result'); expect(keys()[1]).not.toBe(keys()[0])
  expect(JSON.stringify({ ...localStorage })).not.toContain('ventas'); expect(JSON.stringify({ ...sessionStorage })).not.toContain('ventas')
})
test('focus returns to Nueva base de datos when the wizard closes', async () => {
  run({ [post]: sequence('create-success') }); await wizard(); await confirm(); await screen.findByTestId('mongo-wizard-result'); fireEvent.click(inside('Cerrar'))
  await waitFor(() => expect(screen.queryByTestId('mongo-wizard')).toBeNull()); await waitFor(() => expect(screen.getByRole('button', { name: 'Nueva base de datos' })).toHaveFocus())
})
test('no failure path shows a success result or a toast', async () => {
  for (const name of ['create-500', 'create-503', 'create-400-key', 'create-replay-unavailable', 'create-mismatch', 'create-403', 'create-409']) {
    run({ [post]: sequence(name) }); await wizard(); await confirm(); await screen.findByTestId('mongo-wizard-outcome')
    expect(success()).toBeNull(); expect(document.body.textContent).not.toContain('creada correctamente'); expect(screen.queryByRole('region', { name: /Notificaciones/ })?.textContent ?? '').not.toContain('creada'); server.verify(); cleanup()
  }
})
test('the wizard works in English', async () => {
  await changeLocale('en'); run({ [post]: sequence('create-500', 'create-success') })
  fireEvent.click(await screen.findByRole('button', { name: 'New database' })); await screen.findByTestId('mongo-wizard'); fireEvent.click(within(dialog()).getByRole('button', { name: 'Next' }))
  fireEvent.change(within(dialog()).getByLabelText('Name'), { target: { value: 'sales' } }); fireEvent.click(within(dialog()).getByRole('button', { name: 'Next' })); fireEvent.click(within(dialog()).getByRole('button', { name: 'Next' }))
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Confirm' })); await settle(); expect(await screen.findByText('The database could not be created')).toBeVisible()
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Retry' })); expect((await screen.findAllByText('Database created successfully')).length).toBeGreaterThan(0)
})
test.each(Object.entries(idempotency))('fixture %s cites %s and matches its status, code and replay header', async (name, fixture) => {
  expect(fixture.contract).toBe(contract.id); expect(contract.sha256).toBe('abd13406767f14579bf13744da417c122f7117cb5be7f26961b07c097ad94c23')
  const table: Record<string, [number, string | undefined, string | null]> = {
    'create-success': [201, undefined, null], 'create-replayed': [201, undefined, 'true'], 'create-500': [502, 'MONGO_PROVISION_FAILED', null], 'create-503': [503, 'IDEMPOTENCY_UNAVAILABLE', null],
    'create-400-key': [400, 'INVALID_IDEMPOTENCY_KEY', null], 'create-in-progress': [409, 'IDEMPOTENCY_KEY_IN_PROGRESS', null], 'create-replay-unavailable': [409, 'IDEMPOTENCY_REPLAY_UNAVAILABLE', null],
    'create-mismatch': [422, 'IDEMPOTENCY_KEY_MISMATCH', null], 'create-403': [403, undefined, null], 'create-409': [409, 'DB_ALREADY_PROVISIONED', null], 'create-postgres-credential': [201, undefined, null],
  }
  const [status, code, replayed] = table[name]; const reply = response(name)
  expect(reply.status).toBe(status); expect(fixture.code).toBe(code); expect(reply.headers.get('X-Idempotency-Replayed')).toBe(replayed)
  if (name === 'create-in-progress') expect(reply.headers.get('Retry-After')).toBe('1')
})

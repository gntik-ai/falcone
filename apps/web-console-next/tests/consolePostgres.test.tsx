import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { previewDdl } from '../src/pages/consolePostgres/api'
import { generateSnippets } from '../../web-console/src/lib/snippets/snippet-generator'
import { postgresSnippets } from '../src/pages/consolePostgres/snippets'
import { click, element, open, ready, selectSchema, selectTable, setup, settle, state, tab } from './consolePostgres-support'
import { ddlPreviewFixture, fixtures, metricPaths, pageUrl, paths, tableFixture } from './parity/pages/console-postgres-page.manifest'
let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const calls = () => server.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const count = (path: string) => calls().filter((call) => call.path === path).length
const writes = () => calls().filter((call) => call.method !== 'GET')
const keys = Object.keys(paths) as (keyof typeof paths)[]
const tabs = { tables: 'Tablas', views: 'Vistas', matviews: 'Vistas materializadas', columns: 'Columnas', indexes: 'Índices', policies: 'Políticas', security: 'Seguridad' }
async function activate(kind: keyof typeof paths) {
  await ready()
  if (kind === 'databases') return
  click('app_db'); await screen.findByRole('button', { name: 'public' }).catch(() => {})
  if (kind === 'schemas') return
  click('public'); if (['tables', 'views', 'matviews'].includes(kind)) { tab(tabs[kind as keyof typeof tabs]); return }
  await screen.findByRole('button', { name: 'accounts' }); click('accounts'); tab(tabs[kind as keyof typeof tabs])
}
for (const locale of ['es', 'en'] as const) test(`inventory context and exact first read in ${locale}`, async () => {
  server = setup(); await changeLocale(locale); open(); await ready()
  expect(screen.getAllByText('postgres_owner')[0]).toBeVisible(); expect(screen.getAllByText('Schema Per Tenant')[0]).toBeVisible()
  expect(screen.getByText('Tenant Alpha')).toBeVisible(); expect(screen.getByText('Workspace Alpha')).toBeVisible()
  expect(calls()).toEqual([{ method: 'GET', path: pageUrl(paths.databases), body: undefined }])
  expect(screen.queryByRole('button', { name: locale === 'es' ? 'Siguiente' : 'Next' })).toBeNull()
})
test('legacy database, schema and table drilldown retains every detail value and query', async () => {
  server = setup(); open(); await selectTable()
  for (const value of ['id', 'uuid', 'NOT NULL', 'gen_random_uuid()']) expect(screen.getByText(value)).toBeVisible()
  tab('Índices'); expect(await screen.findByText('accounts_pkey')).toBeVisible(); expect(screen.getByText('btree')).toBeVisible(); expect(screen.getByText('Único')).toBeVisible(); expect(screen.getByText('email')).toBeVisible()
  tab('Políticas'); expect(screen.getByText('accounts_select_policy')).toBeVisible(); expect(screen.getByText('Permissive')).toBeVisible(); expect(screen.getByText('SELECT')).toBeVisible(); expect(screen.getByText('tenant_user')).toBeVisible()
  tab('Seguridad'); for (const value of ['RLS habilitado', 'Tenant Scoped', 'Review Required']) expect(screen.getByText(value)).toBeVisible()
  expect(calls().map(({ path }) => path)).toEqual(keys.map((kind) => kind === 'security' ? paths[kind] : pageUrl(paths[kind])))
  expect(count(paths.security)).toBe(1)
})
test('legacy views and materialized views retain query-related data', async () => {
  server = setup(); open(); await ready(); await selectSchema(); tab('Vistas')
  expect(screen.getByText('active_accounts')).toBeVisible(); expect(screen.getByText('id, email')).toBeVisible(); expect(screen.getByText('Sí')).toBeVisible()
  tab('Vistas materializadas'); expect(screen.getByText('accounts_snapshot')).toBeVisible(); expect(screen.getByText('daily refresh')).toBeVisible(); expect(screen.getByText('loaded')).toBeVisible()
})
for (const kind of keys.filter((key) => key !== 'security')) test(`${kind} cursor uses nextCursor and terminal previous re-requests the first page`, async () => {
  const first = fixtures[kind] as { items: object[]; page: object }
  server = setup({ [`GET ${pageUrl(paths[kind])}`]: { ...first, page: { nextCursor: 'opaque/cursor' } }, [`GET ${pageUrl(paths[kind], 'opaque/cursor')}`]: { items: [], page: {} } }); open(); await activate(kind)
  const section = document.getElementById(`pg-${paths[kind]}`)!; const scope = within(section)
  expect(await scope.findByRole('button', { name: 'Siguiente' })).toBeVisible(); expect(scope.queryByRole('button', { name: 'Anterior' })).toBeNull()
  fireEvent.click(scope.getByRole('button', { name: 'Siguiente' })); await scope.findByRole('button', { name: 'Anterior' }); expect(scope.queryByRole('button', { name: 'Siguiente' })).toBeNull()
  fireEvent.click(scope.getByRole('button', { name: 'Anterior' })); await scope.findByRole('button', { name: 'Siguiente' }); expect(count(pageUrl(paths[kind]))).toBe(2); expect(count(pageUrl(paths[kind], 'opaque/cursor'))).toBe(1)
})
for (const kind of keys) for (const failure of [403, 404, 500, 'network'] as const) test(`${kind} ${failure} is isolated and retry repeats only that section`, async () => {
  let failing = true; const url = kind === 'security' ? paths[kind] : pageUrl(paths[kind])
  server = setup({ [`GET ${url}`]: () => { if (!failing) return Response.json(fixtures[kind]); if (failure === 'network') throw new TypeError('raw-backend-message'); return Response.json({ message: 'raw-backend-message', requestId: 'pg-request' }, { status: failure, headers: { 'X-Request-Id': 'pg-request' } }) } }); open()
  // An ancestor error must not be swallowed by waiting for its child data.
  if (kind === 'databases') {} else if (kind === 'schemas') { await ready(); click('app_db') } else { await ready(); await selectSchema(); if (['tables', 'views', 'matviews'].includes(kind)) tab(tabs[kind as keyof typeof tabs]); else { click('accounts'); tab(tabs[kind as keyof typeof tabs]) } }
  const panel = await screen.findByTestId(`pg-failure-${kind}`); expect(panel.textContent).not.toContain('raw-backend-message')
  if (failure === 500 || failure === 'network') {
    if (failure === 500) expect(panel).toHaveTextContent('pg-request')
    const before = calls().length; failing = false; fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' })); await waitFor(() => expect(screen.queryByTestId(`pg-failure-${kind}`)).toBeNull())
    expect(calls().slice(before)).toEqual([{ method: 'GET', path: url, body: undefined }])
    await waitFor(() => expect(document.getElementById(`pg-${paths[kind]}`)).toHaveFocus())
  } else expect(within(panel).queryByRole('button', { name: 'Reintentar' })).toBeNull()
})
for (const kind of keys) test(`${kind} has an independent skeleton and empty state`, async () => {
  let release!: (value: Response) => void; const url = kind === 'security' ? paths[kind] : pageUrl(paths[kind])
  server = setup({ [`GET ${url}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open()
  if (kind === 'databases') {} else if (kind === 'schemas') { await ready(); click('app_db') } else { await ready(); await selectSchema(); if (['tables', 'views', 'matviews'].includes(kind)) tab(tabs[kind as keyof typeof tabs]); else { click('accounts'); tab(tabs[kind as keyof typeof tabs]) } }
  await waitFor(() => expect(release).toBeTypeOf('function')); expect(document.getElementById(`pg-${paths[kind]}`)).toHaveAttribute('aria-busy', 'true')
  await act(async () => release(Response.json(kind === 'security' ? null : { items: [], page: {} })))
  expect(document.getElementById(`pg-${paths[kind]}`)).toHaveAttribute('aria-busy', 'false')
})
for (const [kind, collection, name] of [['table', 'tables', 'accounts'], ['view', 'views', 'active_accounts'], ['matview', 'matviews', 'accounts_snapshot']] as const) test(`${kind} dry-run DDL sends identical payload and renders warnings, flags and SQL`, async () => {
  server = setup(); open(); await ready(); await selectSchema(); if (kind === 'table') { click('accounts'); await screen.findByText('gen_random_uuid()') } else tab(tabs[collection])
  click('Vista previa DDL'); const panel = await screen.findByTestId('pg-preview'); await within(panel).findByText('Exclusive lock possible')
  expect(within(panel).getByText('CREATE TABLE public.accounts (id uuid primary key);')).toBeVisible()
  const row = kind === 'view' ? fixtures.views.items[0] : kind === 'matview' ? fixtures.matviews.items[0] : undefined
  const payload = kind === 'table' ? { tableName: name } : kind === 'view' ? { viewName: name, query: row!.query, columns: row!.columns, securityBarrier: true } : { viewName: name, query: row!.query, columns: row!.columns, withData: true, refreshPolicy: 'daily refresh' }
  expect(writes()).toEqual([{ method: 'PUT', path: `${paths[collection]}/${name}`, body: { tenantId: 't-1', workspaceId: 'ws-1', databaseName: 'app_db', schemaName: 'public', ...payload, dryRun: true, executionMode: 'preview' } }])
  click('Cerrar'); expect(screen.queryByTestId('pg-preview')).toBeNull(); expect(screen.getByRole('button', { name: 'Vista previa DDL' })).toHaveFocus()
})
test('DDL prerequisite, missing queries and missing response fail safely', async () => {
  server = setup()
  await expect(previewDdl({ tenant: null, workspace: null, database: null, schema: null }, 'table', 'x')).rejects.toThrow('previewPrerequisite')
  for (const kind of ['view', 'matview'] as const) await expect(previewDdl({ tenant: 't-1', workspace: 'ws-1', database: 'app_db', schema: 'public' }, kind, 'x')).rejects.toThrow(kind === 'view' ? 'viewQueryMissing' : 'matviewQueryMissing')
  expect(calls()).toEqual([])
  server = setup({ [`PUT ${paths.tables}/accounts`]: {} }); open(); await selectTable(); click('Vista previa DDL'); expect(await screen.findByText('El servidor no devolvió ddlPreview para esta operación en modo preview.')).toBeVisible(); expect(writes()).toHaveLength(1)
})
test('no tenant sends no request and no selected database shows no snippets', async () => {
  server = setup(); state.context.activeTenantId = null; state.context.activeWorkspaceId = null; open()
  expect(screen.getAllByText('Selecciona una organización para explorar las bases de datos PostgreSQL.').length).toBeGreaterThan(0); expect(calls()).toEqual([]); expect(screen.queryByText('Fragmentos de conexión')).toBeNull()
})
for (const variant of ['loading', 'error', 'picker', 'create', 'denied']) test(`workspace required ${variant} preserves the database without a schemas GET`, async () => {
  server = setup(); state.context.activeWorkspaceId = null
  if (variant === 'loading') state.context.loading = true
  if (variant === 'error') state.context.error = { status: 500 }
  if (variant === 'create' || variant === 'denied') state.context.workspaces = []
  if (variant === 'denied') state.allowed = false
  open(); await ready(); click('app_db'); expect(count(pageUrl(paths.schemas))).toBe(0)
  if (variant === 'loading') expect(screen.getByRole('heading', { name: 'Cargando áreas de trabajo' })).toBeVisible()
  if (variant === 'error') { click('Reintentar'); expect(state.context.reloadWorkspaces).toHaveBeenCalledOnce() }
  if (variant === 'picker') expect(screen.getByRole('combobox', { name: 'Seleccionar área de trabajo' })).toBeVisible()
  if (variant === 'create') expect(screen.getByRole('link', { name: 'Crear área de trabajo' })).toHaveAttribute('href', '/console/workspaces')
  if (variant === 'denied') expect(screen.getByText(/Esta organización todavía no tiene áreas de trabajo/)).toBeVisible()
})
test('breadcrumbs keep focus, clear lower selections and send no request; tabs send nothing', async () => {
  server = setup(); open(); await selectTable(); await settle(); const before = calls().length
  tab('Índices'); tab('Políticas'); tab('Columnas'); expect(calls()).toHaveLength(before)
  const crumb = within(screen.getByRole('navigation', { name: 'Navegación PostgreSQL' })).getByRole('button', { name: 'app_db' }); crumb.focus(); fireEvent.click(crumb)
  expect(screen.getByText('app_db', { selector: '[aria-current=page]' })).toHaveFocus(); expect(screen.queryByText('accounts')).toBeNull(); expect(calls()).toHaveLength(before)
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Navegación PostgreSQL' })).getByRole('button', { name: 'Bases de datos' })); expect(screen.queryByText('public')).toBeNull(); expect(calls()).toHaveLength(before)
})
test('copy uses exact legacy snippet templates and announces feedback', async () => {
  const clipboard = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  server = setup(); open(); await ready(); click('app_db'); click('Copiar', within(screen.getAllByRole('article')[0]) as typeof screen)
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(postgresSnippets('app_db')[0].code)); expect(await screen.findAllByText('Fragmento copiado al portapapeles.').then((items) => items[0])).toBeVisible()
  const legacy = generateSnippets('postgres-database', { tenantId: 't-1', tenantSlug: null, workspaceId: 'ws-1', workspaceSlug: null, resourceName: 'app_db', resourceHost: null, resourcePort: 5432, resourceExtraA: 'public', resourceExtraB: null, resourceState: 'active', externalAccessEnabled: true })
  expect(postgresSnippets('app_db').map(({ code }) => code)).toEqual(legacy.map(({ code }) => code))
})
for (const engine of ['postgresql', 'mongodb'] as const) test(`wizard preserves untrimmed ${engine} name, configuration, success link and toast`, async () => {
  server = setup(); open(); await ready(); click('Nueva base de datos'); const dialog = within(screen.getByRole('dialog')); click('Siguiente', dialog as typeof screen)
  fireEvent.change(dialog.getByLabelText('Nombre'), { target: { value: ' ' } }); expect(dialog.getByText('El nombre es obligatorio.')).toBeVisible(); expect(writes()).toEqual([])
  fireEvent.change(dialog.getByLabelText('Nombre'), { target: { value: ' ventas ' } })
  if (engine === 'mongodb') { fireEvent.click(dialog.getByRole('combobox')); const option = await screen.findByRole('option', { name: 'MongoDB' }); fireEvent.pointerDown(option); fireEvent.click(option); await waitFor(() => expect(dialog.getByRole('combobox')).toHaveTextContent('MongoDB')) }
  click('Siguiente', dialog as typeof screen)
  const items = engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders']; for (const item of items) fireEvent.click(dialog.getByRole('checkbox', { name: item }))
  click('Siguiente', dialog as typeof screen); expect(dialog.getByText('ventas', { exact: false })).toHaveTextContent('ventas')
  expect(dialog.getByText('ventas', { exact: false }).textContent).toBe(' ventas ')
  click('Confirmar', dialog as typeof screen); await dialog.findByRole('link', { name: 'Abrir recurso' })
  expect(writes()).toEqual([{ method: 'POST', path: '/v1/workspaces/ws-1/databases', body: { engine, name: ' ventas ', extensions: engine === 'postgresql' ? items : [], collections: engine === 'mongodb' ? items : [] } }])
  expect(dialog.getByRole('link', { name: 'Abrir recurso' })).toHaveAttribute('href', engine === 'postgresql' ? '/console/postgres' : '/console/mongo')
  expect(calls().filter(({ path }) => path.includes('/metrics/')).map(({ path }) => path)).toEqual(metricPaths)
})
test('wizard denial still loads four metrics and renders no steps', async () => {
  server = setup(); state.allowed = false; open(); await ready(); click('Nueva base de datos'); expect(await screen.findByText('Acceso bloqueado')).toBeVisible(); await waitFor(() => expect(calls().filter(({ path }) => path.includes('/metrics/'))).toHaveLength(4)); expect(screen.queryByLabelText('Nombre')).toBeNull(); expect(writes()).toEqual([])
})
test('wizard quota exhaustion blocks the engine step while pending quota does not', async () => {
  let release!: (response: Response) => void
  server = setup({ 'GET /v1/metrics/workspaces/ws-1/quotas': () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await ready(); click('Nueva base de datos'); click('Siguiente'); fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'ventas' } }); expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled()
  await waitFor(() => expect(release).toBeTypeOf('function')); await act(async () => release(Response.json({ dimensions: [{ dimensionId: 'databases.count', hardLimit: 1, measuredValue: 1 }] })))
  expect(screen.getByText('La cuota disponible para este recurso está agotada.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled(); expect(writes()).toEqual([])
})
test('engine changes clear previously checked initial items', async () => {
  server = setup(); open(); await ready(); click('Nueva base de datos'); click('Siguiente'); fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'db' } }); click('Siguiente'); fireEvent.click(screen.getByRole('checkbox', { name: 'uuid-ossp' })); expect(screen.getByRole('checkbox', { name: 'uuid-ossp' })).toHaveAttribute('aria-checked', 'true'); click('Anterior')
  fireEvent.click(screen.getByRole('combobox')); const option = await screen.findByRole('option', { name: 'MongoDB' }); fireEvent.pointerDown(option); fireEvent.click(option); click('Siguiente'); expect(screen.getByRole('checkbox', { name: 'users' })).toHaveAttribute('aria-checked', 'false'); click('Anterior')
  fireEvent.click(screen.getByRole('combobox')); const postgres = await screen.findByRole('option', { name: 'PostgreSQL' }); fireEvent.pointerDown(postgres); fireEvent.click(postgres); click('Siguiente'); expect(screen.getByRole('checkbox', { name: 'uuid-ossp' })).toHaveAttribute('aria-checked', 'false')
})
test('RLS disabled uses its distinct empty policy copy', async () => {
  server = setup({ [`GET ${pageUrl(paths.policies)}`]: { items: [], page: {} }, [`GET ${paths.security}`]: { rlsEnabled: false, forceRls: false } }); open(); await selectTable(); tab('Políticas'); expect(await screen.findByText('RLS deshabilitado — no hay políticas.')).toBeVisible()
})
test('tenant and workspace changes discard detail and reload only the correct inventory', async () => {
  server = setup(); const view = open(); await selectTable(); state.context.activeWorkspaceId = 'ws-2'; view.rerender(element()); await settle()
  expect(screen.queryByRole('heading', { name: 'Tabla accounts' })).toBeNull(); expect(count(pageUrl(paths.schemas))).toBe(2); expect(count(pageUrl(paths.databases))).toBe(1)
  state.context.activeTenantId = 't-2'; view.rerender(element()); await ready(); expect(count(pageUrl(paths.databases))).toBe(2); expect(screen.queryByText('Fragmentos de conexión')).toBeNull()
})
test('late schemas cannot restore data after a breadcrumb clears the database', async () => {
  let release!: (response: Response) => void
  server = setup({ [`GET ${pageUrl(paths.schemas)}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await ready(); click('app_db'); await waitFor(() => expect(release).toBeTypeOf('function'))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Navegación PostgreSQL' })).getByRole('button', { name: 'Bases de datos' })); await act(async () => release(Response.json(fixtures.schemas))); expect(screen.queryByText('public')).toBeNull()
})
for (const kind of ['views', 'matviews'] as const) test(`${kind} missing query renders the legacy inline validation without a PUT`, async () => {
  const fixture = structuredClone(fixtures[kind]); delete (fixture.items[0] as { query?: string }).query
  server = setup({ [`GET ${pageUrl(paths[kind])}`]: fixture }); open(); await ready(); await selectSchema(); tab(tabs[kind]); click('Vista previa DDL'); const preview = await screen.findByTestId('pg-preview'); expect(await within(preview).findByText(/La API no devolvió el `query`/)).toBeVisible(); expect(writes()).toEqual([])
})
test('DDL preview has a loading status and a local server retry', async () => {
  let release!: (response: Response) => void, attempts = 0
  server = setup({ [`PUT ${paths.tables}/accounts`]: () => ++attempts === 1 ? new Promise<Response>((resolve) => { release = resolve }) : Response.json(ddlPreviewFixture()) }); open(); await selectTable(); click('Vista previa DDL'); expect(screen.getAllByText('Generando vista previa DDL…').length).toBeGreaterThan(0); await waitFor(() => expect(release).toBeTypeOf('function')); await act(async () => release(Response.json({ requestId: 'preview-request' }, { status: 500 }))); const before = calls().length; click('Reintentar', within(await screen.findByTestId('pg-preview')) as typeof screen); expect(await screen.findByText('Exclusive lock possible')).toBeVisible(); expect(calls().slice(before).map(({ method }) => method)).toEqual(['PUT'])
})
test('wizard without a workspace cannot advance and closes back to its trigger', async () => {
  server = setup(); state.context.activeWorkspaceId = null; open(); await ready(); click('Nueva base de datos'); expect(screen.getByText('Selecciona un área de trabajo.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled(); click('Cancelar'); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); await waitFor(() => expect(screen.getByRole('button', { name: 'Nueva base de datos' })).toHaveFocus()); expect(writes()).toEqual([])
})

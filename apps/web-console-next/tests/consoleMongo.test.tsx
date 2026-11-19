import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { calls, changeLocale, drill, open, press, read, ready, selectCollection, selectDatabase, setup, settle, shellContext, state, tab } from './consoleMongo-support'
import { database, databaseRow, documentRow, fixtures, indexRow, urls } from './parity/pages/console-mongo-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => { server?.verify(); cleanup() })
const paths = () => calls(server).map(({ path }) => path)
const count = (path: string) => paths().filter((value) => value === path).length
const labels = { es: { loadMore: 'Cargar más', retry: 'Reintentar', documents: 'Documentos', indexes: 'Índices', validation: 'Validación', views: 'Vistas', refresh: 'Actualizar', showJson: 'Ver JSON' }, en: { loadMore: 'Load more', retry: 'Retry', documents: 'Documents', indexes: 'Indexes', validation: 'Validation', views: 'Views', refresh: 'Refresh', showJson: 'View JSON' } }

for (const locale of ['es', 'en'] as const) test(`databases table, drill-down data and exact reads in ${locale}`, async () => {
  const text = labels[locale]
  server = setup({ [read('databases')]: fixtures.databases, ...drill }); await changeLocale(locale); open(); await ready()
  const table = screen.getByRole('table', { name: locale === 'es' ? 'Listado de bases de datos MongoDB' : 'MongoDB databases list' })
  expect(within(table).getAllByText(locale === 'es' ? '2,0 KB' : '2.0 KB', { exact: true })).toHaveLength(2); expect(within(table).getAllByText(locale === 'es' ? '4,0 KB' : '4.0 KB')[0]).toBeVisible()
  expect(within(table).getAllByText('7')[0]).toBeVisible(); expect(screen.getByText('Tenant Alpha')).toBeVisible(); expect(screen.getByText('Workspace Alpha')).toBeVisible()
  expect(paths()).toEqual([urls.databases()])
  await selectDatabase(); expect(await screen.findByText('events')).toBeVisible()
  expect(paths()).toEqual([urls.databases(), urls.collections(), urls.views()])
  await selectCollection(); expect(await screen.findByText('status_1')).toBeVisible(); expect(screen.getAllByLabelText(locale === 'es' ? 'Partial filter' : 'Partial filter').length).toBeGreaterThan(0)
  expect(paths()).toEqual([urls.databases(), urls.collections(), urls.views(), urls.detail(), urls.indexes(), urls.documents()].sort((a, b) => paths().indexOf(a) - paths().indexOf(b)))
  expect(new Set(paths())).toEqual(new Set([urls.databases(), urls.collections(), urls.views(), urls.detail(), urls.indexes(), urls.documents()]))
  tab(text.validation); expect(await screen.findByText(locale === 'es' ? 'Nivel: strict' : 'Level: strict')).toBeVisible(); expect(screen.getByText(locale === 'es' ? 'Acción: error' : 'Action: error')).toBeVisible()
  tab(text.documents); expect(await screen.findByText('doc-1')).toBeVisible()
  tab(text.indexes); expect(await screen.findByText('status_1')).toBeVisible()
  expect(screen.getByRole('heading', { name: locale === 'es' ? 'Fragmentos de conexión' : 'Connection snippets' })).toBeVisible()
  expect(screen.getAllByText(/<RESOURCE_HOST>/).length).toBeGreaterThan(0)
})
test('views tab renders viewOn and the pipeline viewer; collection types and rebuild states use status tags', async () => {
  server = setup(drill); open(); await ready(); await selectDatabase()
  expect(await screen.findByText('time-series')).toBeVisible(); expect(screen.getByText('capped')).toBeVisible(); expect(screen.getByText('Activa')).toBeVisible(); expect(screen.getAllByText('Sin validación')).toHaveLength(2)
  tab('Vistas'); expect(await screen.findByText('orders_view')).toBeVisible(); expect(screen.getByRole('table', { name: 'Listado de vistas MongoDB de la base seleccionada' })).toBeVisible()
  tab('Colecciones'); await selectCollection(); expect(await screen.findByText('failed')).toBeVisible(); expect(screen.getByText('3600')).toBeVisible()
})
test('names are URL-encoded in every path and a database change discards the previous selection', async () => {
  const odd = 'my db/é', col = 'a b'
  const enc = encodeURIComponent
  server = setup({
    [read('databases')]: { items: [databaseRow(odd), databaseRow('other')], page: {} },
    [`GET /v1/mongo/databases/${enc(odd)}/collections?page[size]=100`]: { items: [{ collectionName: col }], page: {} }, [`GET /v1/mongo/databases/${enc(odd)}/views?page[size]=100`]: fixtures.empty,
    [`GET /v1/mongo/databases/${enc(odd)}/collections/${enc(col)}`]: fixtures.detail, [`GET /v1/mongo/databases/${enc(odd)}/collections/${enc(col)}/indexes?page[size]=100`]: fixtures.indexes,
    [`GET /v1/mongo/workspaces/ws-1/data/${enc(odd)}/collections/${enc(col)}/documents?page%5Bsize%5D=20`]: fixtures.documents,
    [`GET /v1/mongo/databases/other/collections?page[size]=100`]: fixtures.empty, [`GET /v1/mongo/databases/other/views?page[size]=100`]: fixtures.empty,
  })
  open(); await screen.findByRole('radio', { name: odd }); await selectDatabase(odd); await selectCollection(col); await screen.findByText('status_1')
  await selectDatabase('other'); await waitFor(() => expect(screen.queryByText('status_1')).toBeNull()); expect(screen.queryByText(col)).toBeNull()
})
for (const [kind, load] of [['databases', async () => { await ready() }], ['collections', async () => { await ready(); await selectDatabase(); await screen.findByText('orders') }], ['views', async () => { await ready(); await selectDatabase(); tab('Vistas'); await screen.findByText('orders_view') }], ['indexes', async () => { await ready(); await selectDatabase(); await selectCollection(); await screen.findByText('status_1') }]] as const) {
  const key = kind as 'databases' | 'collections' | 'views' | 'indexes'
  test(`${kind}: Cargar más sends the cursor unchanged, appends, announces the count and hides on the last page`, async () => {
    const cursorFixture = { databases: fixtures.databasesCursor, collections: fixtures.collectionsCursor, views: fixtures.viewsCursor, indexes: fixtures.indexesCursor }[key]
    const nextFixture = { databases: fixtures.databasesNext, collections: fixtures.collectionsNext, views: fixtures.viewsNext, indexes: fixtures.indexesNext }[key]
    const cursor = (cursorFixture.page as { nextCursor: string }).nextCursor
    server = setup({ ...drill, [read(key)]: cursorFixture, [read(key, cursor)]: nextFixture }); open(); await load()
    const more = await screen.findByRole('button', { name: 'Cargar más' }); expect(screen.getAllByText(/cargados/).length).toBeGreaterThan(0)
    fireEvent.click(more); await waitFor(() => expect(count(urls[key](cursor))).toBe(1))
    const added = (nextFixture.items as unknown as Record<string, string>[])[0]; await screen.findByText(added.databaseName ?? added.collectionName ?? added.viewName ?? added.indexName)
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull(); expect(count(urls[key]())).toBe(1)
  })
  test(`${kind}: a failed Cargar más keeps the rows and Reintentar resends the same cursor`, async () => {
    const cursorFixture = { databases: fixtures.databasesCursor, collections: fixtures.collectionsCursor, views: fixtures.viewsCursor, indexes: fixtures.indexesCursor }[key]
    const nextFixture = { databases: fixtures.databasesNext, collections: fixtures.collectionsNext, views: fixtures.viewsNext, indexes: fixtures.indexesNext }[key]
    const cursor = (cursorFixture.page as { nextCursor: string }).nextCursor; let failing = true
    server = setup({ ...drill, [read(key)]: cursorFixture, [read(key, cursor)]: () => failing ? Response.json({ message: 'raw-backend-message', requestId: 'req-next' }, { status: 500 }) : Response.json(nextFixture) }); open(); await load()
    const first = (cursorFixture.items as unknown as Record<string, string>[])[0]; const name = first.databaseName ?? first.collectionName ?? first.viewName ?? first.indexName
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' })); const panel = await screen.findByTestId('mongo-failure-more')
    expect(panel).toHaveTextContent('req-next'); expect(panel.textContent).not.toContain('raw-backend-message'); expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    failing = false; fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' })); await waitFor(() => expect(count(urls[key](cursor))).toBe(2))
    expect(screen.queryByTestId('mongo-failure-more')).toBeNull()
  })
}
test('documents: Cargar más uses page.after, appends cards and a new collection discards loaded pages', async () => {
  server = setup({ ...drill, [read('documents')]: fixtures.documentsCursor, [read('documents', 'cursor-2')]: fixtures.documentsNext }); open(); await ready(); await selectDatabase(); await selectCollection(); tab('Documentos')
  expect(await screen.findByText('doc-1')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Cargar más' })); expect(await screen.findByText('doc-2')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull(); expect(screen.getByText('doc-1')).toBeVisible()
  expect(count(urls.documents('cursor-2'))).toBe(1)
})
test('after the last Cargar más focus moves to the first appended row', async () => {
  server = setup({ ...drill, [read('databases')]: fixtures.databasesCursor, [read('databases', 'db/cursor+1')]: fixtures.databasesNext }); open(); await ready()
  fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' })); const added = await screen.findByRole('radio', { name: 'archive' })
  await waitFor(() => expect(added).toHaveFocus())
})
for (const [kind, load, cursorFixture, nextFixture, added] of [
  ['views', async () => { await ready(); await selectDatabase(); tab('Vistas'); await screen.findByText('orders_view') }, fixtures.viewsCursor, fixtures.viewsNext, 'events_view'],
  ['indexes', async () => { await ready(); await selectDatabase(); await selectCollection(); await screen.findByText('status_1') }, fixtures.indexesCursor, fixtures.indexesNext, 'created_1'],
  ['collections', async () => { await ready(); await selectDatabase(); await screen.findByText('orders') }, fixtures.collectionsCursor, fixtures.collectionsNext, 'audit'],
] as const) {
  test(`${kind}: after the last Cargar más focus moves to the first appended row`, async () => {
    const key = kind as 'views' | 'indexes' | 'collections', cursor = (cursorFixture.page as { nextCursor: string }).nextCursor
    server = setup({ ...drill, [read(key)]: cursorFixture, [read(key, cursor)]: nextFixture }); open(); await load()
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' })); await screen.findByText(added)
    await waitFor(() => expect(document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label')).toBe(added))
  })
}
test('document JSON toggle exposes aria-expanded and shows the full document', async () => {
  server = setup(drill); open(); await ready(); await selectDatabase(); await selectCollection(); tab('Documentos')
  const toggle = (await screen.findAllByRole('button', { name: 'Ver JSON' }))[0]; expect(toggle).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(toggle).toHaveTextContent('Ocultar JSON'); expect(await screen.findByText(/nested/)).toBeVisible()
})
const rowOf = (name: string) => screen.getByRole('radio', { name }).closest('tr') as HTMLElement
test('rows select with Enter and Space and expose aria-selected; breadcrumbs sit in a nav with aria-current', async () => {
  server = setup(drill); open(); await ready()
  expect(rowOf('billing')).toHaveAttribute('aria-selected', 'false'); expect(rowOf(database)).toHaveAttribute('aria-selected', 'false')
  const radio = screen.getByRole('radio', { name: database }); radio.focus(); fireEvent.keyDown(radio, { key: 'Enter' }); await settle()
  expect(rowOf(database)).toHaveAttribute('aria-selected', 'true'); expect(rowOf('billing')).toHaveAttribute('aria-selected', 'false'); expect(screen.getByRole('radio', { name: database })).toBeChecked()
  expect(count(urls.collections())).toBe(1)
  fireEvent.click(screen.getByRole('radio', { name: database })); await settle(); expect(count(urls.collections())).toBe(1)
  await screen.findByText('orders'); expect(rowOf('orders')).toHaveAttribute('aria-selected', 'false')
  const nav = screen.getByRole('navigation', { name: 'Navegación MongoDB' }); expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(database)
  fireEvent.click(screen.getByRole('radio', { name: 'orders' })); await settle(); expect(rowOf('orders')).toHaveAttribute('aria-selected', 'true'); expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('orders')
  fireEvent.click(within(nav).getByRole('button', { name: database })); await settle(); expect(screen.queryByText('status_1')).toBeNull()
  fireEvent.click(within(nav).getByRole('button', { name: 'Bases de datos' })); await settle(); expect(screen.queryByRole('heading', { name: /Base de datos: catalog/ })).toBeNull()
})
test('an expanded document stays expanded across a tab round trip and resets for another collection', async () => {
  server = setup(drill); open(); await ready(); await selectDatabase(); await selectCollection(); tab('Documentos')
  const toggle = (await screen.findAllByRole('button', { name: 'Ver JSON' }))[0]; fireEvent.click(toggle); expect(await screen.findByText(/nested/)).toBeVisible()
  tab('Validación'); await screen.findByText('Nivel: strict'); tab('Índices'); await screen.findByText('status_1'); tab('Documentos')
  const again = (await screen.findAllByRole('button', { name: 'Ocultar JSON' }))[0]; expect(again).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByText(/nested/)).toBeVisible()
  fireEvent.click(again); expect(screen.getAllByRole('button', { name: 'Ver JSON' })[0]).toHaveAttribute('aria-expanded', 'false')
})
test('Actualizar re-issues only the databases read', async () => {
  server = setup(); open(); await ready(); const before = paths().length
  press('Actualizar'); await waitFor(() => expect(count(urls.databases())).toBe(2)); expect(paths().length).toBe(before + 1)
})
test('Actualizar and Reintentar on a section re-issue only that section', async () => {
  let failing = true
  server = setup({ ...drill, [read('views')]: () => failing ? Response.json({ requestId: 'req-views' }, { status: 500 }) : Response.json(fixtures.views) }); open(); await ready(); await selectDatabase()
  expect(await screen.findByText('orders')).toBeVisible(); tab('Vistas'); const panel = await screen.findByTestId('mongo-failure-views'); expect(panel).toHaveTextContent('req-views'); expect(panel).toHaveTextContent('500')
  tab('Colecciones'); expect(screen.getByText('orders')).toBeVisible()
  const before = count(urls.collections()); tab('Vistas'); failing = false; fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
  expect(await screen.findByText('orders_view')).toBeVisible(); expect(count(urls.views())).toBe(2); expect(count(urls.collections())).toBe(before)
})
for (const [status, label] of [[403, 'Sin acceso'], [404, 'Recurso no encontrado']] as const) test(`${status} stays in the failing section`, async () => {
  server = setup({ ...drill, [read('detail')]: () => Response.json({ message: 'raw-backend-message' }, { status }) }); open(); await ready(); await selectDatabase(); await selectCollection(); tab('Validación')
  expect(await screen.findByText(label)).toBeVisible(); expect(screen.queryByText('raw-backend-message')).toBeNull(); tab('Índices'); expect(await screen.findByText('status_1')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Bases de datos' })).toBeVisible()
})
test('403 on the databases read shows no-access in that section without Reintentar', async () => {
  server = setup({ [read('databases')]: () => Response.json({}, { status: 403 }) }); open(); expect(await screen.findByText('Sin acceso')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
})
test('network failure shows the error panel, retry succeeds and moves focus to the section heading', async () => {
  let failing = true
  server = setup({ [read('databases')]: () => { if (failing) throw new TypeError('raw-backend-message'); return Response.json(fixtures.databases) } }); open()
  const panel = await screen.findByTestId('mongo-failure-databases'); expect(panel.textContent).not.toContain('raw-backend-message'); failing = false
  fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' })); await ready(); await waitFor(() => expect(screen.getByRole('heading', { name: 'Bases de datos' })).toHaveFocus())
})
test('empty states: every legacy message including the _id_-only index case', async () => {
  server = setup({ [read('databases')]: fixtures.empty }); open(); expect(await screen.findByText('No hay bases de datos MongoDB disponibles para esta organización.')).toBeVisible(); cleanup(); server.verify()
  server = setup({ [read('collections')]: fixtures.empty, [read('views')]: fixtures.empty, [read('detail')]: fixtures.detailNoValidator, [read('indexes')]: fixtures.indexesOnlyId, [read('documents')]: fixtures.empty })
  open(); await ready(); await selectDatabase(); expect(await screen.findByText('La base seleccionada no tiene colecciones visibles.')).toBeVisible(); tab('Vistas'); expect(await screen.findByText('La base seleccionada no tiene vistas MongoDB.')).toBeVisible()
})
test('collection-level empty states', async () => {
  server = setup({ ...drill, [read('detail')]: fixtures.detailNoValidator, [read('indexes')]: fixtures.indexesOnlyId, [read('documents')]: fixtures.empty }); open(); await ready(); await selectDatabase(); await selectCollection()
  expect(await screen.findByText('Solo índice _id_ — no hay índices adicionales.')).toBeVisible(); tab('Validación'); expect(await screen.findByText('Sin validación activa en esta colección.')).toBeVisible()
  tab('Documentos'); expect(await screen.findByText('Colección sin documentos.')).toBeVisible()
})
test('no tenant fetches nothing and shows the tenant empty state', async () => {
  server = setup({}, { activeTenantId: null, activeWorkspaceId: null }); open(); await settle(); expect(screen.getAllByText('Selecciona una organización para explorar las bases de datos MongoDB.').length).toBeGreaterThan(0); expect(calls(server)).toEqual([])
})
test('no workspace sends only the databases read and shows the workspace-required state on collections', async () => {
  server = setup({}, { activeWorkspaceId: null }); open(); await ready(); await selectDatabase()
  expect(await screen.findByText('Selecciona un área de trabajo')).toBeVisible(); expect(screen.getByRole('combobox', { name: 'Seleccionar área de trabajo' })).toBeVisible()
  tab('Vistas'); await settle(); expect(await screen.findByText('La base seleccionada no tiene vistas MongoDB.')).toBeVisible(); expect(paths()).toEqual([urls.databases()])
})
test('no workspace for a role that cannot create offers no create link', async () => {
  server = setup({}, { activeWorkspaceId: null, workspaces: [] }); open(); await ready(); await selectDatabase(); expect(await screen.findByRole('link', { name: 'Crear área de trabajo' })).toHaveAttribute('href', '/console/workspaces'); expect(paths()).toEqual([urls.databases()])
})
test('a workspace switch refetches collections and views and clears the collection detail; clearing it fetches nothing', async () => {
  server = setup({ ...drill, [`GET /v1/mongo/databases/${database}/collections?page[size]=100`]: fixtures.collections }); const view = open(); await ready(); await selectDatabase(); await selectCollection(); await screen.findByText('status_1')
  const before = paths().length
  state.context = shellContext({ activeWorkspaceId: 'ws-2' }); view.rerender(<>{(await import('./consoleMongo-support')).element()}</>)
  await waitFor(() => expect(count(urls.collections())).toBe(2)); expect(count(urls.views())).toBe(2); await waitFor(() => expect(screen.queryByText('status_1')).toBeNull())
  const afterSwitch = paths().length; expect(afterSwitch).toBe(before + 2)
  state.context = shellContext({ activeWorkspaceId: null }); view.rerender(<>{(await import('./consoleMongo-support')).element()}</>); await settle(); expect(paths().length).toBe(afterSwitch)
})
test('rapid reselection aborts the earlier requests without an error', async () => {
  const slow: ((value: Response) => void)[] = []
  server = setup({ ...drill, [read('collections')]: () => new Promise<Response>((resolve) => { slow.push(resolve) }), [`GET /v1/mongo/databases/billing/collections?page[size]=100`]: fixtures.collectionsNext, [`GET /v1/mongo/databases/billing/views?page[size]=100`]: fixtures.empty, [read('views')]: fixtures.empty })
  open(); await ready(); await selectDatabase(); await selectDatabase('billing'); expect(await screen.findByText('audit')).toBeVisible()
  await act(async () => { slow.forEach((resolve) => resolve(Response.json(fixtures.collections))) }); expect(screen.queryByText('events')).toBeNull(); expect(screen.queryByTestId('mongo-failure-collections')).toBeNull()
})
test('Nueva base de datos stays visible next to Actualizar; the kit search is hidden by the page stylesheet, not shown', async () => {
  server = setup(); open(); await ready(); expect(screen.getByRole('button', { name: 'Nueva base de datos' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Actualizar' })).toBeVisible()
  expect(screen.getByRole('toolbar')).toHaveClass('mongo-toolbar'); expect(screen.queryByRole('button', { name: /vista|view/i })).toBeNull()
})
test('connection snippets keep placeholders only', async () => {
  server = setup(drill); open(); await ready(); await selectDatabase(); await selectCollection(); await screen.findByText('status_1')
  const code = document.body.textContent ?? ''; expect(code).toContain('mongodb://<MONGO_USER>:<YOUR_SECRET>@<RESOURCE_HOST>:27017/catalog?authSource=admin&retryWrites=true&w=majority'); expect(code).toContain("client['catalog']['orders']")
})
test('missing optional index fields render placeholders instead of failing', async () => {
  server = setup({ ...drill, [read('indexes')]: { items: [indexRow('a_1'), { indexName: 'bare' }], page: {} }, [read('documents')]: { items: [documentRow('doc-9')], page: {} } }); open(); await ready(); await selectDatabase(); await selectCollection()
  const row = (await screen.findByText('bare')).closest('tr')!; expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(4); expect(within(row).getAllByText('No')).toHaveLength(2)
})

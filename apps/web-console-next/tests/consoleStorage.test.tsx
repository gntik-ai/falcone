import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { reconcileCreate } from '../src/pages/consoleStorage/api'
import { generateSnippets } from '../../web-console/src/lib/snippets/snippet-generator'
import { storageSnippets } from '../src/pages/consoleStorage/snippets'
import { click, create, element, fail, open, ready, remove, selectBucket, selectObject, set, setContext, setup, upload } from './consoleStorage-support'
import { bucket, bucketsPath, createPath, deletePath, exportPath, metadataPath, mockBuckets, mockUsage, objectsPath, presignPath, uploadPath, usagePath } from './parity/pages/console-storage-page.manifest'
let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const calls = () => server.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const count = (path: string) => calls().filter((call) => call.path === path).length
const writes = () => calls().filter((call) => call.method !== 'GET')
const failure = (section: string) => screen.findByTestId(`storage-failure-${section}`)
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
for (const [locale, title] of [['es', 'Almacenamiento / objetos'], ['en', 'Storage / objects']] as const) test(`scoped inventory and usage without role gating in ${locale}`, async () => {
  server = setup(); await changeLocale(locale); open(); await ready()
  expect(screen.getByRole('heading', { name: title })).toBeVisible(); expect(screen.queryByText('other-workspace')).toBeNull()
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '50'); expect(calls().map(({ path }) => path).sort()).toEqual([bucketsPath, usagePath].sort())
})
test('objects append with exact cursor, complete metadata and presign body', async () => {
  server = setup(); open(); await selectObject(); click('Página siguiente'); await screen.findByRole('button', { name: 'media/manual.pdf' })
  expect(screen.getByRole('button', { name: 'media/hero.png' })).toBeVisible(); expect(screen.getByText('design')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'URLs prefirmadas' })); click('Generar URL de descarga prefirmada'); await screen.findByTestId('storage-presigned-result')
  expect(calls().find(({ path }) => path === presignPath)).toMatchObject({ method: 'POST', body: { operation: 'download', ttlSeconds: 300 } })
  expect(calls().some(({ path }) => path.endsWith('page%5Bafter%5D=cursor-next'))).toBe(true)
})
test('create trims a name or sends an empty body and refreshes buckets and usage', async () => {
  server = setup(); open(); await ready(); create('  Mi Bucket  '); await waitFor(() => expect(count(usagePath)).toBe(2))
  expect(writes()[0]).toEqual({ method: 'POST', path: createPath, body: { name: 'Mi Bucket' } })
  click('Nuevo bucket'); click('Crear'); await waitFor(() => expect(count(usagePath)).toBe(3)); expect(count(bucketsPath)).toBe(3); expect(writes()[1].body).toEqual({})
})
test('upload sends exact base64 with default key and content type', async () => {
  server = setup(); open(); await selectBucket(); upload(); await waitFor(() => expect(count(objectsPath)).toBe(2))
  expect(writes()).toEqual([{ method: 'PUT', path: uploadPath, body: { content: 'aGVsbG8=', contentType: 'application/octet-stream', encoding: 'base64' } }])
})
test('delete requires exact typed name and cancel sends nothing', async () => {
  server = setup(); open(); await selectBucket(); click('Eliminar media-assets'); const dialog = screen.getByRole('alertdialog')
  expect(within(dialog).getByRole('button', { name: 'Eliminar' })).toBeDisabled(); set('Escribe exactamente el nombre del bucket para confirmar.', 'media-assets ')
  expect(within(dialog).getByRole('button', { name: 'Eliminar' })).toBeDisabled(); expect(writes()).toEqual([])
  click('Cancelar', dialog); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar media-assets' })).toHaveFocus())
  remove(); await waitFor(() => expect(count(usagePath)).toBe(2)); expect(count(bucketsPath)).toBe(2)
  expect(writes()).toEqual([{ method: 'DELETE', path: deletePath, body: undefined }]); expect(screen.queryByRole('button', { name: 'media/hero.png' })).toBeNull()
})
test('export downloads only successful manifests and supports repeated activation', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:synthetic'); URL.revokeObjectURL = vi.fn()
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  server = setup(); open(); await ready(); click('Exportar media-assets'); await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
  expect(download.mock.instances[0]).toHaveAttribute('download', 'manifest-synthetic.json'); click('Exportar media-assets'); await waitFor(() => expect(download).toHaveBeenCalledTimes(2)); expect(writes().map(({ body }) => body)).toEqual([{}, {}])
})
for (const section of ['buckets', 'usage', 'objects', 'metadata', 'presign'] as const) for (const status of [403, 404, 500, 'network'] as const) test(`${section} ${status} is local and retry sends one request`, async () => {
  const path = { buckets: bucketsPath, usage: usagePath, objects: objectsPath, metadata: metadataPath, presign: presignPath }[section]; let failing = true
  const body = section === 'buckets' ? mockBuckets() : section === 'usage' ? mockUsage() : section === 'objects' ? { items: [], page: {} } : { objectKey: 'media/hero.png' }
  server = setup({ [`${section === 'presign' ? 'POST' : 'GET'} ${path}`]: () => { if (!failing) return Response.json(body); if (status === 'network') throw new TypeError('synthetic-network'); return fail(status)() } }); open()
  if (section === 'objects') { await ready(); click('media-assets') }
  if (section === 'metadata') { await selectBucket(); click('media/hero.png') }
  if (section === 'presign') { await selectObject(); fireEvent.click(screen.getByRole('tab', { name: 'URLs prefirmadas' })); click('Generar URL de descarga prefirmada') }
  const panel = await failure(section); expect(panel).toBeVisible()
  if (status === 500 || status === 'network') { if (status === 500) expect(panel.textContent).toContain('req_synthetic_storage'); failing = false; click('Reintentar', panel); await waitFor(() => expect(count(path)).toBe(2)); await settle() }
  else expect(within(panel).queryByRole('button', { name: 'Reintentar' })).toBeNull()
})
for (const action of ['create', 'upload', 'export', 'delete'] as const) for (const status of [403, 404, 500, 'network'] as const) test(`${action} ${status} retains inputs and never resends without activation`, async () => {
  const path = { create: createPath, upload: uploadPath, export: exportPath, delete: deletePath }[action]; const method = { create: 'POST', upload: 'PUT', export: 'POST', delete: 'DELETE' }[action]
  server = setup({ [`${method} ${path}`]: () => { if (status === 'network') throw new TypeError('synthetic-network'); return fail(status)() } }); open(); await ready()
  if (action === 'create') create(); if (action === 'upload') { await selectBucket(); upload() } if (action === 'export') click('Exportar media-assets'); if (action === 'delete') remove()
  const panel = await failure(action); await settle(); expect(count(path)).toBe(1)
  if (action === 'create') expect(screen.getByLabelText('Nombre del bucket (opcional)')).toHaveValue('media')
  if (action === 'upload') expect(screen.getByLabelText('Archivo')).toBeVisible()
  if (action === 'delete') expect(screen.getByLabelText('Escribe exactamente el nombre del bucket para confirmar.')).toHaveValue('media-assets')
  if (status === 500 || status === 'network') { click('Reintentar', panel); await waitFor(() => expect(count(action === 'create' && status === 'network' ? bucketsPath : path)).toBe(2)); await settle() }
})
for (const mode of ['normalized', 'incomplete', 'pre-existing', 'conclusive', 'unnamed', 'ambiguous'] as const) test(`network create ${mode} reconciles by GET only`, async () => {
  let lists = 0; const typed = mode === 'normalized' ? 'Mi Bucket' : mode === 'unnamed' ? '' : 'media-assets'
  const next = mode === 'normalized' ? [{ ...bucket, resourceId: 'new', bucketName: 'wrk-1-mi-bucket' }] : mode === 'pre-existing' ? [bucket] : mode === 'ambiguous' ? [{ ...bucket, resourceId: 'new' }, { ...bucket, resourceId: 'second' }] : [{ ...bucket, resourceId: 'new' }]
  server = setup({ [`POST ${createPath}`]: () => { throw new TypeError('synthetic-network') }, [`GET ${bucketsPath}`]: () => Response.json(++lists === 1 ? mockBuckets() : { items: next, page: mode === 'incomplete' ? { after: 'next' } : {} }) }); open(); await ready(); create(typed); click('Reintentar', await failure('create'))
  await waitFor(() => expect(count(bucketsPath)).toBe(2)); await settle(); expect(writes()).toHaveLength(1)
  if (mode === 'conclusive') { expect(await screen.findByText('Bucket creado: media-assets.')).toBeVisible(); expect(count(usagePath)).toBe(2) }
  else { expect(await screen.findByText(/No se puede confirmar si el bucket se creó/)).toBeVisible(); expect(count(usagePath)).toBe(1) }
})
for (const contextType of ['tenant', 'workspace']) for (const action of ['create', 'upload', 'export', 'delete'] as const) test(`${contextType} switch during ${action} discards late responses without refetch`, async () => {
  let release = () => {}; const path = { create: createPath, upload: uploadPath, export: exportPath, delete: deletePath }[action]; const method = { create: 'POST', upload: 'PUT', export: 'POST', delete: 'DELETE' }[action]
  server = setup({ [`${method} ${path}`]: () => new Promise<Response>((resolve) => { release = () => resolve(Response.json(action === 'create' ? { bucket } : action === 'upload' ? { objectKey: 'hello.txt', sizeBytes: 5 } : {})) }) }); const view = open(); await selectObject()
  fireEvent.click(screen.getByRole('tab', { name: 'URLs prefirmadas' })); click('Generar URL de descarga prefirmada'); await screen.findByTestId('storage-presigned-result'); fireEvent.click(screen.getByRole('tab', { name: 'Objetos' }))
  if (action === 'create') create(); if (action === 'upload') upload(); if (action === 'export') click('Exportar media-assets'); if (action === 'delete') remove(); await waitFor(() => expect(count(path)).toBe(1))
  setContext(contextType === 'tenant' ? { activeTenantId: 'other', activeWorkspaceId: null } : { activeWorkspaceId: null }); view.rerender(element())
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByTestId('storage-presigned-result')).toBeNull(); expect(document.getElementById('storage-heading')).toHaveFocus()
  await act(async () => release()); expect(count(bucketsPath)).toBe(1); expect(count(usagePath)).toBe(1)
})
test('no tenant or workspace sends no storage request', async () => {
  server = setup(); setContext({ activeTenantId: null, activeWorkspaceId: null }); const view = open(); expect(screen.getByText('Selecciona una organización para continuar.')).toBeVisible(); expect(calls()).toEqual([])
  setContext({ activeWorkspaceId: null }); view.rerender(element()); expect(screen.getByRole('heading', { name: 'Selecciona un área de trabajo' })).toBeVisible(); expect(calls()).toEqual([])
})
test('provider unavailable is never zero and missing quota is explained', async () => {
  server = setup({ [`GET ${usagePath}`]: mockUsage({ collectionStatus: 'provider_unavailable', dimensions: {} }) }); open(); await ready(); expect(screen.getByText(/La consola no interpreta este estado como cero/)).toBeVisible(); expect(screen.queryByRole('meter')).toBeNull(); expect(screen.queryByText('0 B')).toBeNull()
})
test('snippets copy exact legacy output and support an unavailable clipboard', async () => {
  const copy = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } }); server = setup(); open(); await selectBucket()
  fireEvent.click(screen.getAllByRole('button', { name: 'Copiar' })[0]); await waitFor(() => expect(copy).toHaveBeenCalledWith(storageSnippets(bucket)[0].code)); expect(await screen.findByText('Fragmento copiado al portapapeles.')).toBeVisible()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); fireEvent.click(screen.getAllByRole('button', { name: 'Copiar' })[0]); expect(await screen.findByText(/Tu navegador no expone Clipboard API aquí/)).toBeVisible()
})
test('reconciliation rejects wrong workspace, cursor, pre-existing ids and duplicate matches', () => {
  const fresh = { ...bucket, resourceId: 'fresh' }; expect(reconcileCreate({ items: [fresh] }, bucket.workspaceId, bucket.bucketName, [bucket.resourceId])).toEqual(fresh)
  for (const items of [[bucket], [fresh, { ...fresh, resourceId: 'second' }], [{ ...fresh, workspaceId: 'other' }]]) expect(reconcileCreate({ items }, bucket.workspaceId, bucket.bucketName, [bucket.resourceId])).toBeNull()
})
test('reconciliation remembers resource ids from other workspaces in the original tenant inventory', async () => {
  let reads = 0
  const existing = { ...bucket, resourceId: 'res_bucket_2' }
  server = setup({ [`POST ${createPath}`]: () => { throw new TypeError('synthetic-network') }, [`GET ${bucketsPath}`]: () => Response.json(++reads === 1 ? mockBuckets() : { items: [existing], page: {} }) })
  open(); await ready(); create('media-assets'); click('Reintentar', await failure('create'))
  expect(await screen.findByText(/No se puede confirmar si el bucket se creó/)).toBeVisible(); expect(writes()).toHaveLength(1)
})
test('upload trims an explicit key and uses the file MIME type', async () => {
  const path = '/v1/storage/buckets/res_bucket_1/objects/custom%2Fphoto.png'
  server = setup({ [`PUT ${path}`]: { objectKey: 'custom/photo.png', sizeBytes: 3 } }); open(); await selectBucket(); click('Subir objeto')
  set('Clave del objeto (opcional)', '  custom/photo.png  '); fireEvent.change(screen.getByLabelText('Archivo'), { target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] } }); click('Subir')
  await waitFor(() => expect(count(objectsPath)).toBe(2)); expect(writes()).toEqual([{ method: 'PUT', path, body: { content: 'cG5n', contentType: 'image/png', encoding: 'base64' } }])
})
test('a network delete retry answered 404 is reported deleted without a third DELETE', async () => {
  let attempts = 0
  server = setup({ [`DELETE ${deletePath}`]: () => { if (++attempts === 1) throw new TypeError('synthetic-network'); return fail(404)() } }); open(); await ready(); remove(); click('Reintentar', await failure('delete'))
  expect(await screen.findByText('Bucket "media-assets" eliminado.')).toBeVisible(); expect(count(deletePath)).toBe(2); expect(count(bucketsPath)).toBe(2)
})
test('a context switch aborts a delayed inventory and never renders its late rows', async () => {
  let release = () => {}; let signal: AbortSignal | null = null
  server = setup({ [`GET ${bucketsPath}`]: (init: RequestInit) => { signal = init.signal ?? null; return new Promise<Response>((resolve) => { release = () => resolve(Response.json(mockBuckets())) }) } })
  const view = open(); expect(screen.getAllByRole('status').length).toBeGreaterThan(0); await waitFor(() => expect(count(bucketsPath)).toBe(1))
  setContext({ activeTenantId: 'other', activeWorkspaceId: null }); view.rerender(element()); expect((signal as AbortSignal | null)?.aborted).toBe(true)
  await act(async () => release()); expect(screen.queryByRole('button', { name: 'media-assets' })).toBeNull(); expect(document.getElementById('storage-heading')).toHaveFocus()
})
test('changing bucket selection discards stale object reads and clears upload input', async () => {
  let release = () => {}
  const second = { ...bucket, resourceId: 'second', bucketName: 'second-bucket' }
  const secondPath = '/v1/storage/buckets/second/objects?page%5Bsize%5D=50'
  server = setup({ [`GET ${bucketsPath}`]: { items: [bucket, second] }, [`GET ${objectsPath}`]: () => new Promise<Response>((resolve) => { release = () => resolve(Response.json({ items: [{ objectKey: 'stale-object' }] })) }), [`GET ${secondPath}`]: { items: [{ objectKey: 'new-object' }] } })
  open(); await ready(); click('media-assets'); click('Subir objeto'); set('Clave del objeto (opcional)', 'old-key'); click('second-bucket')
  expect(await screen.findByRole('button', { name: 'new-object' })).toBeVisible(); await act(async () => release()); expect(screen.queryByText('stale-object')).toBeNull(); expect(screen.queryByLabelText('Clave del objeto (opcional)')).toBeNull()
})
test('empty history, metadata and usage breakdown render explanatory states', async () => {
  server = setup({ [`GET ${bucketsPath}`]: { items: [{ ...bucket, timestamps: {} }] }, [`GET ${metadataPath}`]: { objectKey: 'media/hero.png', metadata: {} }, [`GET ${usagePath}`]: mockUsage({ buckets: [], dimensions: {} }) }); open(); await selectBucket(); click('media/hero.png')
  expect(await screen.findByText('Este objeto no expone metadatos personalizados.')).toBeVisible(); expect(screen.getByRole('heading', { name: 'Sin historial de estado' })).toBeVisible(); expect(screen.getByText('No hay desglose por bucket disponible en la instantánea pública.')).toBeVisible(); expect(screen.getByText('La API pública no expone un límite de cuota para esta instantánea.')).toBeVisible()
})

test('all connection snippet bytes match the legacy generator including placeholder endpoints', () => {
  const expected = generateSnippets('storage-bucket', { tenantId: bucket.tenantId, tenantSlug: null, workspaceId: bucket.workspaceId, workspaceSlug: null, resourceName: bucket.bucketName, resourceHost: null, resourcePort: null, resourceExtraA: bucket.region, resourceExtraB: null, resourceState: 'active', externalAccessEnabled: true })
  expect(storageSnippets(bucket).map((entry) => entry.code)).toEqual(expected.map((entry) => entry.code))
})
test('closing create no-access returns focus to New bucket and retains the name for reopening', async () => {
  server = setup({ [`POST ${createPath}`]: fail(403) }); open(); await ready(); create('kept-name'); const panel = await failure('create'); click('Cerrar', panel)
  expect(screen.getByRole('button', { name: 'Nuevo bucket' })).toHaveFocus(); click('Nuevo bucket'); expect(screen.getByLabelText('Nombre del bucket (opcional)')).toHaveValue('kept-name'); expect(writes()).toHaveLength(1)
})
test('closing upload no-access returns focus to Upload with the file and key retained', async () => {
  server = setup({ [`PUT ${uploadPath}`]: fail(403) }); open(); await selectBucket(); upload(); click('Cerrar', await failure('upload')); await settle()
  expect(screen.getByRole('button', { name: 'Subir' })).toHaveFocus(); expect(screen.getByRole('button', { name: 'Subir' })).toBeEnabled(); expect(writes()).toHaveLength(1)
})

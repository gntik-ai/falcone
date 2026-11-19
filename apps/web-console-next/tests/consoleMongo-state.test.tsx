import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { calls, drill, open, ready, selectCollection, selectDatabase, setup, settle, state, tab } from './consoleMongo-support'
import { database, detailPath, documentRow, fixtures, urls } from './parity/pages/console-mongo-page.manifest'

let server: ReturnType<typeof setup>
afterEach(() => { server?.verify(); cleanup() })
const paths = () => calls(server).map(({ path }) => path)

// Legacy WorkspaceRequiredState.tsx:35-58: a failed or running workspace discovery keeps its own state and Reintentar.
test('workspace discovery still loading shows the loading state and no picker or create link', async () => {
  server = setup({}, { activeWorkspaceId: null, workspaces: [], loading: true }); open(); await ready(); await selectDatabase()
  expect(await screen.findAllByText('Cargando áreas de trabajo')).not.toHaveLength(0)
  expect(screen.queryByRole('link', { name: 'Crear área de trabajo' })).toBeNull(); expect(screen.queryByText(/todavía no tiene áreas de trabajo/)).toBeNull(); expect(paths()).toEqual([urls.databases()])
})
test('workspace discovery failure shows the error panel and Reintentar reloads the workspaces', async () => {
  server = setup({}, { activeWorkspaceId: null, workspaces: [], error: { status: 500 } }); open(); await ready(); await selectDatabase()
  const panel = await screen.findByTestId('mongo-failure-workspace'); expect(panel).toHaveTextContent('No se pudieron cargar las áreas de trabajo')
  expect(screen.queryByRole('link', { name: 'Crear área de trabajo' })).toBeNull()
  fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' })); expect(state.context.reloadWorkspaces).toHaveBeenCalledTimes(1); expect(paths()).toEqual([urls.databases()])
})

const objectIds = { items: [documentRow('x', { _id: { part: 'a' }, nested: { first: 1 } }), documentRow('y', { _id: { part: 'b' }, nested: { second: 2 } })], page: { after: null, size: 20 } }
test('documents with object-valued _id values expand and collapse independently', async () => {
  server = setup({ ...drill, [`GET ${urls.documents()}`]: objectIds }); open(); await ready(); await selectDatabase(); await selectCollection(); tab('Documentos')
  const toggles = await screen.findAllByRole('button', { name: 'Ver JSON' }); expect(toggles).toHaveLength(2)
  fireEvent.click(toggles[0]); expect(toggles[0]).toHaveAttribute('aria-expanded', 'true'); expect(toggles[1]).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggles[1]); fireEvent.click(toggles[0]); expect(toggles[0]).toHaveAttribute('aria-expanded', 'false'); expect(toggles[1]).toHaveAttribute('aria-expanded', 'true')
})
test('returning to a collection starts collapsed while a tab round trip keeps the expansion', async () => {
  const other = detailPath.replace('orders', 'events')
  server = setup({ ...drill, [`GET ${other}`]: fixtures.detail, [`GET ${other}/indexes?page[size]=100`]: fixtures.indexes, [`GET /v1/mongo/workspaces/ws-1/data/${database}/collections/events/documents?page%5Bsize%5D=20`]: fixtures.documents })
  open(); await ready(); await selectDatabase(); await selectCollection(); tab('Documentos')
  fireEvent.click((await screen.findAllByRole('button', { name: 'Ver JSON' }))[0])
  tab('Índices'); await screen.findByText('status_1'); tab('Documentos')
  expect((await screen.findAllByRole('button', { name: 'Ocultar JSON' }))[0]).toHaveAttribute('aria-expanded', 'true')
  await selectCollection('events'); await settle(); await selectCollection('orders'); await settle(); tab('Documentos')
  const toggles = await screen.findAllByRole('button', { name: 'Ver JSON' }); expect(toggles[0]).toHaveAttribute('aria-expanded', 'false'); expect(screen.queryByRole('button', { name: 'Ocultar JSON' })).toBeNull()
})

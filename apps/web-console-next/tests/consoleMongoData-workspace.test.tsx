import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { calls, open, setup, state } from './consoleMongoData-support'

let server: ReturnType<typeof setup>
afterEach(() => server?.verify())
const noWorkspace = (patch: Record<string, unknown> = {}) => { server = setup(); Object.assign(state.context, { activeWorkspaceId: null, ...patch }) }
const noRequests = () => expect(calls(server)).toEqual([])

// Ports apps/web-console ConsoleMongoDataPage.test.tsx:41-65 (the #742 workspace-required states).
test('loading renders the loading state and sends no request', () => {
  noWorkspace({ loading: true }); open()
  expect(screen.getByRole('heading', { name: 'Cargando áreas de trabajo' })).toBeVisible(); expect(screen.queryByText('Selecciona un área de trabajo para editar datos.')).toBeNull(); noRequests()
})
test.each([403, 500, undefined])('workspace load error %s keeps Reintentar, which calls reloadWorkspaces once', (status) => {
  const reloadWorkspaces = vi.fn(); noWorkspace({ error: { status }, reloadWorkspaces }); open()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); expect(reloadWorkspaces).toHaveBeenCalledTimes(1); expect(screen.getByTestId('mongodata-failure-workspace')).toBeVisible(); noRequests()
})
test('the picker selects a workspace through selectWorkspace and sends nothing', async () => {
  const selectWorkspace = vi.fn(); noWorkspace({ selectWorkspace, workspaces: [{ workspaceId: 'wrk_1', displayName: 'Producción' }, { workspaceId: 'wrk_2', displayName: 'Staging' }] }); open()
  expect(screen.getByText('Selecciona un área de trabajo para editar datos.')).toBeVisible()
  fireEvent.click(screen.getByRole('combobox', { name: 'Seleccionar área de trabajo' })); const option = await screen.findByRole('option', { name: 'Staging' }); fireEvent.pointerDown(option); fireEvent.click(option)
  expect(selectWorkspace).toHaveBeenCalledWith('wrk_2'); noRequests()
})
test('with no workspaces the create link shows only with the permission, otherwise the denial note', () => {
  noWorkspace({ workspaces: [] }); const view = open()
  expect(screen.getByRole('link', { name: 'Crear área de trabajo' })).toHaveAttribute('href', '/console/workspaces'); noRequests(); view.unmount()
  state.allowed = false; open()
  expect(screen.queryByRole('link', { name: 'Crear área de trabajo' })).toBeNull(); expect(screen.getByText(/todavía no tiene áreas de trabajo/)).toBeVisible(); noRequests()
})
test('the target fields and the editor are not rendered without an active workspace', () => {
  noWorkspace({ workspaces: [] }); open(); expect(screen.queryByLabelText('Base de datos')).toBeNull(); expect(screen.queryByTestId('mongodata-editor')).toBeNull()
})

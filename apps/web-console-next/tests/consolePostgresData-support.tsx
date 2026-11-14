import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ConsolePostgresDataPage from '../src/pages/consolePostgresData'
import { login, strictFetch } from './shell-support'
import { keysPath, pg, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'

const mockedState = vi.hoisted(() => ({ context: {} as Record<string, unknown>, allowed: true }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => mockedState.context }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => mockedState.allowed, denyReason: () => 'No permitido.' }) }))
export const state = mockedState
export const context = (overrides: Record<string, unknown> = {}) => ({ activeTenantId: 't-1', activeWorkspaceId: 'ws-1', tenants: [{ tenantId: 't-1', displayName: 'Tenant Alpha' }], workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace Alpha' }], loading: false, error: null, selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn(), ...overrides })

type Routes = Parameters<typeof strictFetch>[0]
export const baseRoutes = (): Routes => ({ [`GET ${rowsUrl()}`]: pg['pg-rows-page1'], [`GET ${keysPath()}`]: pg['pg-api-keys'] })
export function setup(overrides: Routes = {}, ctx: Record<string, unknown> = {}) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  login(['tenant_owner']); state.allowed = true; state.context = context(ctx)
  return strictFetch({ ...baseRoutes(), ...overrides })
}
export const open = () => render(<MemoryRouter><ConsolePostgresDataPage /></MemoryRouter>)
export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
export const click = (name: string | RegExp, root: { getByRole: typeof screen.getByRole } = screen) => fireEvent.click(root.getByRole('button', { name }))
export const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
// Enter a target and wait for the first rows read.
export async function enterTarget(table = 'accounts', database = 'app_db') {
  type('Base de datos', database); type('Tabla', table)
  await screen.findByRole('table', { name: 'Filas de la tabla' })
}
export const calls = (server: ReturnType<typeof strictFetch>) => server.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }))
export const writes = (server: ReturnType<typeof strictFetch>) => calls(server).filter((call) => call.method !== 'GET')
export const count = (server: ReturnType<typeof strictFetch>, path: string) => calls(server).filter((call) => call.path === path).length
// Open a kit select by its label and pick an option.
export async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const item = await screen.findByRole('option', { name: option }); fireEvent.pointerDown(item); fireEvent.click(item)
}
export const failing = (status: number | 'network', then?: unknown) => { let first = true; return () => {
  if (then !== undefined && !first) return Response.json(then)
  first = false
  if (status === 'network') throw new TypeError('raw-backend-message')
  return Response.json({ message: 'raw-backend-message', requestId: 'pg-request' }, { status })
} }
export { within }

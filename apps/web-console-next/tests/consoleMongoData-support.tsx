import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ConsoleMongoDataPage from '../src/pages/consoleMongoData'
import { login, strictFetch } from './shell-support'
import { docsUrl, fixtures } from './parity/pages/console-mongo-data-page.manifest'

const mockedState = vi.hoisted(() => ({ context: {} as Record<string, unknown>, allowed: true }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => mockedState.context }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => mockedState.allowed, denyReason: () => 'No permitido.' }) }))
export const state = mockedState

type Routes = Parameters<typeof strictFetch>[0]
export const failWith = (status: number, extra: Record<string, unknown> = {}) => () => Response.json({ code: `HTTP_${status}`, message: 'synthetic failure', requestId: 'mongo-request', ...extra }, { status })
// Default read for catalog.orders. Tests override single entries.
export const baseRoutes = (): Routes => ({ [`GET ${docsUrl()}`]: fixtures['mongo:documents-page-1'] })
export function setup(overrides: Routes = {}) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  login(['tenant_owner'])
  state.allowed = true
  state.context = { activeTenantId: 't-1', activeWorkspaceId: 'ws-1', tenants: [{ tenantId: 't-1', displayName: 'Tenant Alpha' }], workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace Alpha' }], loading: false, error: null, selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
  return strictFetch({ ...baseRoutes(), ...overrides })
}
export const element = () => <MemoryRouter><ConsoleMongoDataPage /></MemoryRouter>
export const open = () => render(element())
export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
export const typeInto = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
export async function enterTarget(database = 'catalog', collection = 'orders') {
  typeInto('Base de datos', database); typeInto('Colección', collection)
  await settle()
}
export async function loaded() { await screen.findByText(/ord_01/) }
export const button = (name: string | RegExp) => screen.getByRole('button', { name })
export const click = (name: string | RegExp) => fireEvent.click(button(name))
export const calls = (server: ReturnType<typeof strictFetch>) => server.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }))

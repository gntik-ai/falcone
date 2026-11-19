import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ConsoleMongoPage from '../src/pages/consoleMongo'
import { changeLocale as setLocale } from '../src/i18n'
import { login, strictFetch } from './shell-support'
import { database, fixtures, metrics, urls } from './parity/pages/console-mongo-page.manifest'

const mockedState = vi.hoisted(() => ({ context: {} as Record<string, unknown>, allowed: true }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => mockedState.context }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => mockedState.allowed, denyReason: () => 'No permitido.' }) }))
export const state = mockedState

export const shellContext = (overrides: Record<string, unknown> = {}) => ({
  activeTenantId: 't-1', activeWorkspaceId: 'ws-1', tenants: [{ tenantId: 't-1', displayName: 'Tenant Alpha' }], workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace Alpha' }, { workspaceId: 'ws-2', displayName: 'Workspace Beta' }],
  loading: false, error: null, selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn(), ...overrides,
})
// Strict fetch: any request outside the table fails the test through verify().
export function setup(overrides: Parameters<typeof strictFetch>[0] = {}, context: Record<string, unknown> = {}) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  login(['tenant_owner']); state.allowed = true; state.context = shellContext(context)
  return strictFetch({ [`GET ${urls.databases()}`]: fixtures.databases, ...metrics, ...overrides })
}
export const read = (name: keyof typeof urls, ...args: (string | undefined)[]) => `GET ${(urls[name] as (...values: (string | undefined)[]) => string)(...args)}`
export const drill = {
  [`GET ${urls.collections()}`]: fixtures.collections, [`GET ${urls.views()}`]: fixtures.views, [`GET ${urls.detail()}`]: fixtures.detail,
  [`GET ${urls.indexes()}`]: fixtures.indexes, [`GET ${urls.documents()}`]: fixtures.documents,
}
export const element = () => <MemoryRouter><ConsoleMongoPage /></MemoryRouter>
export const open = () => render(element())
export const press = (name: string | RegExp, root: { getByRole: typeof screen.getByRole } = screen) => fireEvent.click(root.getByRole('button', { name }))
export const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
export const ready = () => screen.findByRole('radio', { name: database })
export async function selectDatabase(name = database) { fireEvent.click(await screen.findByRole('radio', { name })); await settle() }
export async function selectCollection(name = 'orders') { fireEvent.click(await screen.findByRole('radio', { name })); await settle() }
export const calls = (server: ReturnType<typeof setup>) => server.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }))
export const changeLocale = setLocale
export { waitFor }

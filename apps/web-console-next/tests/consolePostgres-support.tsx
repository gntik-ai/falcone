import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ConsolePostgresPage from '../src/pages/consolePostgres'
import { login, strictFetch } from './shell-support'
import { reads, metrics, ddlPreviewFixture, paths } from './parity/pages/console-postgres-page.manifest'
const mockedState = vi.hoisted(() => ({ context: {} as Record<string, unknown>, allowed: true }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => mockedState.context }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => mockedState.allowed, denyReason: () => 'No permitido.' }) }))
export const state = mockedState
export function setup(overrides: Parameters<typeof strictFetch>[0] = {}) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  login(['tenant_owner']); state.allowed = true
  state.context = { activeTenantId: 't-1', activeWorkspaceId: 'ws-1', tenants: [{ tenantId: 't-1', displayName: 'Tenant Alpha' }], workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace Alpha' }], loading: false, error: null, selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
  return strictFetch({ ...reads, ...metrics,
    [`PUT ${paths.tables}/accounts`]: ddlPreviewFixture(), [`PUT ${paths.views}/active_accounts`]: ddlPreviewFixture(), [`PUT ${paths.matviews}/accounts_snapshot`]: ddlPreviewFixture(),
    'POST /v1/workspaces/ws-1/databases': { databaseId: 'db-created' }, ...overrides })
}
export const element = () => <MemoryRouter><ConsolePostgresPage /></MemoryRouter>
export const open = () => render(element())
export const click = (name: string, root = screen) => fireEvent.click(root.getByRole('button', { name }))
export const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
export async function selectSchema() { click('app_db'); await screen.findByRole('button', { name: 'public' }); click('public'); await settle() }
export async function ready() { await screen.findByRole('button', { name: 'app_db' }) }
export async function selectTable() { await ready(); await selectSchema(); await screen.findByRole('button', { name: 'accounts' }); click('accounts'); await screen.findByText('gen_random_uuid()') }
export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

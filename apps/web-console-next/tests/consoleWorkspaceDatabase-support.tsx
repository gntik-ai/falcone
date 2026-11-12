import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleWorkspaceDatabasePage from '../src/pages/consoleWorkspaceDatabase'
import { createScenario, record, workspaceId } from './parity/pages/console-workspace-database-page.manifest'
import es from '../src/locales/es/pages.console-workspace-database-page.json'
import en from '../src/locales/en/pages.console-workspace-database-page.json'
import i18n from '../src/i18n'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))
export function workspaceContext(overrides: Record<string, unknown> = {}, roles = ['superadmin']) {
  context.roles = roles
  context.value = { activeWorkspaceId: workspaceId, activeTenantId: record.tenant_id, loading: false, error: null,
    tenants: [], workspaces: [{ workspaceId, displayName: 'Synthetic Workspace' }], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn(), ...overrides }
}
export function patchContext(patch: Record<string, unknown>) { context.value = { ...context.value, ...patch } }
export const element = () => <MemoryRouter><ConsoleWorkspaceDatabasePage /></MemoryRouter>
export const open = () => render(element())
export const copy = () => i18n.language === 'es' ? es : en
let verifyPrevious: (() => void) | undefined
export function serve(id: string, hold?: { method: string; release: Promise<void> }) {
  verifyPrevious?.()
  const scenario = createScenario(id), unmatched: string[] = []
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', path = String(input)
    const response = scenario.handle(method, path, init.body ? JSON.parse(String(init.body)) : undefined)
    if (!response) { unmatched.push(`${method} ${path}`); throw new Error('Unmatched database request') }
    if (hold?.method === method) await hold.release
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, 20))
    if (response.network) throw new TypeError('Failed to fetch')
    return Response.json(response.body, { status: response.status })
  })
  vi.stubGlobal('fetch', mock)
  verifyPrevious = () => expect(unmatched).toEqual([])
  return { scenario, mock, verify: verifyPrevious }
}

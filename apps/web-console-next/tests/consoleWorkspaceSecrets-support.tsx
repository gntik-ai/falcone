import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ConsoleWorkspaceSecretsPage from '../src/pages/consoleWorkspaceSecrets'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { createScenario, fixtureIds, scenarios, workspaceId } from './parity/pages/console-workspace-secrets-page.manifest'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] as string[] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))

// Fixture ids exercised by the suite; the coverage test asserts every manifest id is used.
export const usedFixtures = new Set<string>()
export function workspaceContext(environment: string | null = 'dev', overrides: Record<string, unknown> = {}) {
  context.roles = ['superadmin']
  context.value = {
    activeWorkspaceId: workspaceId, activeTenantId: 'synthetic-tenant', loading: false, error: null,
    tenants: [{ tenantId: 'synthetic-tenant', displayName: 'Synthetic Tenant' }],
    workspaces: [{ workspaceId, tenantId: 'synthetic-tenant', displayName: 'Synthetic Workspace', ...(environment ? { environment } : {}) }],
    selectWorkspace: vi.fn(), reloadTenants: vi.fn(), ...overrides,
  }
}

export interface Gate { release: () => void; promise: Promise<void> }
export const gate = (): Gate => { let release = () => {}; const promise = new Promise<void>((resolve) => { release = resolve }); return { release, promise } }

// Stubs fetch with a manifest scenario. `hold` parks the n-th request of a method+path prefix until released.
export function serve(id: string, hold: { match: (method: string, path: string, index: number) => boolean; gate: Gate }[] = []) {
  usedFixtures.add(id)
  const scenario = createScenario(id)
  const unmatched: string[] = []
  const seen = new Map<string, number>()
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = String(input)
    const index = seen.get(`${method} ${path}`) ?? 0
    seen.set(`${method} ${path}`, index + 1)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const response = scenario.handle(method, path, body)
    if (!response) { unmatched.push(`${method} ${path}`); throw new Error(`Unmatched request: ${method} ${path}`) }
    for (const parked of hold) if (parked.match(method, path, index)) await parked.gate.promise
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, 20))
    if (response.network) throw new TypeError('Failed to fetch')
    return response.status === 204 ? new Response(null, { status: 204 }) : Response.json(response.body, { status: response.status })
  })
  vi.stubGlobal('fetch', mock)
  return { scenario, unmatched, mock, requests: () => scenario.calls.map(({ method, path, body }) => ({ method, path, body })) }
}

export const element = () => <MemoryRouter initialEntries={['/console/workspace-secrets']}><ConsoleWorkspaceSecretsPage /></MemoryRouter>
export const open = () => render(element())
export { fixtureIds, scenarios, workspaceId }
export const setRoles = (roles: string[]) => { context.roles = roles }
export const patchContext = (patch: Record<string, unknown>) => { context.value = { ...context.value, ...patch } }
export const currentContext = () => context.value

import { expect, vi } from 'vitest'
import { buildConsoleLoginSessionFixture } from '@in-falcone/console-api/fixtures'
import { createElement, type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '../src/shell/session'
import { readConsoleShellSession, persistConsoleShellSession } from '@in-falcone/console-api/session'

export const tenantUrl = '/v1/tenants?page%5Bsize%5D=100&sort=displayName'
export const workspaceUrl = (tenant: string) => `/v1/workspaces?page%5Bsize%5D=100&sort=displayName&filter%5BtenantId%5D=${tenant}`
export function login(roles: string[] = ['superadmin'], tenantIds: string[] = [], workspaceIds: string[] = []) {
  const session = buildConsoleLoginSessionFixture()
  Object.assign(session.principal!, { platformRoles: roles, tenantIds, workspaceIds })
  persistConsoleShellSession(session)
  return session
}
export function strictFetch(routes: Record<string, unknown | ((init: RequestInit) => Response | Promise<Response>)>) {
  const unmatched: string[] = []
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${String(input)}`
    if (!(key in routes)) { unmatched.push(key); throw new Error(`Unmatched request: ${key}`) }
    const response = routes[key]
    return typeof response === 'function' ? response(init) : Response.json(response)
  })
  vi.stubGlobal('fetch', mock)
  return { mock, verify: () => expect(unmatched).toEqual([]) }
}

// Seed with login() or persistConsoleShellSession() first. No ProtectedRoute lifecycle.
export function renderWithSession(page: ReactNode, { route = '/console/overview', basename }: { route?: string; basename?: string } = {}) {
  const session = readConsoleShellSession()
  if (!session) throw new Error('Persist a shell session before rendering a page')
  return render(createElement(MemoryRouter, { initialEntries: [route], basename },
    createElement(SessionProvider, { value: session }, page)))
}

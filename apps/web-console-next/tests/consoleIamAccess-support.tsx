import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, vi } from 'vitest'
import ConsoleIamAccessPage from '../src/pages/consoleIamAccess'
import { useConsoleContext } from '../src/shell/context'
import { login, strictFetch } from './shell-support'
import { adaGroups, adaId, adaRoles, firstUsers, groups3, groupsPath, listOf, realmId, roles4, rolesPath, tenant, userPath, users23 } from './parity/pages/console-iam-access-page.manifest'
import es from '../src/locales/es/pages.console-iam-access-page.json'
import en from '../src/locales/en/pages.console-iam-access-page.json'

export const copy = { es, en } as const
export type Locale = keyof typeof copy
export const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)
export const context = (overrides: Record<string, unknown> = {}) => ({ tenants: [tenant], workspaces: [], activeTenantId: realmId, activeWorkspaceId: null, loading: false, error: null, selectTenant: vi.fn(), selectWorkspace: vi.fn(), ...overrides })
export const failure = (status: number, extra: Record<string, unknown> = {}) => () => Response.json({ code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId: 'synthetic-iam-request', ...extra }, { status })
export const created = (body: unknown, status = 201) => () => Response.json(body, { status })

export const defaultRoutes = (): Record<string, unknown> => ({
  [`GET ${firstUsers}`]: listOf(users23), [`GET ${rolesPath}`]: listOf(roles4), [`GET ${groupsPath}`]: listOf(groups3),
  [`GET ${userPath(adaId)}/roles`]: listOf(adaRoles), [`GET ${userPath(adaId)}/groups`]: listOf(adaGroups),
})
let requests: ReturnType<typeof strictFetch>
export const current = () => requests
export function setup(overrides: Record<string, unknown> = {}, roles: string[] = ['superadmin']) {
  login(roles)
  vi.mocked(useConsoleContext).mockReturnValue(context() as never)
  requests = strictFetch({ ...defaultRoutes(), ...overrides })
  return requests
}
export const open = () => render(<StrictMode><MemoryRouter><ConsoleIamAccessPage /></MemoryRouter></StrictMode>)
export const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }))
export const writes = () => calls().filter(({ method }) => method !== 'GET')
export const iamCalls = () => calls().filter(({ path }) => path.startsWith('/v1/iam/'))
export const table = (locale: Locale = 'es') => screen.findByRole('table', { name: copy[locale].users.tableLabel })
export const search = (locale: Locale = 'es') => screen.getByRole('searchbox', { name: copy[locale].users.searchLabel })
export async function selectUser(name = 'ada', locale: Locale = 'es') {
  await table(locale)
  fireEvent.click(screen.getByRole('button', { name }))
  await screen.findByRole('heading', { name: fill(copy[locale].detail.heading, { name }) })
  await screen.findByRole('tab', { name: copy[locale].detail.tab.summary })
}
export const tab = (name: 'summary' | 'roles' | 'groups', locale: Locale = 'es') => screen.getByRole('tab', { name: copy[locale].detail.tab[name] })
export async function openTab(name: 'roles' | 'groups' | 'summary', locale: Locale = 'es') { fireEvent.click(tab(name, locale)); await waitFor(() => expect(tab(name, locale)).toHaveAttribute('aria-selected', 'true')) }
export async function choose(combobox: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }))
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item); fireEvent.click(item)
}

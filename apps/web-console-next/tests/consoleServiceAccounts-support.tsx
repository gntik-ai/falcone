import { StrictMode } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { buildTenantCollectionFixture, buildWorkspaceFixture } from '@in-falcone/console-api/fixtures'
import { ConsoleContextProvider, useConsoleContext } from '../src/shell/context'
import { PermissionsProvider } from '../src/shell/permissions'
import ConsoleServiceAccountsPage from '../src/pages/consoleServiceAccounts'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { active, base, otherWorkspaceId, list, mixed, other, workspaceId } from './parity/pages/console-service-accounts-page.manifest'
import es from '../src/locales/es/pages.console-service-accounts-page.json'
import en from '../src/locales/en/pages.console-service-accounts-page.json'

export const copy = { es, en } as const
export type Locale = keyof typeof copy
export const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)
export const workspaces = [buildWorkspaceFixture(), { ...buildWorkspaceFixture(), workspaceId: 'synthetic-other-workspace', displayName: 'Other Workspace', slug: 'other-workspace' }]
export const tenants = { items: [...buildTenantCollectionFixture().items, { tenantId: 'synthetic-tenant-b', displayName: 'Tenant B', slug: 'tenant-b', state: 'active' }], page: { after: null } }
// Single tenant and workspace by default; `multi` adds a second tenant and workspace and stores the selection.
export const shellRoutes = (multi: boolean): Record<string, unknown> => ({
  [`GET ${tenantUrl}`]: multi ? tenants : buildTenantCollectionFixture(),
  [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: multi ? workspaces : [workspaces[0]], page: { after: null } },
  [`GET ${workspaceUrl('synthetic-tenant-b')}`]: { items: [], page: { after: null } },
})
export const failure = (status: number, extra: Record<string, unknown> = {}) => () => Response.json({ code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId: 'req_synthetic_service_accounts', ...extra }, { status })
export const created = (body: unknown, status = 201) => () => Response.json(body, { status })

export function SwitchControls() {
  const context = useConsoleContext()
  return <><button onClick={() => context.selectWorkspace(otherWorkspaceId)}>switch-workspace</button><button onClick={() => context.selectTenant('synthetic-tenant-b')}>switch-tenant</button></>
}
export function open({ roles = ['superadmin'], routes = {}, controls = true, multi = false, tenantIds = [] }: { roles?: string[]; routes?: Record<string, unknown>; controls?: boolean; multi?: boolean; tenantIds?: string[] } = {}) {
  login(roles, tenantIds)
  if (multi) localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 'synthetic-tenant', workspaceId, updatedAt: '2026-06-01T00:00:00Z' }))
  const requests = strictFetch({ ...shellRoutes(multi), [`GET ${base()}`]: list(mixed), [`GET ${base(otherWorkspaceId)}`]: list(other), ...routes })
  const view = renderWithSession(<StrictMode><ConsoleContextProvider><PermissionsProvider><ConsoleServiceAccountsPage />{controls && <SwitchControls />}</PermissionsProvider></ConsoleContextProvider></StrictMode>)
  return { requests, view }
}
export const calls = (requests: ReturnType<typeof strictFetch>) => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }))
export const pageCalls = (requests: ReturnType<typeof strictFetch>) => calls(requests).filter(({ path }) => path.startsWith('/v1/workspaces/') && path.includes('/service-accounts'))
export const writesOf = (requests: ReturnType<typeof strictFetch>) => pageCalls(requests).filter(({ method }) => method !== 'GET')
export const table = (locale: Locale = 'es') => screen.findByRole('table', { name: copy[locale].table.caption })
export const rowButton = (kind: 'reveal' | 'rotate' | 'revoke' | 'delete', name: string, locale: Locale = 'es') => screen.getByRole('button', { name: fill(copy[locale].row[`${kind}Named` as const], { name }) })
export const dialogOf = (role: 'dialog' | 'alertdialog') => screen.findByRole(role)
export const typeName = (dialog: HTMLElement, value: string, locale: Locale = 'es') => fireEvent.change(within(dialog).getByRole('textbox', { name: copy[locale].confirm.typedName }), { target: { value } })
export { active }
export { workspaceId }

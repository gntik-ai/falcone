import { StrictMode, type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ConsoleContextProvider } from '../src/shell/context'
import { PermissionsProvider } from '../src/shell/permissions'
import ConsoleAuthPage from '../src/pages/consoleAuth'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import {
  applicationsGet, applicationsPath, clients, collection, portal, realmPath, retired, roles, scopes, tenant, users, webhook, workspace, workspaceId,
} from './parity/pages/console-auth-page.manifest'
import es from '../src/locales/es/pages.console-auth-page.json'
import en from '../src/locales/en/pages.console-auth-page.json'

export const copy = { es, en } as const
export type Locale = keyof typeof copy
export const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)
export const failure = (status: number, extra: Record<string, unknown> = {}) => () => Response.json({ code: `HTTP_${status}`, message: 'synthetic-backend-message', requestId: 'req_synthetic_console_auth', ...extra }, { status })
export const accepted = () => Response.json({ status: 'accepted' }, { status: 202 })

// The realm and workspace come from the tenant bootstrap; `realm: false` drops the identity context.
export const shellRoutes = ({ realm = true, tenants = true, workspaces = true, more = [] }: { realm?: boolean; tenants?: boolean; workspaces?: boolean; more?: unknown[] } = {}): Record<string, unknown> => ({
  [`GET ${tenantUrl}`]: { items: tenants ? [realm ? tenant : { ...tenant, identityContext: {} }] : [], page: { after: null } },
  [`GET ${workspaceUrl(tenant.tenantId)}`]: { items: workspaces ? [workspace, ...more] : [], page: { after: null } },
})
// Vitest passes the URL string through unchanged: brackets stay literal there.
export const realmKey = (section: string) => `GET ${realmPath(section)}?page[size]=100`
export const pageRoutes = (): Record<string, unknown> => ({
  [realmKey('users')]: collection(users), [realmKey('roles')]: collection(roles), [realmKey('scopes')]: collection(scopes), [realmKey('clients')]: collection(clients),
  [`GET ${applicationsGet}`]: collection([portal, webhook, retired]),
})

export function open({ roles: platformRoles = ['superadmin'], routes = {}, shell = {}, aside = null }: { roles?: string[]; routes?: Record<string, unknown>; shell?: Parameters<typeof shellRoutes>[0]; aside?: ReactNode } = {}) {
  login(platformRoles)
  const requests = strictFetch({ ...shellRoutes(shell), ...pageRoutes(), ...routes })
  const view = renderWithSession(<StrictMode><ConsoleContextProvider><PermissionsProvider><ConsoleAuthPage />{aside}</PermissionsProvider></ConsoleContextProvider></StrictMode>)
  return { requests, view }
}
export const calls = (requests: ReturnType<typeof strictFetch>) => requests.mock.mock.calls.map(([path, init]) => ({
  method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers),
}))
export const pageCalls = (requests: ReturnType<typeof strictFetch>) => calls(requests).filter(({ path }) => path.startsWith('/v1/iam/') || path.startsWith(`/v1/workspaces/${workspaceId}/`))
export const writes = (requests: ReturnType<typeof strictFetch>) => pageCalls(requests).filter(({ method }) => method !== 'GET')
export const applicationReads = (requests: ReturnType<typeof strictFetch>) => pageCalls(requests).filter(({ method, path }) => method === 'GET' && path === applicationsGet)
export const ready = (locale: Locale = 'es') => screen.findByRole('table', { name: copy[locale].apps.table })
export const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
export const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
export const settle = (assertion: () => void) => waitFor(assertion, { timeout: 4000 })
export { applicationsPath }

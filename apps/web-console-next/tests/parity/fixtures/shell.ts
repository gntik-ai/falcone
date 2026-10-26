import {
  buildConsoleLoginSessionFixture, buildConsoleRefreshSessionFixture, buildConsoleAccountStatusViewFixture,
  buildConsoleSessionTerminationFixture, buildTenantFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture,
} from '@in-falcone/console-api/fixtures'
import type { Role, Variant } from '../manifest'
import { overviewResponse, overviewVariants, type OverviewVariant } from './overview'

export const variants: Variant[] = ['success', 'empty', '401', '403', '404', '500', 'network']
export const endpoints = {
  refresh: { method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh' },
  status: { method: 'GET', path: '/v1/auth/status-views/active' },
  tenants: { method: 'GET', path: '/v1/tenants' },
  tenant: { method: 'GET', path: '/v1/tenants/synthetic-tenant' },
  workspaces: { method: 'GET', path: '/v1/workspaces' },
  termination: { method: 'DELETE', path: '/v1/auth/login-sessions/synthetic-session' },
}
export function sessionFor(role: Role, refresh = false) {
  const session = refresh ? buildConsoleRefreshSessionFixture() : buildConsoleLoginSessionFixture()
  session.principal!.platformRoles = [role]
  return session
}
export function responseFor(name: string, variant: Variant | OverviewVariant, role: Role) {
  if (overviewVariants.includes(variant as OverviewVariant) && ['tenant', 'tenants'].includes(name)) return overviewResponse(name, variant as OverviewVariant)
  const builders: Record<string, () => unknown> = {
    refresh: () => sessionFor(role, true), status: buildConsoleAccountStatusViewFixture,
    tenants: () => { const value = buildTenantCollectionFixture(); if (variant === 'empty') value.items = []; return value }, tenant: buildTenantFixture,
    workspaces: () => { const value = buildWorkspaceCollectionFixture(); if (variant === 'empty') value.items = []; return value }, termination: buildConsoleSessionTerminationFixture,
  }
  if (!builders[name] || !variants.includes(variant as Variant)) throw new Error(`Unknown fixture ${name} ${variant}`)
  if (variant === 'network') return { network: true }
  if (!['success', 'empty'].includes(variant)) return { status: Number(variant), body: { code: `HTTP_${variant}`, message: 'synthetic-error' } }
  const body = variant === 'empty' && !['tenants', 'workspaces'].includes(name) ? {} : builders[name]()
  return { status: 200, body }
}

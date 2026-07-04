import type { ConsoleShellSession } from '@/lib/console-session'

export function getConsolePlatformRoles(principal: ConsoleShellSession['principal'] | undefined): string[] {
  return Array.isArray(principal?.platformRoles) ? principal.platformRoles : []
}

// Platform roles that may call the superadmin tenant collection endpoint (GET /v1/tenants)
// without a 403 — the same predicate as console-context.tsx's `isTenantOperator` (#569) and
// ConsoleTenantsPage.tsx's row-level access check (#752). Shared here so the `/console/tenants`
// sidebar entry (#741) cannot drift from what the page itself actually renders for a role: a
// tenant_owner/tenant_admin can still reach the route, but sees an honest "blocked" state rather
// than a cross-tenant inventory, so the nav entry is hidden for them.
export function hasPlatformInventoryAccess(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && (roles.includes('superadmin') || roles.includes('platform_admin') || roles.includes('platform_operator'))
}

export function isTenantlessPlatformPrincipal(principal: ConsoleShellSession['principal'] | undefined): boolean {
  const roles = getConsolePlatformRoles(principal)
  const tenantIds = Array.isArray(principal?.tenantIds) ? principal.tenantIds.filter(Boolean) : []

  return hasPlatformInventoryAccess(roles) && tenantIds.length === 0
}

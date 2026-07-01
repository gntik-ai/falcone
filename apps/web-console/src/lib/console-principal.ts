import type { ConsoleShellSession } from '@/lib/console-session'

export function getConsolePlatformRoles(principal: ConsoleShellSession['principal'] | undefined): string[] {
  return Array.isArray(principal?.platformRoles) ? principal.platformRoles : []
}

export function isTenantlessPlatformPrincipal(principal: ConsoleShellSession['principal'] | undefined): boolean {
  const roles = getConsolePlatformRoles(principal)
  const tenantIds = Array.isArray(principal?.tenantIds) ? principal.tenantIds.filter(Boolean) : []
  const isPlatformPrincipal = roles.includes('superadmin') || roles.includes('platform_admin') || roles.includes('platform_operator')

  return isPlatformPrincipal && tenantIds.length === 0
}

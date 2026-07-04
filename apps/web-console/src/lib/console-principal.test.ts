import { describe, expect, it } from 'vitest'

import type { ConsoleSessionPrincipal } from '@/lib/console-auth'
import { hasPlatformInventoryAccess, isTenantlessPlatformPrincipal } from './console-principal'

function principal(overrides: Partial<ConsoleSessionPrincipal> = {}): ConsoleSessionPrincipal {
  return {
    displayName: 'Operaciones Plataforma',
    primaryEmail: 'ops@example.com',
    state: 'active',
    userId: 'usr_abc123',
    username: 'operaciones',
    platformRoles: [],
    ...overrides
  }
}

// #741: this predicate is the single source of truth shared by the "Gestión de organizaciones"
// sidebar entry (ConsoleShellLayout.tsx) and the /console/tenants page's own row/blocked-state
// fork (ConsoleTenantsPage.tsx) — it must never drift between the two.
describe('hasPlatformInventoryAccess', () => {
  it('allows the platform roles that can call the GET /v1/tenants collection endpoint', () => {
    expect(hasPlatformInventoryAccess(['superadmin'])).toBe(true)
    expect(hasPlatformInventoryAccess(['platform_admin'])).toBe(true)
    expect(hasPlatformInventoryAccess(['platform_operator'])).toBe(true)
  })

  it('denies tenant-scoped roles and roles with no platform inventory access', () => {
    expect(hasPlatformInventoryAccess(['tenant_owner'])).toBe(false)
    expect(hasPlatformInventoryAccess(['tenant_admin'])).toBe(false)
    expect(hasPlatformInventoryAccess(['platform_team'])).toBe(false)
    expect(hasPlatformInventoryAccess([])).toBe(false)
    expect(hasPlatformInventoryAccess(undefined)).toBe(false)
  })
})

describe('isTenantlessPlatformPrincipal', () => {
  it('is true for a platform-inventory role with no tenantIds', () => {
    expect(isTenantlessPlatformPrincipal(principal({ platformRoles: ['superadmin'], tenantIds: [] }))).toBe(true)
  })

  it('is false once the platform principal has at least one tenantId', () => {
    expect(isTenantlessPlatformPrincipal(principal({ platformRoles: ['platform_operator'], tenantIds: ['ten_alpha'] }))).toBe(false)
  })

  it('is false for a tenant-scoped principal regardless of tenantIds', () => {
    expect(isTenantlessPlatformPrincipal(principal({ platformRoles: ['tenant_owner'], tenantIds: [] }))).toBe(false)
  })
})

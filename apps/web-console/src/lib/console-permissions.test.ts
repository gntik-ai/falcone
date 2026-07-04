import { afterEach, describe, expect, it, vi } from 'vitest'

import { getConsolePermissions, STRUCTURAL_WRITE_ADMIN_ROLES, useConsolePermissions } from './console-permissions'

// A real cross-package import of apps/control-plane/src/runtime/auth-roles.mjs (the pattern already
// used by src/actions/*.mjs, e.g. tenant-management.mjs) resolves fine under vitest, but `tsc
// -p tsconfig.app.json` (the console's strict typecheck gate, run outside vite) has no declaration
// for a plain cross-package .mjs and reports TS7016 for it — there is no ambient-module workaround for
// a relative specifier that does not also touch the tsc baseline. So this stays a literal, INLINE
// mirror of that module's `WRITE_CAPABLE_ADMIN_ROLES` (round-2 review, #761) rather than a real
// import: it still fails the instant either set drifts, it just can't point tsc/vitest at the same
// file. Keep this literal byte-for-byte identical to
// apps/control-plane/src/runtime/auth-roles.mjs::WRITE_CAPABLE_ADMIN_ROLES if that set ever changes.
const BACKEND_WRITE_CAPABLE_ADMIN_ROLES = new Set([
  'tenant_owner',
  'tenant_admin',
  'workspace_owner',
  'workspace_admin',
  'platform_admin',
  'superadmin'
])

const readConsoleShellSessionMock = vi.fn()

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => readConsoleShellSessionMock()
}))

afterEach(() => {
  readConsoleShellSessionMock.mockReset()
})

describe('getConsolePermissions — matrix (#761)', () => {
  it('tenant_viewer is read-only: denied every write action, allowed tenant.audit.read', () => {
    const permissions = getConsolePermissions(['tenant_viewer'])

    expect(permissions.isReadOnly).toBe(true)
    expect(permissions.highestRoleLabel).toBe('Viewer · solo lectura')
    expect(permissions.highestRoleTone).toBe('read-only')
    expect(permissions.can('tenant.workspaces.create')).toBe(false)
    expect(permissions.can('tenant.members.manage')).toBe(false)
    expect(permissions.can('workspace.write')).toBe(false)
    expect(permissions.can('tenant.create')).toBe(false)
    expect(permissions.can('iam.clients.manage')).toBe(false)
    expect(permissions.can('tenant.audit.read')).toBe(true)
  })

  it('tenant_developer is read-only and additionally denied tenant.audit.read (the one viewer/developer asymmetry in the model)', () => {
    const permissions = getConsolePermissions(['tenant_developer'])

    expect(permissions.isReadOnly).toBe(true)
    expect(permissions.highestRoleLabel).toBe('Developer · solo lectura')
    expect(permissions.can('tenant.audit.read')).toBe(false)
    expect(permissions.can('workspace.write')).toBe(false)
    expect(permissions.can('tenant.members.manage')).toBe(false)
  })

  it('tenant_owner is write-capable: never read-only, allowed the tenant-tier write actions', () => {
    const permissions = getConsolePermissions(['tenant_owner'])

    expect(permissions.isReadOnly).toBe(false)
    expect(permissions.highestRoleLabel).toBe('Propietario')
    expect(permissions.highestRoleTone).toBe('write-capable')
    expect(permissions.can('tenant.workspaces.create')).toBe(true)
    expect(permissions.can('tenant.members.manage')).toBe(true)
    expect(permissions.can('workspace.write')).toBe(true)
    expect(permissions.can('tenant.audit.read')).toBe(true)
    // Tenant creation stays platform-only — an owner cannot create ANOTHER tenant from within one.
    expect(permissions.can('tenant.create')).toBe(false)
    // manage_iam is narrower than the other tenant-tier actions — tenant_owner was never granted it.
    expect(permissions.can('iam.clients.manage')).toBe(false)
  })

  it('tenant_admin is write-capable per the model (tenant.members.manage, tenant.workspaces.create)', () => {
    const permissions = getConsolePermissions(['tenant_admin'])

    expect(permissions.isReadOnly).toBe(false)
    expect(permissions.can('tenant.members.manage')).toBe(true)
    expect(permissions.can('tenant.workspaces.create')).toBe(true)
    expect(permissions.can('workspace.write')).toBe(true)
  })

  it('superadmin/platform_operator bypass every action, including tenant.create', () => {
    expect(getConsolePermissions(['superadmin']).can('tenant.create')).toBe(true)
    expect(getConsolePermissions(['platform_operator']).can('tenant.create')).toBe(true)
    expect(getConsolePermissions(['superadmin']).can('iam.clients.manage')).toBe(true)
    expect(getConsolePermissions(['superadmin']).isReadOnly).toBe(false)
  })

  it('workspace_admin can manage IAM clients and perform workspace writes', () => {
    const permissions = getConsolePermissions(['workspace_admin'])

    expect(permissions.isReadOnly).toBe(false)
    expect(permissions.can('iam.clients.manage')).toBe(true)
    expect(permissions.can('workspace.write')).toBe(true)
  })

  it('fails closed for writes on an empty role list, without ever mislabeling it as owner/write-capable', () => {
    const permissions = getConsolePermissions([])

    expect(permissions.isReadOnly).toBe(true)
    expect(permissions.highestRoleLabel).toBe('Sin rol asignado')
    expect(permissions.highestRoleTone).toBe('unknown')
    expect(permissions.can('workspace.write')).toBe(false)
    expect(permissions.can('tenant.members.manage')).toBe(false)
    expect(permissions.denyReason('workspace.write')).toMatch(/no tiene un rol con permisos de escritura reconocido/i)
  })

  it('fails closed for writes on an unrecognized role list', () => {
    const permissions = getConsolePermissions(['tenant_member'])

    expect(permissions.isReadOnly).toBe(true)
    expect(permissions.can('workspace.write')).toBe(false)
  })

  it('fails closed for writes on a null/undefined role list', () => {
    expect(getConsolePermissions(undefined).isReadOnly).toBe(true)
    expect(getConsolePermissions(null).isReadOnly).toBe(true)
  })

  it('denyReason returns null once the action is allowed', () => {
    expect(getConsolePermissions(['tenant_owner']).denyReason('workspace.write')).toBeNull()
  })

  it('denyReason is role-aware and distinguishes viewer from developer copy', () => {
    const viewerReason = getConsolePermissions(['tenant_viewer']).denyReason('workspace.write')
    const developerReason = getConsolePermissions(['tenant_developer']).denyReason('workspace.write')

    expect(viewerReason).toMatch(/viewer/i)
    expect(developerReason).toMatch(/developer/i)
    expect(viewerReason).not.toBe(developerReason)
  })

  it('denyReason falls back to a generic message for a write-capable role narrowly denied one action', () => {
    const reason = getConsolePermissions(['tenant_owner']).denyReason('iam.clients.manage')

    expect(reason).toMatch(/no incluye este permiso/i)
  })

  it('a principal with multiple roles resolves the highest-ranked one for the label', () => {
    const permissions = getConsolePermissions(['tenant_viewer', 'tenant_owner'])

    expect(permissions.highestRoleLabel).toBe('Propietario')
    expect(permissions.isReadOnly).toBe(false)
  })
})

describe('STRUCTURAL_WRITE_ADMIN_ROLES — backend parity (#761 round-2)', () => {
  it('matches apps/control-plane/src/runtime/auth-roles.mjs::WRITE_CAPABLE_ADMIN_ROLES exactly', () => {
    expect(new Set(STRUCTURAL_WRITE_ADMIN_ROLES)).toEqual(BACKEND_WRITE_CAPABLE_ADMIN_ROLES)
  })
})

describe('useConsolePermissions', () => {
  it('reads platformRoles off the persisted shell session with no new backend call', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['tenant_viewer'] } })

    const permissions = useConsolePermissions()

    expect(permissions.isReadOnly).toBe(true)
    expect(permissions.highestRoleLabel).toBe('Viewer · solo lectura')
  })

  it('fails closed when there is no session at all', () => {
    readConsoleShellSessionMock.mockReturnValue(null)

    expect(useConsolePermissions().isReadOnly).toBe(true)
  })
})

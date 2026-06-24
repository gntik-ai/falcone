import { describe, expect, it } from 'vitest'

import type { ConsoleShellSession } from '@/lib/console-session'

import { canManageWorkspaceSecrets, hasWorkspaceSecretsPrivilegedRole } from './workspace-secrets-access'

function session(principal: Partial<NonNullable<ConsoleShellSession['principal']>> | null): ConsoleShellSession {
  return {
    sessionId: 'ses_1',
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: 'a',
    expiresAt: 'b',
    refreshExpiresAt: 'c',
    principal: principal
      ? {
          userId: 'usr_1',
          username: 'u',
          displayName: 'U',
          primaryEmail: 'u@example.com',
          state: 'active',
          platformRoles: [],
          ...principal
        }
      : undefined
  }
}

describe('workspace-secrets-access (coarse, fail-safe gate)', () => {
  it('hasWorkspaceSecretsPrivilegedRole recognizes tenant-admin / platform roles only', () => {
    expect(hasWorkspaceSecretsPrivilegedRole(['tenant_owner'])).toBe(true)
    expect(hasWorkspaceSecretsPrivilegedRole(['platform_admin'])).toBe(true)
    expect(hasWorkspaceSecretsPrivilegedRole(['superadmin'])).toBe(true)
    expect(hasWorkspaceSecretsPrivilegedRole(['enduser'])).toBe(false)
    expect(hasWorkspaceSecretsPrivilegedRole([])).toBe(false)
    expect(hasWorkspaceSecretsPrivilegedRole(undefined)).toBe(false)
  })

  it('denies when there is no session/principal (fail-safe)', () => {
    expect(canManageWorkspaceSecrets(null, 'wrk_1')).toBe(false)
    expect(canManageWorkspaceSecrets(session(null), 'wrk_1')).toBe(false)
  })

  it('allows a tenant-admin / platform-role operator regardless of membership', () => {
    expect(canManageWorkspaceSecrets(session({ platformRoles: ['tenant_admin'] }), 'wrk_1')).toBe(true)
    expect(canManageWorkspaceSecrets(session({ platformRoles: ['platform_team'], workspaceIds: [] }), 'wrk_foreign')).toBe(true)
  })

  it('allows a member of the active workspace', () => {
    expect(canManageWorkspaceSecrets(session({ workspaceIds: ['wrk_1', 'wrk_2'] }), 'wrk_1')).toBe(true)
  })

  it('denies a non-member with no privileged role (fail-safe redirect)', () => {
    expect(canManageWorkspaceSecrets(session({ workspaceIds: ['wrk_2'] }), 'wrk_1')).toBe(false)
    expect(canManageWorkspaceSecrets(session({ workspaceIds: [] }), 'wrk_1')).toBe(false)
  })

  it('with no active workspace, allows an operator who is a member of at least one workspace', () => {
    expect(canManageWorkspaceSecrets(session({ workspaceIds: ['wrk_2'] }), null)).toBe(true)
    expect(canManageWorkspaceSecrets(session({ workspaceIds: [] }), null)).toBe(false)
  })
})

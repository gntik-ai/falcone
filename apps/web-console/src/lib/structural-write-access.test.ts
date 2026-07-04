import { describe, expect, it } from 'vitest'

import { canPerformStructuralWrites } from './structural-write-access'

describe('canPerformStructuralWrites', () => {
  it('allows structural admin roles', () => {
    expect(canPerformStructuralWrites(['tenant_owner'])).toBe(true)
    expect(canPerformStructuralWrites(['tenant_admin'])).toBe(true)
    expect(canPerformStructuralWrites(['workspace_admin'])).toBe(true)
    expect(canPerformStructuralWrites(['platform_admin'])).toBe(true)
    expect(canPerformStructuralWrites(['superadmin'])).toBe(true)
  })

  it('denies non-admin tenant roles', () => {
    expect(canPerformStructuralWrites(['tenant_developer'])).toBe(false)
    expect(canPerformStructuralWrites(['tenant_viewer'])).toBe(false)
    expect(canPerformStructuralWrites([])).toBe(false)
    expect(canPerformStructuralWrites(undefined)).toBe(false)
  })

  it('denies platform_operator and platform_team (round-2 review #761: these are NOT in the backend WRITE_CAPABLE_ADMIN_ROLES set — auth-roles.mjs — so granting them structural-write affordances here would enable a control the backend 403s)', () => {
    expect(canPerformStructuralWrites(['platform_operator'])).toBe(false)
    expect(canPerformStructuralWrites(['platform_team'])).toBe(false)
  })
})

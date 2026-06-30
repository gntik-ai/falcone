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
})

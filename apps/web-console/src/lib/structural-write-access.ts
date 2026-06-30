const STRUCTURAL_WRITE_ROLES = new Set([
  'tenant_owner',
  'tenant_admin',
  'workspace_owner',
  'workspace_admin',
  'platform_admin',
  'superadmin'
])

export function canPerformStructuralWrites(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => STRUCTURAL_WRITE_ROLES.has(role))
}

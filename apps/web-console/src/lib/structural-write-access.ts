// Delegates to the single console permission source (#761) instead of hand-rolling a second role
// set. `WORKSPACE_WRITE_CAPABLE_ROLES` is a strict superset of the original list here (it also
// includes `platform_operator`/`platform_team`, already treated as platform-privileged everywhere
// else in the console — see console-principal.ts::hasPlatformInventoryAccess).
import { WORKSPACE_WRITE_CAPABLE_ROLES } from '@/lib/console-permissions'

export function canPerformStructuralWrites(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => WORKSPACE_WRITE_CAPABLE_ROLES.has(role))
}

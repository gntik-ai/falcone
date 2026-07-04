// Delegates to the single console permission source (#761) instead of hand-rolling a second role
// set — but to a DEDICATED set, `STRUCTURAL_WRITE_ADMIN_ROLES`, not the broader
// `WORKSPACE_WRITE_CAPABLE_ROLES`. This gate mirrors a real BACKEND role gate
// (`apps/control-plane/src/runtime/auth-roles.mjs::WRITE_CAPABLE_ADMIN_ROLES` — Events/Kafka
// create-topic and publish, per `docs/reference/architecture/structural-write-role-gates.md`), so it
// must match that backend set EXACTLY: {tenant_owner, tenant_admin, workspace_owner, workspace_admin,
// platform_admin, superadmin}. `WORKSPACE_WRITE_CAPABLE_ROLES` also includes
// `platform_operator`/`platform_team` (a console-wide platform bypass used for narrower,
// console-only affordances elsewhere) — using it here would enable a control the backend then 403s
// for those two roles (round-2 review, #761).
import { STRUCTURAL_WRITE_ADMIN_ROLES } from '@/lib/console-permissions'

export function canPerformStructuralWrites(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => STRUCTURAL_WRITE_ADMIN_ROLES.has(role))
}

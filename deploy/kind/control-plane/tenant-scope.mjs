// Shared tenant-scoping helpers for the kind control-plane LOCAL handlers.
//
// The browse/list/metrics handlers (kafka/metrics/mongo) run with route auth
// `authenticated`, so any verified caller reaches them. These helpers give those
// handlers the SAME own-tenant boundary the data plane (executor) enforces and
// that b-handlers' `canManageTenantId` already applies to tenant/workspace
// management — resolved from the VERIFIED JWT identity, never from request input.

// Tenant predicate to AND into resource queries: `null` for platform callers
// (superadmin / internal may legitimately operate cross-tenant), otherwise the
// caller's verified tenant id. Mirrors fn-handlers' `callerTenantId`.
export function callerTenantScope(identity) {
  if (!identity) return null;
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return null;
  return identity.tenantId ?? null;
}

// Own-tenant authorization (same logic as b-handlers' canManageTenantId):
// superadmin / internal -> any tenant; tenant owners/admins -> only their own
// tenant; everyone else -> denied.
export function canManageTenant(identity, tenantId) {
  if (!identity) return false;
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  return ['tenant_owner', 'tenant_admin'].includes(identity.actorType)
    && tenantId != null && identity.tenantId === tenantId;
}

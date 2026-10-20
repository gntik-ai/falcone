import { can } from './model-authz.mjs';
import model from '../../packages/internal-contracts/src/authorization-model.json' with { type: 'json' };

const TENANT_ROLES = new Set(model.permission_matrix.tenant.map(({ role }) => role));

// Authority comes only from verified identity and persisted scope. Callers keep
// their resource-specific not-found response and any additional action/role gate.
export function canAccessWorkspace(identity, record, actions, { allowUnmapped = false } = {}) {
  if (!identity) return false;
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  if (!record || (!allowUnmapped && (!record.tenant_id || !record.workspace_id))) return false;
  if (record.tenant_id && identity.tenantId === record.tenant_id
    && Array.isArray(identity.roles) && identity.roles.some((role) => role === 'tenant_owner' || role === 'tenant_admin')) return true;
  const scope = { tenantId: record.tenant_id, workspaceId: record.workspace_id };
  if (actions.some((action) => can(identity, action, scope))) return true;
  return Boolean(record.tenant_id && identity.tenantId === record.tenant_id && record.workspace_id
    && Array.isArray(identity.roles) && identity.roles.some((role) => TENANT_ROLES.has(role))
    && Array.isArray(identity.workspaceIds) && identity.workspaceIds.includes(record.workspace_id));
}

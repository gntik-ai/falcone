import { can } from './model-authz.mjs';
import model from '../../packages/internal-contracts/src/authorization-model.json' with { type: 'json' };

const TENANT_ROLES = new Set(model.permission_matrix.tenant.map(({ role }) => role));

const DATABASE_ACTIONS = Object.freeze(['database.read', 'database.write', 'database.admin']);
const TOPIC_ACTIONS = Object.freeze(['topic.read', 'topic.publish', 'topic.consume', 'topic.admin']);

// Visibility accepts any existing model action for a family; handlers still enforce
// their operation-specific action/structural checks. Realtime describes database
// change streams, and webhooks deliver topic events, so they use those existing
// model capabilities rather than introducing new permissions in #1141.
export const WORKSPACE_ACTIONS = Object.freeze({
  function: Object.freeze(['function.read', 'function.invoke', 'function.deploy', 'function.admin']),
  functionInvoke: Object.freeze(['function.invoke', 'function.admin']),
  database: DATABASE_ACTIONS,
  realtime: DATABASE_ACTIONS,
  topic: TOPIC_ACTIONS,
  webhook: TOPIC_ACTIONS,
  bucket: Object.freeze(['bucket.read', 'bucket.write', 'bucket.admin']),
});

export function isPlatformIdentity(identity) {
  return identity?.actorType === 'superadmin' || identity?.actorType === 'internal';
}

export function hasVerifiedTenantAdminRole(identity) {
  return Array.isArray(identity?.roles)
    && identity.roles.some((role) => role === 'tenant_owner' || role === 'tenant_admin');
}

// Authority comes only from verified identity and persisted scope. Callers keep
// their resource-specific not-found response and any additional action/role gate.
export function canAccessWorkspace(identity, record, actions, { allowUnmapped = false } = {}) {
  if (!identity) return false;
  if (isPlatformIdentity(identity)) return true;
  if (!record || (!allowUnmapped && (!record.tenant_id || !record.workspace_id))) return false;
  if (record.tenant_id && identity.tenantId === record.tenant_id
    && hasVerifiedTenantAdminRole(identity)) return true;
  const scope = { tenantId: record.tenant_id, workspaceId: record.workspace_id };
  if (actions.some((action) => can(identity, action, scope))) return true;
  return Boolean(record.tenant_id && identity.tenantId === record.tenant_id && record.workspace_id
    && Array.isArray(identity.roles) && identity.roles.some((role) => TENANT_ROLES.has(role))
    && Array.isArray(identity.workspaceIds) && identity.workspaceIds.includes(record.workspace_id));
}

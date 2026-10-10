import model from '../../packages/internal-contracts/src/authorization-model.json' with { type: 'json' };

// Compile the shipped model once; requests never read contract files.
const matrix = Object.entries(model.permission_matrix).flatMap(([scope, entries]) =>
  entries.map((entry) => ({ ...entry, matrix_scope: scope })));
const permissions = new Map(matrix.map((entry) => [entry.role, {
  scope: entry.matrix_scope,
  allowed: new Set(entry.allowed_actions),
}]));
const actions = new Set(matrix.flatMap((entry) => [
  ...entry.allowed_actions, ...entry.denied_actions,
]));

export function can(identity, action, { tenantId, workspaceId } = {}) {
  if (!identity || !actions.has(action)) return false;
  // Preserve the existing platform/internal bypass on these local handlers.
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  if (!Array.isArray(identity.roles)) return false;
  return identity.roles.some((role) => {
    const permission = permissions.get(role);
    if (!permission?.allowed.has(action)) return false;
    if (permission.scope === 'platform') return role === 'platform_admin';
    if (!tenantId || identity.tenantId !== tenantId) return false;
    if (permission.scope === 'tenant') return true;
    return permission.scope === 'workspace' && Boolean(workspaceId)
      && Array.isArray(identity.workspaceIds) && identity.workspaceIds.includes(workspaceId);
  });
}

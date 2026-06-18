import {
  buildWorkspaceCloneDraft,
  filterPublicRoutes,
  getApiFamily,
  getBusinessStateMachine,
  getPublicRoute,
  resolveWorkspaceApiSurface,
  resolveWorkspaceResourceInheritance
} from '../../../services/internal-contracts/src/index.mjs';

export const workspaceApiFamily = getApiFamily('workspaces');
export const workspaceLifecycleStateMachine = getBusinessStateMachine('workspace_lifecycle');
export const workspaceRoutes = filterPublicRoutes({ family: 'workspaces' });

export function listWorkspaceRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'workspaces', ...filters });
}

export function getWorkspaceRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'workspaces' ? route : undefined;
}

/**
 * Single-workspace teardown handler (add-deploy-completeness-cluster, #562).
 *
 * The shippable-product counterpart of the kind-runtime `deleteWorkspace` cascade,
 * wired to the existing public route `deleteWorkspace`
 * (`DELETE /v1/workspaces/{workspaceId}`). A pure function (no real HTTP) that
 * re-gates the request by TENANT OWNERSHIP — never bypassing the cardinal isolation
 * rule — and, when allowed, dispatches the workspace teardown through an injected
 * dispatcher.
 *
 * ISOLATION: a tenant owner/admin may delete ONLY a workspace whose tenantId matches
 * their verified identity; superadmin/internal may delete any. A cross-tenant id is
 * reported as 404 (no existence leak), with NO dispatch.
 *
 * Response shape:
 *  - denied (cross-tenant): { statusCode: 404, body: { code, workspaceId } }
 *  - allowed:               { statusCode: 200, body: { workspaceId, tenantId, deleted: true } }
 *
 * @param {Object} input
 * @param {Object} input.workspace            resolved workspace ({ workspaceId, tenantId, ... })
 * @param {string|null} [input.actorUserId]
 * @param {string|null} [input.actorTenantId] caller's verified tenant id
 * @param {string} [input.actorType]          'superadmin' | 'internal' | 'tenant_owner' | 'tenant_admin' | ...
 * @param {(arg: Object) => Promise<any>} [input.dispatchTeardown] injected teardown dispatcher
 * @returns {Promise<{ statusCode: number, body: Object }>}
 */
export async function handleWorkspaceDeleteRequest({
  workspace,
  actorUserId = null,
  actorTenantId = null,
  actorType = '',
  dispatchTeardown = async () => {}
} = {}) {
  const workspaceId = workspace?.workspaceId ?? workspace?.id ?? null;
  const tenantId = workspace?.tenantId ?? workspace?.tenant_id ?? null;

  // Own-tenant authorization (mirrors the kind runtime's canManageTenantId): platform actors may
  // delete any workspace; tenant owners/admins only their own. A missing workspace OR a cross-tenant
  // one is 404 (no existence leak), so a foreign tenant can never probe another tenant's workspaces.
  const isPlatform = actorType === 'superadmin' || actorType === 'internal';
  const ownsTenant = ['tenant_owner', 'tenant_admin'].includes(actorType)
    && tenantId != null && actorTenantId === tenantId;
  if (!workspace || !(isPlatform || ownsTenant)) {
    return { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', workspaceId } };
  }

  await dispatchTeardown({ workspaceId, tenantId, actorUserId, actorType });

  return { statusCode: 200, body: { workspaceId, tenantId, deleted: true } };
}

export function summarizeWorkspaceManagementSurface({ workspaceId, workspaceSlug, workspaceEnvironment, iamRealm, applications = [] }) {
  return {
    family: workspaceApiFamily,
    routes: workspaceRoutes,
    lifecycle: workspaceLifecycleStateMachine,
    apiSurface: resolveWorkspaceApiSurface({
      workspaceId,
      workspaceSlug,
      workspaceEnvironment,
      iamRealm,
      applications
    })
  };
}

export { buildWorkspaceCloneDraft, resolveWorkspaceApiSurface, resolveWorkspaceResourceInheritance };

/**
 * Per-tenant custom RBAC role catalog — management surface + validation.
 *
 * Feature: add-tenant-custom-rbac (issue #261).
 *
 * Tenant admins author namespaced (`custom:` prefixed) roles that bind a subset
 * of the platform permission_matrix actions, scoped to (tenant_id, workspace_id).
 * Bindings are persisted in the control-plane DB (NOT Keycloak realm roles).
 *
 * Scope of THIS module: the CRUD management surface and creation/update
 * validation (prefix, reserved-name, subset-of-creator, platform-scoped guards)
 * plus cross-tenant read isolation. Mutations emit the
 * `tenant.effective_permissions.recalculate` trigger so that the (infra-bound,
 * separately delivered) effective-permissions resolver / token issuance can fold
 * active custom roles into the resolved permission set. The end-to-end runtime
 * ENFORCEMENT (gateway scope check observing a custom binding) is delivered with
 * the Keycloak token-issuance + gateway half and is out of scope here.
 *
 * Handlers follow the repo's OpenWhisk-style `main(params, overrides)` convention
 * and return { statusCode, body }. The `db` and `recalculate` trigger are
 * injected via `overrides` (DI) for black-box testing.
 *
 * @module iam-tenant-roles
 */

import {
  filterPublicRoutes,
  getPublicRoute,
  listPermissionMatrix
} from '../../../services/internal-contracts/src/index.mjs';
import {
  RESERVED_ROLE_NAMES
} from '../../../services/adapters/src/keycloak-admin.mjs';

/** Public catalog routes for the tenant custom-role surface (IAM family). */
export const tenantCustomRoleRoutes = filterPublicRoutes({ family: 'iam' }).filter(
  (route) => route.resourceType === 'iam_custom_role'
);

/** Resolve one tenant custom-role catalog route by operationId. */
export function getTenantCustomRoleRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.resourceType === 'iam_custom_role' ? route : undefined;
}

const CUSTOM_PREFIX = 'custom:';
const RECALCULATE_ACTION = 'tenant.effective_permissions.recalculate';

const RESERVED_ROLE_NAME_SET = new Set(RESERVED_ROLE_NAMES);

/** Split a comma-separated string or pass through an array of role/scope tokens. */
function splitComma(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Derive caller identity from gateway-injected trusted headers only. The gateway
 * strips client-supplied X-* identity headers, so these values are trustworthy.
 * Returns null when x-tenant-id is absent → 401.
 *
 * @param {object} params
 * @returns {{ tenantId: string, workspaceId: string|null, actorId: string, roles: string[] } | null}
 */
export function parseTenantRoleIdentity(params) {
  const headers = params?.__ow_headers ?? {};
  const tenantId = headers['x-tenant-id'];
  if (!tenantId || String(tenantId).trim() === '') {
    return null;
  }
  const workspaceHeader = headers['x-workspace-id'];
  const workspaceId = workspaceHeader && String(workspaceHeader).trim() !== '' ? String(workspaceHeader) : null;
  return {
    tenantId: String(tenantId),
    workspaceId,
    actorId: headers['x-auth-subject'] ?? null,
    roles: splitComma(headers['x-actor-roles'])
  };
}

/**
 * The set of actions a caller can grant, derived from the platform
 * permission_matrix: the union of allowed_actions for every matrix role the
 * caller holds, minus any action denied by any of those roles. "You cannot grant
 * what you do not hold."
 *
 * @param {string[]} roles
 * @returns {Set<string>}
 */
export function reachableActionsForRoles(roles) {
  const held = new Set(roles ?? []);
  const allowed = new Set();
  const denied = new Set();
  for (const entry of listPermissionMatrix()) {
    if (!held.has(entry.role)) continue;
    for (const action of entry.allowed_actions ?? []) allowed.add(action);
    for (const action of entry.denied_actions ?? []) denied.add(action);
  }
  for (const action of denied) allowed.delete(action);
  return allowed;
}

/**
 * Actions that are platform-scoped / cross-tenant and may NEVER be embedded in a
 * tenant custom role, regardless of the caller's own role. Defined as the union
 * of:
 *   - tenant_owner.denied_actions (the highest tenant role's hard denials, e.g.
 *     app.admin, service_account.admin, *.admin, app.deploy, ...), and
 *   - "platform-only" actions: actions present in a platform role's
 *     allowed_actions but in NO tenant/workspace role's allowed_actions (e.g.
 *     tenant.suspend, workspace.delete).
 *
 * @returns {Set<string>}
 */
export function platformScopedActions() {
  const tenantRoles = listPermissionMatrix('tenant');
  const workspaceRoles = listPermissionMatrix('workspace');
  const platformRoles = listPermissionMatrix('platform');

  const blocked = new Set();

  const owner = tenantRoles.find((entry) => entry.role === 'tenant_owner');
  for (const action of owner?.denied_actions ?? []) blocked.add(action);

  const tenantWorkspaceAllowed = new Set(
    [...tenantRoles, ...workspaceRoles].flatMap((entry) => entry.allowed_actions ?? [])
  );
  for (const entry of platformRoles) {
    for (const action of entry.allowed_actions ?? []) {
      if (!tenantWorkspaceAllowed.has(action)) blocked.add(action);
    }
  }

  return blocked;
}

function errorBody(code, message, extra = {}) {
  return { code, error: message, ...extra };
}

function serializeRole(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id ?? null,
    role_name: row.role_name,
    allowed_actions: [...(row.allowed_actions ?? [])],
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

/**
 * Validate a submitted custom role definition.
 *
 * Validation order (first failure wins):
 *   1. role_name must start with `custom:`         → 422
 *   2. role_name (full or unprefixed) must not be
 *      a RESERVED_ROLE_NAMES entry                  → 422
 *   3. allowed_actions must be a non-empty array    → 422
 *   4. no platform-scoped / cross-tenant action     → 403
 *   5. every action within the caller's reachable
 *      (held) actions                               → 403
 *
 * @returns {{ ok: true, allowed_actions: string[] } | { ok: false, statusCode: number, body: object }}
 */
export function validateCustomRoleDefinition({ roleName, allowedActions, roles }) {
  if (typeof roleName !== 'string' || !roleName.startsWith(CUSTOM_PREFIX)) {
    return {
      ok: false,
      statusCode: 422,
      body: errorBody('INVALID_ROLE_NAME', `Custom role name must start with "${CUSTOM_PREFIX}".`)
    };
  }

  const unprefixed = roleName.slice(CUSTOM_PREFIX.length);
  if (RESERVED_ROLE_NAME_SET.has(roleName) || RESERVED_ROLE_NAME_SET.has(unprefixed)) {
    return {
      ok: false,
      statusCode: 422,
      body: errorBody('RESERVED_ROLE_NAME', `Custom role name collides with a reserved role name: ${unprefixed}.`)
    };
  }

  if (!Array.isArray(allowedActions) || allowedActions.length === 0) {
    return {
      ok: false,
      statusCode: 422,
      body: errorBody('INVALID_ALLOWED_ACTIONS', 'allowed_actions must be a non-empty array of action strings.')
    };
  }
  if (!allowedActions.every((action) => typeof action === 'string' && action.length > 0)) {
    return {
      ok: false,
      statusCode: 422,
      body: errorBody('INVALID_ALLOWED_ACTIONS', 'Every allowed_actions entry must be a non-empty action string.')
    };
  }

  const platformBlocked = platformScopedActions();
  const offendingPlatform = allowedActions.filter((action) => platformBlocked.has(action));
  if (offendingPlatform.length > 0) {
    return {
      ok: false,
      statusCode: 403,
      body: errorBody(
        'PLATFORM_SCOPED_ACTION',
        'Custom roles cannot grant platform-scoped or cross-tenant actions.',
        { platform_scoped_actions: offendingPlatform }
      )
    };
  }

  const reachable = reachableActionsForRoles(roles);
  const notHeld = allowedActions.filter((action) => !reachable.has(action));
  if (notHeld.length > 0) {
    return {
      ok: false,
      statusCode: 403,
      body: errorBody(
        'ACTION_NOT_HELD',
        'Custom roles cannot grant actions the requesting principal does not hold.',
        { unauthorized_actions: notHeld }
      )
    };
  }

  // De-duplicate while preserving submitted order.
  const deduped = [...new Set(allowedActions)];
  return { ok: true, allowed_actions: deduped };
}

/**
 * POST /v1/iam/tenant-roles — create a custom role.
 */
export async function createTenantCustomRole(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  if (!db) {
    return { statusCode: 500, body: errorBody('CONFIG_ERROR', 'Custom role storage is not configured.') };
  }

  const identity = overrides.identity ?? parseTenantRoleIdentity(params);
  if (!identity) {
    return { statusCode: 401, body: errorBody('UNAUTHORIZED', 'Missing tenant identity headers.') };
  }

  const roleName = params.role_name;
  const allowedActions = params.allowed_actions;
  const validation = validateCustomRoleDefinition({ roleName, allowedActions, roles: identity.roles });
  if (!validation.ok) {
    return { statusCode: validation.statusCode, body: validation.body };
  }

  // Conflict: an active role with the same name already exists in scope.
  const existing = db.listByScope(identity.tenantId, identity.workspaceId)
    .find((row) => row.role_name === roleName);
  if (existing) {
    return { statusCode: 409, body: errorBody('ROLE_EXISTS', `A custom role named ${roleName} already exists in this scope.`) };
  }

  const row = db.insert({
    tenant_id: identity.tenantId,
    workspace_id: identity.workspaceId,
    role_name: roleName,
    allowed_actions: validation.allowed_actions,
    created_by: identity.actorId
  });

  await triggerRecalculate(overrides, identity, row);

  return { statusCode: 201, body: serializeRole(row) };
}

/**
 * GET /v1/iam/tenant-roles — list custom roles scoped to the caller.
 */
export async function listTenantCustomRoles(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  if (!db) {
    return { statusCode: 500, body: errorBody('CONFIG_ERROR', 'Custom role storage is not configured.') };
  }

  const identity = overrides.identity ?? parseTenantRoleIdentity(params);
  if (!identity) {
    return { statusCode: 401, body: errorBody('UNAUTHORIZED', 'Missing tenant identity headers.') };
  }

  const rows = db.listByScope(identity.tenantId, identity.workspaceId);
  return { statusCode: 200, body: { items: rows.map(serializeRole) } };
}

/**
 * GET /v1/iam/tenant-roles/{roleId} — read a single custom role.
 * Returns 404 (never 403) when the role belongs to a different tenant, to avoid
 * cross-tenant ID enumeration / existence leakage.
 */
export async function getTenantCustomRole(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  if (!db) {
    return { statusCode: 500, body: errorBody('CONFIG_ERROR', 'Custom role storage is not configured.') };
  }

  const identity = overrides.identity ?? parseTenantRoleIdentity(params);
  if (!identity) {
    return { statusCode: 401, body: errorBody('UNAUTHORIZED', 'Missing tenant identity headers.') };
  }

  const roleId = params.roleId ?? params.role_id;
  const row = db.findById(roleId);
  if (!row || row.tenant_id !== identity.tenantId) {
    return { statusCode: 404, body: errorBody('NOT_FOUND', 'Custom role not found.') };
  }

  return { statusCode: 200, body: serializeRole(row) };
}

/**
 * PUT /v1/iam/tenant-roles/{roleId} — replace a custom role's allowed_actions.
 * Same validation as create; triggers recalculate on success.
 */
export async function updateTenantCustomRole(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  if (!db) {
    return { statusCode: 500, body: errorBody('CONFIG_ERROR', 'Custom role storage is not configured.') };
  }

  const identity = overrides.identity ?? parseTenantRoleIdentity(params);
  if (!identity) {
    return { statusCode: 401, body: errorBody('UNAUTHORIZED', 'Missing tenant identity headers.') };
  }

  const roleId = params.roleId ?? params.role_id;
  const row = db.findById(roleId);
  if (!row || row.tenant_id !== identity.tenantId) {
    return { statusCode: 404, body: errorBody('NOT_FOUND', 'Custom role not found.') };
  }

  const roleName = params.role_name ?? row.role_name;
  const allowedActions = params.allowed_actions;
  const validation = validateCustomRoleDefinition({ roleName, allowedActions, roles: identity.roles });
  if (!validation.ok) {
    return { statusCode: validation.statusCode, body: validation.body };
  }

  row.role_name = roleName;
  row.allowed_actions = validation.allowed_actions;
  row.updated_at = overrides.now ?? new Date().toISOString();

  await triggerRecalculate(overrides, identity, row);

  return { statusCode: 200, body: serializeRole(row) };
}

/**
 * DELETE /v1/iam/tenant-roles/{roleId} — soft-delete a custom role.
 * Triggers recalculate so downstream resolution drops the binding.
 */
export async function deleteTenantCustomRole(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  if (!db) {
    return { statusCode: 500, body: errorBody('CONFIG_ERROR', 'Custom role storage is not configured.') };
  }

  const identity = overrides.identity ?? parseTenantRoleIdentity(params);
  if (!identity) {
    return { statusCode: 401, body: errorBody('UNAUTHORIZED', 'Missing tenant identity headers.') };
  }

  const roleId = params.roleId ?? params.role_id;
  const row = db.findById(roleId);
  if (!row || row.tenant_id !== identity.tenantId) {
    return { statusCode: 404, body: errorBody('NOT_FOUND', 'Custom role not found.') };
  }

  row.deleted_at = overrides.now ?? new Date().toISOString();

  await triggerRecalculate(overrides, identity, row);

  return { statusCode: 204, body: null };
}

/**
 * Emit the existing `tenant.effective_permissions.recalculate` trigger so the
 * effective-permissions resolver / token issuance refreshes affected principals.
 * The downstream effect (gateway scope check observing the change) is delivered
 * with the infra-bound enforcement half.
 */
async function triggerRecalculate(overrides, identity, row) {
  const trigger = overrides.triggerRecalculate ?? overrides.recalculate;
  if (typeof trigger !== 'function') return;
  await trigger({
    action: RECALCULATE_ACTION,
    tenant_id: identity.tenantId,
    workspace_id: identity.workspaceId,
    role_id: row.id,
    role_name: row.role_name
  });
}

export { RECALCULATE_ACTION };

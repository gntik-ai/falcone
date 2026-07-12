import { randomUUID } from 'node:crypto';
import {
  buildTenantFunctionalConfigurationExport,
  buildTenantPurgeDraft,
  buildTenantResourceInventory,
  evaluateTenantLifecycleMutation,
  filterPublicRoutes,
  getApiFamily,
  getBusinessStateMachine,
  getPublicRoute,
  summarizeTenantGovernanceDashboard
} from '../../../packages/internal-contracts/src/index.mjs';
import { buildTenantStorageContextIntrospection } from '../../../packages/adapters/src/storage-tenant-context.mjs';

export const tenantApiFamily = getApiFamily('tenants');
export const tenantLifecycleStateMachine = getBusinessStateMachine('tenant_lifecycle');
export const tenantManagementRoutes = filterPublicRoutes({ family: 'tenants' });

export function getTenantRoute(operationId) {
  return getPublicRoute(operationId);
}

export function summarizeTenantManagementSurface({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  storageContext = null,
  generatedAt
}) {
  const dashboard = summarizeTenantGovernanceDashboard({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return {
    family: tenantApiFamily,
    lifecycle: tenantLifecycleStateMachine,
    dashboard,
    routes: tenantManagementRoutes,
    storageContext: storageContext
      ? buildTenantStorageContextIntrospection(
          storageContext?.entityType === 'tenant_storage_context'
            ? storageContext
            : { tenant, ...storageContext, now: generatedAt }
        )
      : null
  };
}

export function previewTenantInventory({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  return buildTenantResourceInventory({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
}

export function previewTenantFunctionalExport({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  return buildTenantFunctionalConfigurationExport({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
}

export function previewTenantLifecycleMutation({
  tenant,
  action,
  workspaces = [],
  managedResources = [],
  now,
  hasElevatedAccess,
  hasSecondConfirmation
}) {
  return evaluateTenantLifecycleMutation({
    tenant,
    action,
    workspaces,
    managedResources,
    now,
    hasElevatedAccess,
    hasSecondConfirmation
  });
}

export function buildTenantPurgeRequestDraft({ tenant, actorUserId = null, approvalTicket = '', confirmationText = '' }) {
  return buildTenantPurgeDraft({ tenant, actorUserId, approvalTicket, confirmationText });
}

/**
 * On-demand, operator-triggered tenant purge handler.
 *
 * This is a pure function (no real HTTP). It re-gates the request through the
 * shared `evaluateTenantLifecycleMutation` contract — never bypassing the
 * retention / export-checkpoint / elevated-access / dual-confirmation guards —
 * and, when allowed, dispatches the purge saga through an injected dispatcher.
 *
 * Wired to the existing public route `purgeTenant`
 * (`POST /v1/tenants/{tenantId}/purge`).
 *
 * Response shape:
 *  - blocked (missing elevated access): { statusCode: 403, body: { blocker } }
 *  - blocked (any other guard, incl. non-deleted tenant): { statusCode: 409, body: { blocker } }
 *  - allowed: { statusCode: 202, body: { operationId, tenantId, status, ... } }
 *
 * @param {Object} input
 * @param {Object} input.tenant
 * @param {string|null} [input.actorUserId]
 * @param {string} [input.approvalTicket]
 * @param {string} [input.confirmationText]
 * @param {boolean} [input.hasElevatedAccess]
 * @param {boolean} [input.hasSecondConfirmation]
 * @param {string} [input.now]
 * @param {Array} [input.workspaces]
 * @param {Array} [input.managedResources]
 * @param {(arg: Object) => Promise<any>} [input.dispatchPurge] injected saga dispatcher
 * @returns {Promise<{ statusCode: number, body: Object }>}
 */
export async function handleTenantPurgeRequest({
  tenant,
  actorUserId = null,
  approvalTicket = '',
  confirmationText = '',
  hasElevatedAccess = false,
  hasSecondConfirmation = false,
  now,
  workspaces = [],
  managedResources = [],
  dispatchPurge = async () => {}
} = {}) {
  const gate = evaluateTenantLifecycleMutation({
    tenant,
    action: 'purge',
    workspaces,
    managedResources,
    now,
    hasElevatedAccess,
    hasSecondConfirmation
  });

  if (!gate.allowed) {
    const statusCode = /elevated access/i.test(gate.blocker ?? '') ? 403 : 409;
    return { statusCode, body: { blocker: gate.blocker, tenantId: tenant?.tenantId ?? null } };
  }

  const draft = buildTenantPurgeDraft({ tenant, actorUserId, approvalTicket, confirmationText });
  const operationId = `aop_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  await dispatchPurge({
    operationId,
    tenantId: tenant?.tenantId ?? null,
    actorUserId,
    approvalTicket: draft.approvalTicket,
    confirmationText: draft.confirmationText,
    requiredControls: gate.requiredControls,
    draft
  });

  return {
    statusCode: 202,
    body: {
      operationId,
      tenantId: tenant?.tenantId ?? null,
      status: 'accepted',
      nextState: gate.nextState,
      requiredControls: gate.requiredControls
    }
  };
}

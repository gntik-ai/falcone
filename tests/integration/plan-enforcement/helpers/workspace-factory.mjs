/**
 * Workspace factory — create workspaces and manage sub-quotas.
 */

import { randomUUID } from 'node:crypto';
import { getSuperadminToken } from './auth.mjs';
import { controlPlaneRequest } from './api-client.mjs';

/**
 * Create a workspace inside a tenant.
 * @param {string} tenantId
 * @param {string} [name]
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function createWorkspace(tenantId, name) {
  const wsName = name ?? `ws-${randomUUID().slice(0, 8)}`;
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest(
    'POST',
    `/api/v1/tenants/${tenantId}/workspaces`,
    { token, body: { name: wsName } },
  );
  if (status >= 400) {
    throw new Error(`createWorkspace failed: ${status} ${JSON.stringify(body)}`);
  }
  return { id: body.id ?? body.workspaceId ?? wsName, name: wsName };
}

/**
 * Assign a sub-quota to a workspace.
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {string} dimension
 * @param {number} value
 */
export async function setSubQuota(tenantId, workspaceId, dimension, value) {
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest(
    'PUT',
    `/api/v1/tenants/${tenantId}/workspaces/${workspaceId}/subquotas/${dimension}`,
    { token, body: { value } },
  );
  if (status >= 400) {
    throw new Error(`setSubQuota failed: ${status} ${JSON.stringify(body)}`);
  }
}

/**
 * Delete a workspace.
 * @param {string} tenantId
 * @param {string} workspaceId
 */
export async function deleteWorkspace(tenantId, workspaceId) {
  try {
    const token = await getSuperadminToken();
    await controlPlaneRequest(
      'DELETE',
      `/api/v1/tenants/${tenantId}/workspaces/${workspaceId}`,
      { token },
    );
  } catch {
    // Idempotent
  }
}

/**
 * Resource factory — create concrete resources for quota-testing.
 */

import { randomUUID } from 'node:crypto';
import { getSuperadminToken } from './auth.mjs';
import { controlPlaneRequest } from './api-client.mjs';

const RESOURCE_PATHS = {
  database: (tid, wid) => `/api/v1/tenants/${tid}/workspaces/${wid}/databases`,
  kafka_topic: (tid, wid) => `/api/v1/tenants/${tid}/workspaces/${wid}/kafka-topics`,
  function: (tid, wid) => `/api/v1/tenants/${tid}/workspaces/${wid}/functions`,
  webhook: (tid, wid) => `/api/v1/tenants/${tid}/workspaces/${wid}/webhooks`,
};

/**
 * @param {string} type
 * @param {string} tenantId
 * @param {string} workspaceId
 * @returns {Promise<{ id: string, type: string }>}
 */
async function createResource(type, tenantId, workspaceId) {
  const pathFn = RESOURCE_PATHS[type];
  if (!pathFn) throw new Error(`Unknown resource type: ${type}`);
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest(
    'POST',
    pathFn(tenantId, workspaceId),
    { token, body: { name: `test-${type}-${randomUUID().slice(0, 8)}` } },
  );
  if (status >= 400) {
    const err = new Error(`createResource(${type}) failed: ${status} ${JSON.stringify(body)}`);
    err.status = status;
    err.body = body;
    throw err;
  }
  return { id: body.id ?? body.resourceId ?? randomUUID(), type };
}

export const createDatabase = (tid, wid) => createResource('database', tid, wid);
export const createKafkaTopic = (tid, wid) => createResource('kafka_topic', tid, wid);
export const createFunction = (tid, wid) => createResource('function', tid, wid);
export const createWebhook = (tid, wid) => createResource('webhook', tid, wid);

/**
 * Delete a specific resource.
 * @param {string} type
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {string} resourceId
 */
export async function deleteResource(type, tenantId, workspaceId, resourceId) {
  const pathFn = RESOURCE_PATHS[type];
  if (!pathFn) return;
  try {
    const token = await getSuperadminToken();
    await controlPlaneRequest(
      'DELETE',
      `${pathFn(tenantId, workspaceId)}/${resourceId}`,
      { token },
    );
  } catch {
    // Idempotent
  }
}

/**
 * Tenant factory — create and teardown test tenants.
 */

import { randomUUID } from 'node:crypto';
import { env } from '../config/test-env.mjs';
import { getSuperadminToken } from './auth.mjs';
import { controlPlaneRequest } from './api-client.mjs';

/** @type {Set<string>} */
const createdTenants = new Set();

/**
 * Create a test tenant with a unique prefixed name.
 * @param {object} [options]
 * @param {string} [options.name]
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function createTestTenant(options = {}) {
  const name = options.name ?? `${env.TEST_TENANT_PREFIX}-${randomUUID()}`;
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest('POST', '/api/v1/tenants', {
    token,
    body: { name },
  });
  if (status < 200 || status >= 300) {
    throw new Error(`Failed to create tenant "${name}": ${status} ${JSON.stringify(body)}`);
  }
  const id = body.id ?? body.tenantId ?? name;
  createdTenants.add(id);
  return { id, name };
}

/**
 * Delete a specific test tenant and all its resources.
 * @param {string} tenantId
 */
export async function deleteTestTenant(tenantId) {
  try {
    const token = await getSuperadminToken();
    await controlPlaneRequest('DELETE', `/api/v1/tenants/${tenantId}`, { token });
  } catch {
    // Idempotent: ignore errors if already deleted.
  }
  createdTenants.delete(tenantId);
}

/**
 * Clean up ALL tenants created during this test run.
 */
export async function cleanupAllTestTenants() {
  const ids = [...createdTenants];
  for (const id of ids) {
    await deleteTestTenant(id);
  }
}

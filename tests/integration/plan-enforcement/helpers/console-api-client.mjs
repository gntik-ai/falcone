/**
 * Console API client — queries the console's JSON endpoints
 * that feed the React UI with entitlement, capability, and quota data.
 */

import { env } from '../config/test-env.mjs';

const MAX_RETRIES = 2;
const BACKOFF_MS = 300;

/**
 * @param {string} path
 * @param {string} token
 * @returns {Promise<{ status: number, body: any }>}
 */
async function consoleGet(path, token) {
  const url = `${env.CONSOLE_API_URL}${path}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const body = await res.json().catch(() => null);
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** attempt));
      continue;
    }
    return { status: res.status, body };
  }
  throw new Error(`consoleGet ${url} exhausted retries`);
}

/**
 * Get the full entitlements object for a tenant.
 * @param {string} tenantId
 * @param {string} token
 */
export function getConsoleEntitlements(tenantId, token) {
  return consoleGet(`/tenants/${tenantId}/entitlements`, token);
}

/**
 * Get capabilities for a tenant.
 * @param {string} tenantId
 * @param {string} token
 */
export function getConsoleCapabilities(tenantId, token) {
  return consoleGet(`/tenants/${tenantId}/capabilities`, token);
}

/**
 * Get quota usage for a tenant.
 * @param {string} tenantId
 * @param {string} token
 */
export function getConsoleQuotas(tenantId, token) {
  return consoleGet(`/tenants/${tenantId}/quotas`, token);
}

/**
 * Get workspace dashboard data.
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {string} token
 */
export function getWorkspaceDashboard(tenantId, workspaceId, token) {
  return consoleGet(`/tenants/${tenantId}/workspaces/${workspaceId}/dashboard`, token);
}

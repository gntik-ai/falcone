/**
 * Override factory — CRUD for tenant-level overrides (numeric and boolean).
 */

import { getSuperadminToken } from './auth.mjs';
import { controlPlaneRequest } from './api-client.mjs';

/**
 * Create a numeric override on a quota dimension.
 * @param {string} tenantId
 * @param {object} opts
 * @param {string} opts.dimension
 * @param {number} opts.value
 * @param {'hard'|'soft'} [opts.type]
 * @param {string} [opts.justification]
 * @param {string} [opts.expiresAt] ISO-8601 timestamp
 * @returns {Promise<{ id: string }>}
 */
export async function createOverride(tenantId, opts) {
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest(
    'POST',
    `/api/v1/tenants/${tenantId}/overrides`,
    {
      token,
      body: {
        kind: 'quota',
        dimension: opts.dimension,
        value: opts.value,
        type: opts.type,
        justification: opts.justification ?? 'test-t06 automated override',
        expiresAt: opts.expiresAt,
      },
    },
  );
  if (status >= 400) {
    throw new Error(`createOverride failed: ${status} ${JSON.stringify(body)}`);
  }
  return { id: body.id ?? body.overrideId };
}

/**
 * Create a boolean capability override.
 * @param {string} tenantId
 * @param {object} opts
 * @param {string} opts.capability
 * @param {boolean} opts.enabled
 * @param {string} [opts.justification]
 * @param {string} [opts.expiresAt]
 * @returns {Promise<{ id: string }>}
 */
export async function createCapabilityOverride(tenantId, opts) {
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest(
    'POST',
    `/api/v1/tenants/${tenantId}/overrides`,
    {
      token,
      body: {
        kind: 'capability',
        capability: opts.capability,
        enabled: opts.enabled,
        justification: opts.justification ?? 'test-t06 automated capability override',
        expiresAt: opts.expiresAt,
      },
    },
  );
  if (status >= 400) {
    throw new Error(`createCapabilityOverride failed: ${status} ${JSON.stringify(body)}`);
  }
  return { id: body.id ?? body.overrideId };
}

/**
 * Revoke a specific override.
 * @param {string} tenantId
 * @param {string} overrideId
 * @param {string} [justification]
 */
export async function revokeOverride(tenantId, overrideId, justification) {
  const token = await getSuperadminToken();
  await controlPlaneRequest(
    'DELETE',
    `/api/v1/tenants/${tenantId}/overrides/${overrideId}`,
    {
      token,
      body: justification ? { justification } : undefined,
    },
  );
}

/**
 * Revoke all overrides for a tenant.
 * @param {string} tenantId
 */
export async function revokeAllOverrides(tenantId) {
  const token = await getSuperadminToken();
  const { body } = await controlPlaneRequest(
    'GET',
    `/api/v1/tenants/${tenantId}/overrides`,
    { token },
  );
  const overrides = Array.isArray(body) ? body : body?.items ?? [];
  for (const ov of overrides) {
    try {
      await revokeOverride(tenantId, ov.id ?? ov.overrideId);
    } catch {
      // Idempotent
    }
  }
}

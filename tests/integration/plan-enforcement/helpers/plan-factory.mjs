/**
 * Plan factory — idempotent creation and assignment of test plans.
 */

import { ALL_TEST_PLANS } from '../config/test-plans.mjs';
import { getSuperadminToken } from './auth.mjs';
import { controlPlaneRequest } from './api-client.mjs';

/**
 * Ensure all three test plans exist in the platform. Idempotent.
 */
export async function ensureTestPlans() {
  const token = await getSuperadminToken();
  for (const plan of ALL_TEST_PLANS) {
    const { status } = await controlPlaneRequest(
      'PUT',
      `/api/v1/plans/${plan.slug}`,
      {
        token,
        body: {
          slug: plan.slug,
          displayName: plan.displayName,
          capabilities: plan.capabilities,
          quotas: plan.quotas,
        },
      },
    );
    if (status >= 400 && status !== 409) {
      throw new Error(`Failed to ensure plan "${plan.slug}": HTTP ${status}`);
    }
  }
}

/**
 * Assign a plan to a tenant.
 * @param {string} tenantId
 * @param {string} planSlug
 */
export async function assignPlan(tenantId, planSlug) {
  const token = await getSuperadminToken();
  const { status, body } = await controlPlaneRequest(
    'PUT',
    `/api/v1/tenants/${tenantId}/plan`,
    { token, body: { planSlug } },
  );
  if (status >= 400) {
    throw new Error(`Failed to assign plan "${planSlug}" to tenant ${tenantId}: ${status} ${JSON.stringify(body)}`);
  }
}

/**
 * Change a tenant's plan (upgrade or downgrade).
 * @param {string} tenantId
 * @param {string} newPlanSlug
 */
export async function changePlan(tenantId, newPlanSlug) {
  return assignPlan(tenantId, newPlanSlug);
}

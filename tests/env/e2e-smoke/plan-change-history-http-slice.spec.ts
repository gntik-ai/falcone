// Playwright API-level E2E for the plan change-history HTTP slice.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (JWT validate + identity-header inject)
//   -> action-runner shim -> provisioning-orchestrator action -> Postgres.
//
// plan-change-history-query returns a tenant's plan-change audit trail. It is
// SUPERADMIN-ONLY: it reads params.callerContext.actor (built by the shim from
// the trusted x-* identity headers APISIX injects) and rejects any actor whose
// type is not 'superadmin'/'internal' with HTTP 403. up.sh seeds tenant A with a
// starter -> pro upgrade trail (an 'initial_assignment' onto e2e-starter-plan and
// an 'upgrade' onto the ACTIVE e2e-pro-plan), so the superadmin read returns
// >= 2 history entries. Tenant A's ACTIVE plan stays e2e-pro-plan.
//
// Run AFTER `tests/env/up.sh`. Uses Playwright's `request` API client only.
import { test, expect, request as pwRequest } from '@playwright/test';

const APISIX = process.env.APISIX_BASE_URL ?? 'http://localhost:9080';
const KC = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:8081';
const REALM = process.env.E2E_REALM ?? 'falcone-e2e';
const CLIENT = process.env.E2E_CLIENT_ID ?? 'falcone-e2e-client';
const USERNAME = process.env.E2E_USERNAME ?? 'e2e-user';
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const SUPER_USERNAME = process.env.E2E_SUPER_USERNAME ?? 'e2e-superadmin';
const SUPER_PASSWORD = process.env.E2E_SUPER_PASSWORD ?? 'e2e-superadmin-password';

const TENANT_A = process.env.E2E_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

async function getAccessToken(username: string, password: string): Promise<string> {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    form: { grant_type: 'password', client_id: CLIENT, username, password },
  });
  expect(res.ok(), `Keycloak token request failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  expect(body.access_token, 'no access_token in Keycloak response').toBeTruthy();
  return body.access_token as string;
}

test.describe('plan change-history HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/plans/change-history?tenantId=${TENANT_A}`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('AUTHZ: tenant_owner is FORBIDDEN (403, superadmin/internal only)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get(`${APISIX}/v1/plans/change-history?tenantId=${TENANT_A}`);
    expect(res.status(), await res.text()).toBe(403);
    await ctx.dispose();
  });

  test('superadmin reads the seeded change trail (200, initial_assignment + upgrade)', async () => {
    const token = await getAccessToken(SUPER_USERNAME, SUPER_PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get(`${APISIX}/v1/plans/change-history?tenantId=${TENANT_A}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBeTruthy();
    expect(body.total).toBeGreaterThanOrEqual(2);
    const directions = body.items.map((x: any) => x.changeDirection);
    expect(directions).toContain('initial_assignment');
    expect(directions).toContain('upgrade');
    await ctx.dispose();
  });
});

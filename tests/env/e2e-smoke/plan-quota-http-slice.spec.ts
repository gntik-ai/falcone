// Playwright API-level E2E for the plan-catalog + quota-dimension HTTP slices.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (JWT validate + identity-header inject)
//   -> action-runner shim -> provisioning-orchestrator actions -> Postgres.
//
// These actions read params.callerContext.actor and require actor.type
// 'superadmin', so the slice uses a dedicated superadmin ROPC user. The shim
// builds callerContext from the trusted x-* identity headers APISIX injects.
//
// Run AFTER `tests/env/up.sh`. Uses Playwright's `request` API client only
// (no browser). Config/env defaults mirror env.sh.
import { test, expect, request as pwRequest } from '@playwright/test';

const APISIX = process.env.APISIX_BASE_URL ?? 'http://localhost:9080';
const KC = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:8081';
const REALM = process.env.E2E_REALM ?? 'falcone-e2e';
const CLIENT = process.env.E2E_CLIENT_ID ?? 'falcone-e2e-client';
const USERNAME = process.env.E2E_USERNAME ?? 'e2e-user';
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';
const SUPER_USERNAME = process.env.E2E_SUPER_USERNAME ?? 'e2e-superadmin';
const SUPER_PASSWORD = process.env.E2E_SUPER_PASSWORD ?? 'e2e-superadmin-password';

async function getAccessToken(username: string, password: string): Promise<string> {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'password',
      client_id: CLIENT,
      username,
      password,
    },
  });
  expect(res.ok(), `Keycloak token request failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  expect(body.access_token, 'no access_token in Keycloak response').toBeTruthy();
  return body.access_token as string;
}

test.describe('plan catalog HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/plans`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('non-superadmin (tenant_owner) is forbidden from creating a plan (403)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.post(`${APISIX}/v1/plans`, {
      data: { slug: 'should-not-exist', displayName: 'Nope' },
    });
    expect(res.status(), await res.text()).toBe(403);
    await ctx.dispose();
  });

  test('superadmin POST creates a plan (201) then GET list returns it', async () => {
    const token = await getAccessToken(SUPER_USERNAME, SUPER_PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const slug = `smoke-plan-pw-${Date.now()}`;
    const create = await ctx.post(`${APISIX}/v1/plans`, {
      data: {
        slug,
        displayName: 'Smoke Plan PW',
        description: 'slice smoke (playwright)',
        quotaDimensions: { max_workspaces: 5 },
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const plan = await create.json();
    expect(plan.id).toBeTruthy();
    expect(plan.slug).toBe(slug);

    const list = await ctx.get(`${APISIX}/v1/plans`);
    expect(list.status(), await list.text()).toBe(200);
    const listed = await list.json();
    const found = (listed.plans ?? []).some(
      (p: { id: string; slug: string }) => p.id === plan.id && p.slug === slug,
    );
    expect(found, `created plan ${plan.id} not present in GET list`).toBeTruthy();

    await ctx.dispose();
  });
});

test.describe('quota dimension catalog HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/quota-dimensions`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('superadmin GET returns the seeded quota dimension catalog (200)', async () => {
    const token = await getAccessToken(SUPER_USERNAME, SUPER_PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/quota-dimensions`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.dimensions)).toBeTruthy();
    // Migration 098 seeds 8 default dimensions.
    expect(body.total).toBeGreaterThanOrEqual(8);
    const keys = (body.dimensions ?? []).map((d: { dimensionKey: string }) => d.dimensionKey);
    expect(keys).toContain('max_workspaces');

    await ctx.dispose();
  });
});

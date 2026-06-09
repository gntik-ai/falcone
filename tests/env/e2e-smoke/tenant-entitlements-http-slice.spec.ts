// Playwright API-level E2E for the tenant effective-entitlements HTTP slice.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (JWT validate + identity-header inject)
//   -> action-runner shim -> provisioning-orchestrator action -> Postgres.
//
// This is the FIRST tenant-scoped (non-superadmin) family in the slice. The
// tenant-effective-entitlements-get action reads params.callerContext.actor
// (built by the shim from the trusted x-* identity headers APISIX injects) and:
//   - a tenant_owner may read ONLY its own tenant; a ?tenantId=<other> is a
//     cross-tenant IDOR attempt rejected with HTTP 403 BEFORE any DB access.
//   - a superadmin may read any tenant (explicit tenantId allowed).
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

// Tenant A is the identity the tenant_owner user is bound to (token claim).
const TENANT_A = process.env.E2E_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
// A DIFFERENT tenant for the cross-tenant IDOR probe. It need not exist: the
// action's authz check fires (403) before any DB access.
const TENANT_B = '22222222-2222-2222-2222-222222222222';

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

test.describe('tenant effective entitlements HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/tenant/entitlements`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('tenant_owner reads its OWN tenant entitlements (200, catalog defaults)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/tenant/entitlements`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    // Unseeded tenant: one catalog_default quantitative limit per dimension, no plan.
    expect(Array.isArray(body.quantitativeLimits)).toBeTruthy();
    expect(body.quantitativeLimits.length).toBeGreaterThan(0);
    expect(body.planSlug).toBeNull();

    await ctx.dispose();
  });

  test('IDOR: tenant_owner is FORBIDDEN from reading ANOTHER tenant (403)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // Cross-tenant read attempt: the explicit tenantId differs from the caller's
    // tenant (TENANT_A). The action throws FORBIDDEN before any DB access.
    const res = await ctx.get(`${APISIX}/v1/tenant/entitlements?tenantId=${TENANT_B}`);
    expect(res.status(), await res.text()).toBe(403);

    await ctx.dispose();
  });

  test('superadmin may read a tenant scoped by explicit tenantId (200)', async () => {
    const token = await getAccessToken(SUPER_USERNAME, SUPER_PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/tenant/entitlements?tenantId=${TENANT_A}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.quantitativeLimits)).toBeTruthy();
    expect(body.quantitativeLimits.length).toBeGreaterThan(0);

    await ctx.dispose();
  });
});

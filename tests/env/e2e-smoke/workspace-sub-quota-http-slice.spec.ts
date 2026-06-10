// Playwright API-level E2E for the workspace sub-quota HTTP slice.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (JWT validate + identity-header inject)
//   -> action-runner shim -> provisioning-orchestrator action -> Postgres.
//
// workspace-sub-quota set/list allocate a per-workspace slice of a tenant quota
// dimension. Tenant-scoped: a tenant_owner may set ONLY within its own tenant
// (a body tenantId != the caller's tenant -> 403). The action resolves the
// tenant's effective limit (tenant A's plan sets max_workspaces=50) and rejects
// an over-limit allocation with 422. The set is idempotent-but-stateful, so the
// "within limit" test accepts any 2xx and checks the stored value.
//
// Run AFTER `tests/env/up.sh`. Uses Playwright's `request` API client only.
import { test, expect, request as pwRequest } from '@playwright/test';

const APISIX = process.env.APISIX_BASE_URL ?? 'http://localhost:9080';
const KC = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:8081';
const REALM = process.env.E2E_REALM ?? 'falcone-e2e';
const CLIENT = process.env.E2E_CLIENT_ID ?? 'falcone-e2e-client';
const USERNAME = process.env.E2E_USERNAME ?? 'e2e-user';
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

const TENANT_A = process.env.E2E_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const WORKSPACE_A = process.env.E2E_WORKSPACE_ID ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
// A DIFFERENT tenant for the cross-tenant IDOR probe (403 fires before any DB).
const TENANT_B = '22222222-2222-2222-2222-222222222222';

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

test.describe('workspace sub-quota HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${APISIX}/v1/workspace-sub-quotas`, {
      data: { tenantId: TENANT_A, workspaceId: WORKSPACE_A, dimensionKey: 'max_workspaces', allocatedValue: 10 },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('tenant_owner sets a sub-quota within the tenant limit (2xx, value=10)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.post(`${APISIX}/v1/workspace-sub-quotas`, {
      data: { tenantId: TENANT_A, workspaceId: WORKSPACE_A, dimensionKey: 'max_workspaces', allocatedValue: 10 },
    });
    // Idempotent-but-stateful: 201 on first create, 200 on re-run.
    expect([200, 201], await res.text()).toContain(res.status());
    const body = await res.json();
    expect(body.dimensionKey).toBe('max_workspaces');
    expect(Number(body.allocatedValue)).toBe(10);
    await ctx.dispose();
  });

  test('LIMIT: an allocation exceeding the tenant effective limit is rejected (422)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.post(`${APISIX}/v1/workspace-sub-quotas`, {
      data: { tenantId: TENANT_A, workspaceId: WORKSPACE_A, dimensionKey: 'max_workspaces', allocatedValue: 999 },
    });
    expect(res.status(), await res.text()).toBe(422);
    await ctx.dispose();
  });

  test('IDOR: tenant_owner cannot set a sub-quota in ANOTHER tenant (403)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.post(`${APISIX}/v1/workspace-sub-quotas`, {
      data: { tenantId: TENANT_B, workspaceId: WORKSPACE_A, dimensionKey: 'max_workspaces', allocatedValue: 10 },
    });
    expect(res.status(), await res.text()).toBe(403);
    await ctx.dispose();
  });

  test('tenant_owner lists sub-quotas and sees the max_workspaces=10 allocation (200)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const res = await ctx.get(`${APISIX}/v1/workspace-sub-quotas?tenantId=${TENANT_A}&workspaceId=${WORKSPACE_A}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBeTruthy();
    const mw = body.items.find((x: any) => x.dimensionKey === 'max_workspaces');
    expect(mw, 'max_workspaces sub-quota present').toBeTruthy();
    expect(Number(mw.allocatedValue)).toBe(10);
    await ctx.dispose();
  });
});

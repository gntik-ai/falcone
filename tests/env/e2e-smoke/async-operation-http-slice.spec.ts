// Playwright API-level E2E for the async-operation + tenant-config HTTP slices.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (JWT validate + identity-header inject)
//   -> action-runner shim -> provisioning-orchestrator actions -> Postgres.
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

async function getAccessToken(): Promise<string> {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'password',
      client_id: CLIENT,
      username: USERNAME,
      password: PASSWORD,
    },
  });
  expect(res.ok(), `Keycloak token request failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  expect(body.access_token, 'no access_token in Keycloak response').toBeTruthy();
  return body.access_token as string;
}

test.describe('async-operation HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/async-operations?queryType=list`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('authenticated POST creates an operation (200) then detail + list return it', async () => {
    const token = await getAccessToken();
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // CREATE — the action's contract returns 200 (not 201) with operationId.
    const create = await ctx.post(`${APISIX}/v1/async-operations`, {
      data: { operation_type: 'tenant.provision' },
    });
    expect(create.status(), await create.text()).toBe(200);
    const op = await create.json();
    expect(op.operationId).toBeTruthy();
    expect(op.status).toBe('pending');

    // DETAIL — scoped to this tenant; returns the created op.
    const detail = await ctx.get(`${APISIX}/v1/async-operations/${op.operationId}?queryType=detail`);
    expect(detail.status(), await detail.text()).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.operationId).toBe(op.operationId);
    expect(detailBody.operationType).toBe('tenant.provision');

    // LIST — the created op appears.
    const list = await ctx.get(`${APISIX}/v1/async-operations?queryType=list`);
    expect(list.status()).toBe(200);
    const listed = await list.json();
    const found = (listed.items ?? []).some((i: { operationId: string }) => i.operationId === op.operationId);
    expect(found, `created operation ${op.operationId} not present in GET list`).toBeTruthy();

    await ctx.dispose();
  });
});

test.describe('tenant-config format-versions HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/admin/config/format-versions`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('authenticated GET returns supported format versions (200)', async () => {
    const token = await getAccessToken();
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/admin/config/format-versions`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(typeof body.current_version).toBe('string');
    expect(Array.isArray(body.versions)).toBeTruthy();
    expect(body.versions.length).toBeGreaterThan(0);

    await ctx.dispose();
  });
});

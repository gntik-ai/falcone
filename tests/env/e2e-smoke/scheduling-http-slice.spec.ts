// Playwright API-level E2E for the scheduling HTTP request-chain slice.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (JWT validate + identity-header inject)
//   -> action-runner shim -> scheduling-management action -> Postgres.
//
// Run AFTER `tests/env/up.sh`. Uses Playwright's `request` API client only
// (no browser): the slice is API-level. Config/env defaults mirror env.sh.
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

test.describe('scheduling HTTP slice @api', () => {
  test('unauthenticated request is rejected by the gateway with 401', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/scheduling/jobs`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('authenticated POST creates a job and GET lists it (201 -> listed)', async () => {
    const token = await getAccessToken();
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // Ensure scheduling is enabled for the workspace (idempotent).
    await ctx.patch(`${APISIX}/v1/scheduling/config`, {
      data: { schedulingEnabled: true, maxActiveJobs: 50, minIntervalSeconds: 60 },
    });

    const name = `pw-smoke-${Date.now()}`;
    const create = await ctx.post(`${APISIX}/v1/scheduling/jobs`, {
      data: {
        name,
        cronExpression: '0 4 * * *',
        targetAction: 'reports/pw',
        payload: { via: 'playwright' },
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const job = await create.json();
    expect(job.jobId).toBeTruthy();
    expect(job.name).toBe(name);
    expect(job.status).toBe('active');

    const list = await ctx.get(`${APISIX}/v1/scheduling/jobs`);
    expect(list.status()).toBe(200);
    const listed = await list.json();
    const found = (listed.items ?? []).some((i: { jobId: string }) => i.jobId === job.jobId);
    expect(found, `created job ${job.jobId} not present in GET list`).toBeTruthy();

    await ctx.dispose();
  });
});

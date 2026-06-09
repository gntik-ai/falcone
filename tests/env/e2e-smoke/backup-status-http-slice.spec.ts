// Playwright API-level E2E for the backup-status HTTP slice.
//
// Drives the REAL chain on docker-compose:
//   Keycloak (ROPC) -> APISIX (PLAIN PROXY, no gateway jwt-auth)
//   -> action-runner shim -> backup-status action -> Postgres.
//
// This is the FIRST family that authenticates IN-ACTION. Unlike every other
// slice family (which trusts the gateway-injected identity headers), the
// /v1/backups/status route is a PLAIN PROXY: the backup-status action reads the
// Bearer token itself and VERIFIES the JWT SIGNATURE against the realm JWKS
// (KEYCLOAK_JWKS_URL on the action-runner container — a JWKS Bearer-JWT
// validator). It then derives tenant + scopes from the token's OWN claims:
//   tenant <- tenant_id ; scopes <- scopes (array) / scope (space-split string).
//
// Authorization matrix (off ?tenant_id=):
//   - tenant_id present -> read:global OR (claim.tenant === tenant_id AND
//     read:own). A DIFFERENT tenant without global -> 403 (cross-tenant IDOR).
//   - tenant_id absent  -> read:global required, else 403 (global view).
//
// e2e-user (tenant A) carries scopes:["backup-status:read:own"];
// e2e-superadmin carries ["backup-status:read:global","backup-status:read:technical"].
// up.sh seeds a tenant-A own row + a tenant-B shared row so these specs prove the
// DATA layer keeps tenants apart. (Legacy note: with an empty snapshots
// table the action returns 200 with deployment_backup_available:false — no
// snapshot seeding is performed). Issuer/audience claim checks are intentionally
// NOT enabled (the JWKS signature is the real gate).
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
// action's authz check fires (403) before any snapshot query.
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

// Decode a JWT's payload (middle segment, base64url) and return its scopes.
function tokenScopes(token: string): string[] {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (Array.isArray(payload.scopes)) return payload.scopes as string[];
  if (typeof payload.scope === 'string') return (payload.scope as string).split(' ');
  return [];
}

test.describe('backup-status HTTP slice (in-action JWKS auth) @api', () => {
  test('minted tenant_owner token carries the scopes claim (backup-status:read:own)', async () => {
    // Keycloak unmanaged-attribute -> claim mapping is finicky; verify empirically
    // that the dedicated `scopes` claim (NOT the gateway actor_scopes claim) lands.
    const token = await getAccessToken(USERNAME, PASSWORD);
    expect(tokenScopes(token)).toContain('backup-status:read:own');
  });

  test('no bearer token: request is rejected 401 by the ACTION (route is a plain proxy)', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${APISIX}/v1/backups/status`);
    // 401 here comes from the backup-status action's own validator, not the
    // gateway: this route has NO openid-connect plugin.
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('tenant_owner reads its OWN tenant backup status (200)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/backups/status?tenant_id=${TENANT_A}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.schema_version).toBe('1');
    // up.sh seeds a tenant-A OWN row -> deployment_backup_available is true and
    // the own component is present.
    expect(body.deployment_backup_available).toBe(true);
    const labels = (body.components ?? []).map((c: any) => c.instance_label);
    expect(labels).toContain('tenant-a-primary-db');
    // DATA-LEAK PROBE: a tenant-B SHARED-instance row is also seeded; a read:own
    // caller (getByTenant includeShared:false + in-action belts) must NOT see it.
    expect(labels).not.toContain('shared-platform-objectstore');

    await ctx.dispose();
  });

  test('IDOR: tenant_owner is FORBIDDEN from reading ANOTHER tenant (403)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // Cross-tenant backup read: the explicit tenant_id differs from the caller's
    // tenant (TENANT_A) and the caller lacks read:global -> 403.
    const res = await ctx.get(`${APISIX}/v1/backups/status?tenant_id=${TENANT_B}`);
    expect(res.status(), await res.text()).toBe(403);

    await ctx.dispose();
  });

  test('SCOPE: tenant_owner global view (no tenant_id) is FORBIDDEN (403, requires read:global)', async () => {
    const token = await getAccessToken(USERNAME, PASSWORD);
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/backups/status`);
    expect(res.status(), await res.text()).toBe(403);

    await ctx.dispose();
  });

  test('superadmin global view (no tenant_id) is allowed (200) and sees own + shared rows', async () => {
    const token = await getAccessToken(SUPER_USERNAME, SUPER_PASSWORD);
    expect(tokenScopes(token)).toContain('backup-status:read:global');
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const res = await ctx.get(`${APISIX}/v1/backups/status`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.schema_version).toBe('1');
    expect(body.tenant_id).toBeNull();
    // Contrast with the read:own caller: a technical-scoped global caller
    // (getAll includeShared:true) DOES see shared rows, so the global view
    // contains BOTH the tenant-A own row and the tenant-B shared row.
    const labels = (body.components ?? []).map((c: any) => c.instance_label);
    expect(labels).toContain('tenant-a-primary-db');
    expect(labels).toContain('shared-platform-objectstore');

    await ctx.dispose();
  });
});

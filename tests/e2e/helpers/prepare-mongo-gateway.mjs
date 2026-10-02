// CI-only setup through public management APIs in the disposable kind stack.
// Persist only resource identifiers; credentials and response bodies stay in memory.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const required = ['CONTROL_PLANE_URL', 'KEYCLOAK_URL', 'SUPERADMIN_CLIENT_ID', 'SUPERADMIN_CLIENT_SECRET', 'GITHUB_ENV'];
for (const name of required) assert.ok(process.env[name], `${name} is required`);
const tokenResponse = await fetch(`${process.env.KEYCLOAK_URL}/realms/in-falcone-platform/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials',
    client_id: process.env.SUPERADMIN_CLIENT_ID, client_secret: process.env.SUPERADMIN_CLIENT_SECRET }),
  signal: AbortSignal.timeout(30_000),
});
assert.equal(tokenResponse.status, 200, 'Mongo fixture admin authentication failed');
const { access_token: token } = await tokenResponse.json();
assert.ok(token, 'Mongo fixture admin token missing');

async function create(path, name) {
  const response = await fetch(`${process.env.CONTROL_PLANE_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.status, 201, `Mongo fixture creation failed: ${path}`);
  const { id } = await response.json();
  assert.ok(typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id), 'Mongo fixture identifier invalid');
  return id;
}

const tenantId = await create('/v1/tenants', `mongo-980-${randomUUID()}`);
const workspaceId = await create(`/v1/tenants/${tenantId}/workspaces`, 'mongo-980-a');
const otherWorkspaceId = await create(`/v1/tenants/${tenantId}/workspaces`, 'mongo-980-b');
appendFileSync(process.env.GITHUB_ENV,
  `FALCONE_MONGO_REALM=${tenantId}\nFALCONE_MONGO_WORKSPACE_ID=${workspaceId}\nFALCONE_MONGO_OTHER_WORKSPACE_ID=${otherWorkspaceId}\n`);

// Live kind gate. CI supplies a disposable tenant realm service account and a
// workspace with Mongo enabled. No credential or response body is logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const settings = {
  gateway: process.env.FALCONE_MONGO_GATEWAY_URL,
  tokenUrl: process.env.FALCONE_MONGO_TOKEN_URL,
  clientId: process.env.FALCONE_MONGO_CLIENT_ID,
  clientSecret: process.env.FALCONE_MONGO_CLIENT_SECRET,
  workspaceId: process.env.FALCONE_MONGO_WORKSPACE_ID,
};
const missing = Object.entries(settings).filter(([, value]) => !value).map(([key]) => key);
if (process.env.FALCONE_MONGO_REQUIRED === 'true' && missing.length) {
  throw new Error(`live kind configuration missing: ${missing.join(', ')}`);
}

test('public APISIX selects Mongo routes and completes a tenant bearer document round trip',
  { skip: missing.length ? `live kind configuration missing: ${missing.join(', ')}` : false }, async () => {
    const tokenResponse = await fetch(settings.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
      }),
    });
    assert.equal(tokenResponse.status, 200, 'tenant realm token request failed');
    const { access_token: token } = await tokenResponse.json();
    assert.ok(token, 'tenant realm did not return an access token');
    const tokenIssuer = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).iss;
    const expectedIssuer = new URL(settings.tokenUrl);
    assert.equal(tokenIssuer, `${expectedIssuer.origin}${expectedIssuer.pathname.replace(/\/protocol\/openid-connect\/token$/, '')}`,
      'Keycloak issued a token for a different host than the configured issuer');

    const collection = `gateway_980_${randomUUID().replaceAll('-', '')}`;
    const docId = randomUUID();
    const path = `/v1/mongo/workspaces/${encodeURIComponent(settings.workspaceId)}`
      + `/data/gateway_980/collections/${collection}/documents`;
    const origin = settings.gateway.replace(/\/$/, '');
    const headers = {
      'X-API-Version': '2026-03-24',
      'X-Correlation-Id': randomUUID(),
    };
    const call = (method, suffix = '', credential = 'bearer', body) => fetch(`${origin}${path}${suffix}`, {
      method,
      headers: {
        ...headers,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(credential === 'bearer' ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const expectStatus = async (promise, status, operation) => {
      const response = await promise;
      assert.equal(response.status, status, `${operation} returned ${response.status}`);
      return response.json();
    };

    const unauthenticated = await call('GET', '', 'none');
    assert.equal(unauthenticated.status, 401, 'unauthenticated request must be rejected by APISIX');
    const unauthenticatedBody = await unauthenticated.text();
    assert.ok(!unauthenticatedBody.includes('NO_ROUTE'));
    const foreignToken = [
      { alg: 'RS256', kid: 'foreign-key' },
      { iss: 'https://foreign.invalid/realms/tenant-a', aud: 'in-falcone', exp: Math.floor(Date.now() / 1000) + 60 },
      'invalid-signature',
    ].map((part) => typeof part === 'string' ? part : Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
    const foreign = await fetch(`${origin}${path}`, {
      headers: { ...headers, authorization: `Bearer ${foreignToken}` },
    });
    assert.equal(foreign.status, 401, 'foreign issuer must be rejected by APISIX');
    assert.ok(!(await foreign.text()).includes('NO_ROUTE'));

    const docPath = `/${encodeURIComponent(docId)}`;
    await expectStatus(call('POST', '', 'bearer', { document: { _id: docId, stage: 'created' } }), 201, 'create');
    try {
      const get = await expectStatus(call('GET', docPath), 200, 'get');
      assert.equal(get.item?._id, docId);
      const list = await expectStatus(call('GET'), 200, 'list');
      assert.ok(list.items?.some((item) => item._id === docId));
      await expectStatus(call('PATCH', docPath, 'bearer', { update: { $set: { stage: 'updated' } } }), 200, 'update');
      const updated = await expectStatus(call('GET', docPath), 200, 'get after update');
      assert.equal(updated.item?.stage, 'updated');
      await expectStatus(call('PUT', docPath, 'bearer', { document: { _id: docId, stage: 'replaced' } }), 200, 'replace');
      const replaced = await expectStatus(call('GET', docPath), 200, 'get after replace');
      assert.equal(replaced.item?.stage, 'replaced');
    } finally {
      await expectStatus(call('DELETE', docPath), 200, 'delete');
    }
  });

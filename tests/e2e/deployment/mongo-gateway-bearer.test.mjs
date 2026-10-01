// Live kind gate. CI supplies a disposable tenant realm service account and
// two registered workspaces with Mongo enabled. No credential or response body is logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const settings = {
  gateway: process.env.FALCONE_MONGO_GATEWAY_URL,
  executor: process.env.FALCONE_MONGO_EXECUTOR_URL,
  tokenUrl: process.env.FALCONE_MONGO_TOKEN_URL,
  clientId: process.env.FALCONE_MONGO_CLIENT_ID,
  wrongAudienceClientId: process.env.FALCONE_MONGO_WRONG_AUDIENCE_CLIENT_ID,
  clientSecret: process.env.FALCONE_MONGO_CLIENT_SECRET,
  workspaceId: process.env.FALCONE_MONGO_WORKSPACE_ID,
  otherWorkspaceId: process.env.FALCONE_MONGO_OTHER_WORKSPACE_ID,
};
const missing = Object.entries(settings).filter(([, value]) => !value).map(([key]) => key);
if (process.env.FALCONE_MONGO_REQUIRED === 'true' && missing.length) {
  throw new Error(`live kind configuration missing: ${missing.join(', ')}`);
}

test('public APISIX selects Mongo routes and completes a tenant bearer document round trip',
  { skip: missing.length ? `live kind configuration missing: ${missing.join(', ')}` : false,
    timeout: 180_000 }, async () => {
    const tokenResponse = await fetch(settings.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(tokenResponse.status, 200, 'tenant realm token request failed');
    const { access_token: token } = await tokenResponse.json();
    assert.ok(token, 'tenant realm did not return an access token');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    const tenantAudience = process.env.FALCONE_MONGO_TENANT_AUDIENCE ?? 'falcone-data-api';
    const audiences = (claims) => Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    assert.ok(audiences(claims).includes(tenantAudience), 'CI tenant token must carry the data API audience');
    assert.equal(claims.workspace_id, settings.workspaceId, 'CI token must bind workspace A');
    assert.ok(claims.realm_access?.roles?.includes('tenant_admin'), 'CI token must permit API-key management');
    assert.notEqual(settings.workspaceId, settings.otherWorkspaceId, 'isolation requires two workspaces');
    const expectedIssuer = new URL(settings.tokenUrl);
    assert.equal(claims.iss, `${expectedIssuer.origin}${expectedIssuer.pathname.replace(/\/protocol\/openid-connect\/token$/, '')}`,
      'Keycloak issued a token for a different host than the configured issuer');

    const collection = `gateway_980_${randomUUID().replaceAll('-', '')}`;
    const docId = randomUUID();
    const pathFor = (workspaceId) => `/v1/mongo/workspaces/${encodeURIComponent(workspaceId)}`
      + `/data/gateway_980/collections/${collection}/documents`;
    const path = pathFor(settings.workspaceId);
    const origin = settings.gateway.replace(/\/$/, '');
    const headers = {
      'X-API-Version': '2026-03-24',
      'X-Correlation-Id': randomUUID(),
    };
    const request = (method, requestPath, credential = 'bearer', body, extraHeaders = {}) => fetch(`${origin}${requestPath}`, {
      method,
      headers: {
        ...headers,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(credential === 'bearer' ? { authorization: `Bearer ${token}` } : {}),
        ...(typeof credential === 'object' ? { apikey: credential.key } : {}),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const call = (method, suffix = '', credential = 'bearer', body, extraHeaders) =>
      request(method, `${path}${suffix}`, credential, body, extraHeaders);
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
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(foreign.status, 401, 'foreign issuer must be rejected by APISIX');
    assert.ok(!(await foreign.text()).includes('NO_ROUTE'));

    const negativeResponse = await fetch(settings.tokenUrl, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials',
        client_id: settings.wrongAudienceClientId, client_secret: settings.clientSecret }),
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(negativeResponse.status, 200, 'negative fixture must be a valid signed tenant token');
    const { access_token: wrongAudienceToken } = await negativeResponse.json();
    assert.ok(wrongAudienceToken, 'negative fixture token missing');
    const negativeClaims = JSON.parse(Buffer.from(wrongAudienceToken.split('.')[1], 'base64url'));
    assert.equal(negativeClaims.iss, claims.iss);
    assert.equal(negativeClaims.azp, tenantAudience, 'negative fixture must cover azp-only audience bypass');
    assert.ok(!audiences(negativeClaims).includes(tenantAudience), 'negative fixture must lack the required aud');
    for (const baseUrl of [origin, settings.executor.replace(/\/$/, '')]) {
      const rejected = await fetch(`${baseUrl}${path}`, {
        headers: { ...headers, authorization: `Bearer ${wrongAudienceToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(rejected.status, 401, 'wrong aud must be rejected at gateway and direct executor');
      assert.ok(!(await rejected.text()).includes('NO_ROUTE'));
    }

    const docPath = `/${encodeURIComponent(docId)}`;
    await expectStatus(call('POST', '', 'bearer', { document: { _id: docId, stage: 'created' } }), 201, 'create');
    try {
      const get = await expectStatus(call('GET', docPath), 200, 'get');
      assert.equal(get.item?._id, docId);
      const crossWorkspace = await request('GET', `${pathFor(settings.otherWorkspaceId)}${docPath}`);
      assert.equal(crossWorkspace.status, 403, 'workspace A token must not read workspace B');
      const deniedBody = await crossWorkspace.text();
      assert.ok(!deniedBody.includes(docId) && !deniedBody.includes('created'), 'workspace denial must not disclose the document');
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

    const keysPath = `/v1/workspaces/${encodeURIComponent(settings.workspaceId)}/api-keys`;
    const issuedKeys = [];
    const issue = async (keyType) => {
      const issued = await expectStatus(request('POST', keysPath, 'bearer', { keyType }), 201, `issue ${keyType} key`);
      assert.ok(typeof issued.key === 'string' && issued.key.startsWith('flc_'), 'API-key issuance did not return a key');
      issuedKeys.push(issued);
      return issued;
    };
    try {
      const anon = await issue('anon');
      const service = await issue('service');
      await expectStatus(call('GET', '', anon), 200, 'API-key executor list');
      const denied = await expectStatus(call('POST', '', anon, { document: { _id: docId } },
        { authorization: `Bearer ${token}` }), 403, 'API-key scope wins even with a valid JWT');
      assert.equal(denied.code, 'INSUFFICIENT_SCOPE');
      assert.equal(denied.requiredScope, 'data:write');

      // x-api-key does not select 2006-key. It must be stripped on the bearer route
      // so the executor cannot switch to this read-only key after JWT verification.
      await expectStatus(call('POST', '', 'bearer', { document: { _id: docId, stage: 'mixed-header' } },
        { 'x-api-key': anon.key }), 201, 'bearer write ignores smuggled x-api-key');
      try {
        const mixed = await expectStatus(call('GET', docPath, 'bearer', undefined,
          { 'x-api-key': 'flc_anon_invalid_gateway_980' }), 200, 'bearer ignores invalid x-api-key');
        assert.equal(mixed.item?._id, docId);
      } finally {
        await expectStatus(call('DELETE', docPath), 200, 'mixed-header document cleanup');
      }

      await expectStatus(call('POST', '', service, { document: { _id: docId, stage: 'service' } }), 201, 'data:write service create');
      try {
        const created = await expectStatus(call('GET', docPath, service), 200, 'service get');
        assert.equal(created.item?.stage, 'service');
      } finally {
        await expectStatus(call('DELETE', docPath, service), 200, 'service delete');
      }

      // 2006-key is 120 requests / 60 seconds. Bound the burst and require a
      // fresh key to succeed afterwards, proving the bucket remains per key.
      const burstStarted = Date.now();
      let rateLimited = false;
      for (let batch = 0; batch < 13 && !rateLimited; batch += 1) {
        const responses = await Promise.all(Array.from({ length: 10 }, () => call('GET', '', anon)));
        for (const response of responses) {
          assert.ok([200, 429].includes(response.status), `API-key burst returned ${response.status}`);
          rateLimited ||= response.status === 429;
          await response.arrayBuffer();
        }
      }
      assert.ok(Date.now() - burstStarted < 60_000, 'API-key burst must fit within one rate-limit window');
      assert.ok(rateLimited, 'API-key route must return 429 after its per-key limit');
      const fresh = await issue('service');
      await expectStatus(call('GET', '', fresh), 200, 'fresh key has an independent rate-limit bucket');
    } finally {
      for (const issued of issuedKeys) {
        await expectStatus(request('DELETE', `${keysPath}/${encodeURIComponent(issued.id)}`), 200, 'revoke CI API key');
      }
    }
  });

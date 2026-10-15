import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin } from '../../apps/control-plane/kc-admin.mjs';

test('listUsers forwards offsets and limits while preserving max-only callers', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return Response.json({ access_token: 'fixture-token', expires_in: 300 });
    }
    urls.push(new URL(url));
    return Response.json([{ id: 'user-201' }]);
  });
  assert.deepEqual(await kcAdmin.listUsers('tenant/realm', { first: 200, max: 201 }), [{ id: 'user-201' }]);
  assert.equal(urls[0].pathname, '/admin/realms/tenant%2Frealm/users');
  assert.equal(urls[0].searchParams.get('first'), '200');
  assert.equal(urls[0].searchParams.get('max'), '201');
  await kcAdmin.listUsers('tenant/realm', { max: 100 });
  assert.equal(urls[1].searchParams.get('max'), '100');
  assert.ok([null, '0'].includes(urls[1].searchParams.get('first')));
  await kcAdmin.listUsers('tenant/realm');
  assert.equal(urls[2].searchParams.get('max'), '100');
});

test('countUsers returns the realm-wide count from the encoded realm endpoint', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return Response.json({ access_token: 'fixture-token', expires_in: 300 });
    }
    assert.equal(new URL(url).pathname, '/admin/realms/tenant%2Frealm/users/count');
    assert.equal(new URL(url).search, '');
    return Response.json(450);
  });
  assert.equal(await kcAdmin.countUsers('tenant/realm'), 450);
});

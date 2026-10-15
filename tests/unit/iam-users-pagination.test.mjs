import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const realm = 'fixture-realm';
const cursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const users = Array.from({ length: 450 }, (_, i) => ({
  id: `user-${i}`, username: `name-${i}`, email: `user-${i}@example.test`,
  firstName: 'First', lastName: 'Last', enabled: true, createdTimestamp: 123,
  requiredActions: ['VERIFY_EMAIL'], attributes: { department: ['support'] },
}));

function fixture(rows = users, identity = { actorType: 'superadmin' }) {
  const calls = [];
  const ctx = {
    params: { realmId: realm }, query: {}, identity,
    pool: { async query() { return { rows: [{ id: 'own-tenant', iam_realm: realm }] }; } },
    kcAdmin: {
      async listUsers(r, { first = 0, max }) {
        calls.push(['list', r, first, max]);
        return rows.slice(first, first + max);
      },
      async countUsers(r) { calls.push(['count', r]); return rows.length; },
      async listUserRealmRoles(r, id) {
        calls.push(['roles', r, id]);
        return [{ name: 'app_user' }, { name: 'default-roles-fixture' }];
      },
    },
  };
  return { ctx, calls, list: () => LOCAL_HANDLERS.iamListUsers(ctx) };
}

test('450 stable users traverse as 200, 200, 50 with no missing or repeated IDs', async () => {
  const f = fixture();
  f.ctx.query['page[size]'] = '200';
  const ids = [];
  for (const expectedSize of [200, 200, 50]) {
    const response = await f.list();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.items.length, expectedSize);
    assert.equal(response.body.total, 450);
    assert.equal(response.body.page.size, 200);
    ids.push(...response.body.items.map(u => u.id));
    const after = response.body.page.after;
    if (expectedSize === 50) assert.equal(after, null);
    else {
      assert.equal(typeof after, 'string');
      assert.match(after, /^[A-Za-z0-9_-]{1,256}$/);
      f.ctx.query['page[after]'] = after;
    }
  }
  assert.deepEqual(ids, users.map(u => u.id));
  assert.equal(new Set(ids).size, 450);
  assert.equal(f.calls.filter(c => c[0] === 'roles').length, 450, 'lookahead rows are not enriched');
});

test('default size is 25, max aliases size, and page[size] takes precedence', async () => {
  for (const [query, size] of [
    [{}, 25], [{ max: '100' }, 100], [{ 'page[size]': '50', max: '100' }, 50],
    [{ 'page[size]': '50', max: 'abc' }, 50],
  ]) {
    const f = fixture();
    f.ctx.query = query;
    const response = await f.list();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.page.size, size);
    assert.equal(response.body.items.length, size);
  }
});

function assertValidation(response, calls) {
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { code: 'VALIDATION_ERROR', message: response.body.message });
  assert.equal(typeof response.body.message, 'string');
  assert.deepEqual(calls, [], 'invalid queries must not reach Keycloak');
}

test('page[size] and max reject non-decimal strings and values outside 1..200', async () => {
  for (const parameter of ['page[size]', 'max']) {
    for (const value of ['0', '201', '-1', '2.5', '1e2', 'abc', '', ' 25', '+25', '25\n']) {
      const f = fixture();
      f.ctx.query[parameter] = value;
      assertValidation(await f.list(), f.calls);
    }
  }
});

test('invalid cursors are rejected before any Keycloak request', async () => {
  const valid = { v: 1, realm, first: 200 };
  for (const value of [
    '', 'not-json', '**', cursor(valid) + '=', 'x'.repeat(257),
    cursor({ ...valid, v: 2 }), cursor({ ...valid, realm: 'another-realm' }),
    ...[-1, 2.5, '200', null, Number.MAX_SAFE_INTEGER + 1].map(first => cursor({ ...valid, first })),
    cursor({ v: 1, realm }), cursor(null), cursor([]), cursor(7),
  ]) {
    const f = fixture();
    f.ctx.query['page[after]'] = value;
    assertValidation(await f.list(), f.calls);
  }
});

test('empty, exact-size and past-the-end windows retain size and end with null', async () => {
  for (const [rows, first, length, total] of [
    [[], 0, 0, 0], [users.slice(0, 200), 0, 200, 200], [users, 999, 0, 450],
    [users, Number.MAX_SAFE_INTEGER, 0, 450],
  ]) {
    const f = fixture(rows);
    f.ctx.query = { 'page[size]': '200', 'page[after]': cursor({ v: 1, realm, first }) };
    const response = await f.list();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.items.length, length);
    assert.equal(response.body.total, total);
    assert.deepEqual(response.body.page, { size: 200, after: null });
  }
});

test('legacy 100 and 200 windows retain the existing user fields and best-effort roles', async () => {
  for (const size of ['100', '200']) {
    const f = fixture();
    f.ctx.query = { 'page[size]': size };
    const response = await f.list();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.items.length, Number(size));
    assert.deepEqual(response.body.items[0], {
      id: 'user-0', userId: 'user-0', realmId: realm, username: 'name-0',
      email: 'user-0@example.test', enabled: true, state: 'active',
      firstName: 'First', lastName: 'Last', createdTimestamp: 123,
      realmRoles: ['app_user'], requiredActions: ['VERIFY_EMAIL'], attributes: { department: ['support'] },
    });
  }
  const f = fixture(users.slice(0, 1));
  f.ctx.kcAdmin.listUserRealmRoles = async () => { throw new Error('role lookup failed'); };
  const response = await f.list();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.items[0].realmRoles, []);
});

test('list and count failures on either window return IAM_LIST_USERS_FAILED without items', async () => {
  for (const method of ['listUsers', 'countUsers']) {
    for (const secondWindow of [false, true]) {
      const f = fixture();
      f.ctx.query = { 'page[size]': '200' };
      if (secondWindow) {
        const first = await f.list();
        assert.equal(first.statusCode, 200);
        assert.equal(typeof first.body.page.after, 'string');
        f.ctx.query['page[after]'] = first.body.page.after;
      }
      f.ctx.kcAdmin[method] = async () => { throw new Error('upstream unavailable'); };
      const response = await f.list();
      assert.equal(response.statusCode, 502);
      assert.deepEqual(response.body, { code: 'IAM_LIST_USERS_FAILED', message: 'upstream unavailable' });
      assert.equal(Object.hasOwn(response.body, 'items'), false);
    }
  }
});

test('cross-tenant owners/admins and denied roles get 403 before validation or Keycloak', async () => {
  for (const identity of [
    { actorType: 'tenant_owner', tenantId: 'other-tenant' },
    { actorType: 'tenant_admin', tenantId: 'other-tenant' },
    { actorType: 'tenant_user', tenantId: 'own-tenant' },
    { actorType: 'workspace_admin', tenantId: 'own-tenant' },
    {},
  ]) {
    for (const query of [
      {}, { 'page[size]': '200' },
      { 'page[after]': cursor({ v: 1, realm: 'own-realm', first: 200 }) },
      { 'page[after]': cursor({ v: 1, realm, first: 200 }) },
      { 'page[size]': 'abc', 'page[after]': '**' },
    ]) {
      const f = fixture(users);
      f.ctx.identity = identity;
      f.ctx.query = query;
      const response = await f.list();
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.code, 'FORBIDDEN');
      assert.deepEqual(f.calls, []);
    }
  }
});

test('owning tenant owner/admin and internal callers can traverse their authorized realm', async () => {
  for (const identity of [
    { actorType: 'tenant_owner', tenantId: 'own-tenant' },
    { actorType: 'tenant_admin', tenantId: 'own-tenant' },
    { actorType: 'internal' },
  ]) {
    const f = fixture(users, identity);
    f.ctx.query = { 'page[after]': cursor({ v: 1, realm, first: 200 }) };
    const response = await f.list();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.items[0].id, 'user-200');
  }
});

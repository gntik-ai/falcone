import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { listFnActivations } from '../../apps/control-plane/tenant-store.mjs';

const actionId = 'fn_aaaaaaaa-aaa';
const identity = { tenantId: 'tenant-a', roles: ['tenant_owner'] };
const timestamp = '2026-01-01T00:00:00.123456Z';
const family = JSON.parse(readFileSync(new URL('../../apps/control-plane-executor/openapi/families/functions.openapi.json', import.meta.url)));
const validateCollection = new Ajv({
  strict: false, formats: { 'date-time': (value) => Number.isFinite(Date.parse(value)) },
}).compile({
  $ref: '#/components/schemas/FunctionActivationCollection',
  components: { schemas: Object.fromEntries(
    ['FunctionActivationCollection', 'FunctionActivation', 'FunctionActivationPage']
      .map((name) => [name, family.components.schemas[name]]),
  ) },
});

function assertCollection(body) {
  // Validate the JSON wire representation (pg timestamps are Date objects).
  assert.ok(validateCollection(JSON.parse(JSON.stringify(body))), JSON.stringify(validateCollection.errors));
}

// PostgreSQL is the system boundary. Keep sub-millisecond values in the database,
// but model pg's default timestamptz parser returning a millisecond Date.
function poolFor(count = 120) {
  const actions = [actionId, 'fn_bbbbbbbb-bbb'].map((resource_id) => ({
    resource_id, tenant_id: 'tenant-a', workspace_id: 'ws-a',
  }));
  const activations = Array.from({ length: count }, (_, index) => ({
    activation_id: `act_${String(index + 1).padStart(4, '0')}`,
    resource_id: actionId, workspace_id: 'ws-a', status: 'success',
    started_at: index < 60 ? timestamp : '2026-01-01T00:00:00.123457Z',
    finished_at: '2026-01-01T00:00:01.000000Z', duration_ms: 1, status_code: 200,
  }));
  activations.push({
    activation_id: 'act_foreign', resource_id: 'fn_bbbbbbbb-bbb', workspace_id: 'ws-a',
    status: 'success', started_at: '2027-01-01T00:00:00.000000Z',
  });
  // Deliberately not in the requested order: ordering must come from SQL.
  return {
    async query(sql, params) {
      if (sql.includes('FROM fn_actions')) {
        return { rows: actions.filter((a) => a.resource_id === params[0]
          && (!sql.includes('tenant_id=$2') || a.tenant_id === params[1])) };
      }
      assert.ok(sql.includes('FROM fn_activations'), `unexpected query: ${sql}`);
      let rows = activations.filter((a) => a.resource_id === params[0]);
      if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: String(rows.length) }] };
      if (sql.includes('(started_at, activation_id) <')) {
        rows = rows.filter((a) => a.started_at < params[1]
          || (a.started_at === params[1] && a.activation_id < params[2]));
      }
      if (sql.includes('ORDER BY started_at DESC')) {
        rows.sort((a, b) => b.started_at.localeCompare(a.started_at)
          || (sql.includes('activation_id DESC') ? b.activation_id.localeCompare(a.activation_id) : 0));
      }
      const limit = sql.match(/LIMIT \$(\d+)/);
      if (limit) rows = rows.slice(0, params[Number(limit[1]) - 1]);
      return { rows: rows.map((a) => ({ ...a,
        started_at: new Date(a.started_at),
        ...(sql.includes('AS cursor_started_at') ? { cursor_started_at: a.started_at } : {}),
      })) };
    },
  };
}

function context(pool, query = {}, overrides = {}) {
  return { pool, query, params: { actionId }, identity, ...overrides };
}

const expectedIds = Array.from({ length: 120 }, (_, i) => `act_${String(120 - i).padStart(4, '0')}`);

test('activation list defaults to the newest 50 and reports the full action total', async () => {
  const result = await FN_HANDLERS.fnActivations(context(poolFor()));
  assert.equal(result.statusCode, 200);
  assertCollection(result.body);
  assert.equal(result.body.page.size, 50);
  assert.equal(result.body.page.total, 120);
  assert.equal(typeof result.body.page.nextCursor, 'string');
  assert.deepEqual(result.body.items.map((a) => a.activationId), expectedIds.slice(0, 50));
});

test('following cursors walks all 120 activations without gaps across tied microsecond timestamps', async () => {
  const pool = poolFor();
  const ids = [];
  let after;
  for (const length of [50, 50, 20]) {
    const query = { 'page[size]': '50', ...(after ? { 'page[after]': after } : {}) };
    const result = await FN_HANDLERS.fnActivations(context(pool, query));
    assert.equal(result.statusCode, 200);
    assertCollection(result.body);
    assert.equal(result.body.page.total, 120);
    assert.equal(result.body.page.size, 50);
    assert.equal(result.body.items.length, length);
    ids.push(...result.body.items.map((a) => a.activationId));
    after = result.body.page.nextCursor;
    if (length === 20) assert.equal(Object.hasOwn(result.body.page, 'nextCursor'), false);
    else {
      const cursor = JSON.parse(Buffer.from(after, 'base64url'));
      assert.equal(cursor.startedAt, length === 50 && ids.length === 50
        ? '2026-01-01T00:00:00.123457Z' : timestamp);
    }
  }
  assert.deepEqual(ids, expectedIds);
});

test('size 10 walks every row while total remains independent of size and cursor', async () => {
  const pool = poolFor();
  const ids = [];
  let after;
  for (let page = 0; page < 12; page++) {
    const result = await FN_HANDLERS.fnActivations(context(pool, {
      'page[size]': '10', ...(after ? { 'page[after]': after } : {}), sort: 'ignored',
    }));
    assert.equal(result.statusCode, 200);
    assertCollection(result.body);
    assert.equal(result.body.page.size, 10);
    assert.equal(result.body.page.total, 120);
    assert.equal(result.body.items.length, 10);
    ids.push(...result.body.items.map((a) => a.activationId));
    after = result.body.page.nextCursor;
    assert.equal(Object.hasOwn(result.body.page, 'nextCursor'), page < 11);
  }
  assert.deepEqual(ids, expectedIds);
});

test('empty and short lists report effective size and exact total without a next cursor', async () => {
  for (const count of [0, 30]) {
    const result = await FN_HANDLERS.fnActivations(context(poolFor(count), { 'page[size]': '50' }));
    assert.equal(result.statusCode, 200);
    assertCollection(result.body);
    assert.equal(result.body.items.length, count);
    assert.deepEqual(result.body.page, { size: 50, total: count });
  }
});

test('invalid page sizes return the standard validation error', async () => {
  for (const size of ['0', '201', '1.5', 'abc', '', ' 50', '1e2', null, 50, ['50']]) {
    const result = await FN_HANDLERS.fnActivations(context(poolFor(), { 'page[size]': size }));
    assert.equal(result.statusCode, 400, `size ${JSON.stringify(size)}`);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
    assert.equal(Object.hasOwn(result.body, 'items'), false);
    assert.equal(Object.hasOwn(result.body, 'page'), false);
  }
});

test('rejects malformed, noncanonical, tampered, wrong-version and foreign-action cursors', async () => {
  const pool = poolFor();
  const first = await FN_HANDLERS.fnActivations(context(pool));
  const valid = first.body.page.nextCursor;
  const cursor = JSON.parse(Buffer.from(valid, 'base64url'));
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const flipped = Buffer.from(valid, 'base64url');
  flipped[0] ^= 1;
  // Alter only unused base64 pad bits: Node decodes this to identical bytes.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  assert.notEqual(valid.length % 4, 0, 'fixture must contain pad bits');
  const noncanonical = valid.slice(0, -1) + alphabet[alphabet.indexOf(valid.at(-1)) + 1];
  assert.deepEqual(Buffer.from(noncanonical, 'base64url'), Buffer.from(valid, 'base64url'));
  const invalid = [
    '', 'garbage', 'a'.repeat(257), valid + '=', noncanonical, flipped.toString('base64url'),
    encode({ ...cursor, v: 2 }), encode({ ...cursor, actionId: 'fn_bbbbbbbb-bbb' }),
    encode({ ...cursor, startedAt: 'not-a-date' }),
    encode({ ...cursor, startedAt: '2026-02-30T00:00:00.123456Z' }),
    encode({ ...cursor, activationId: null }), encode({ ...cursor, activationId: '' }),
    encode({ ...cursor, extra: true }), encode(null), encode([]), null, ['garbage'],
  ];
  for (const after of invalid) {
    const result = await FN_HANDLERS.fnActivations(context(pool, { 'page[after]': after }));
    assert.equal(result.statusCode, 400, `cursor ${JSON.stringify(after)}`);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
  }
  const replay = await FN_HANDLERS.fnActivations(context(pool, { 'page[after]': valid }, {
    params: { actionId: 'fn_bbbbbbbb-bbb' },
  }));
  assert.equal(replay.statusCode, 400);
  assert.equal(replay.body.code, 'VALIDATION_ERROR');
  assert.equal(Object.hasOwn(replay.body, 'items'), false);
});

test('legacy store callers still receive their numeric limit without a paging lookahead', async () => {
  const pool = poolFor();
  assert.equal((await listFnActivations(pool, actionId)).length, 50);
  assert.equal((await listFnActivations(pool, actionId, 7)).length, 7);
});

test('size boundary values are accepted and exact-size lists have no next cursor', async () => {
  for (const size of [1, 200]) {
    const result = await FN_HANDLERS.fnActivations(context(poolFor(size), { 'page[size]': String(size) }));
    assert.equal(result.statusCode, 200);
    assertCollection(result.body);
    assert.equal(result.body.items.length, size);
    assert.deepEqual(result.body.page, { size, total: size });
  }
});

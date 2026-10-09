// bbx-audit-trail-integrity
//
// Black-box coverage for change add-audit-trail-integrity (GitHub #644).
//
// The audit trail recorded only SUCCESSFUL mutating actions, hardcoded
// outcome='succeeded' at read time, excluded secret-access, and was a plain INSERT
// (no tamper-evidence). This change adds: a true `outcome` (write-time, from the
// status), recording of failures/denials, secret-access auditing, and a per-tenant
// append-only hash chain (prev_hash/row_hash) with a pure verifier.
//
// Pure helpers (audit-hash.mjs):  auditCanonical, computeRowHash, verifyAuditChain
// Store (audit-store.mjs):        recordAuditEvent (chain), auditRowToRecord (outcome)
// Writer (audit-writer.mjs):      auditEventForRoute (records failures + outcome), secret handlers
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCanonical, computeRowHash, verifyAuditChain } from '../../apps/control-plane/audit-hash.mjs';
import { recordAuditEvent, recordAuditEventInTransaction, queryAuditEvents, auditRowToRecord } from '../../apps/control-plane/audit-store.mjs';
import { auditEventForRoute, recordRouteAudit, AUDITABLE_LOCAL_HANDLERS } from '../../apps/control-plane/audit-writer.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { routes } from '../../apps/control-plane/routes.mjs';

// ---- pure hash helpers -----------------------------------------------------

test('bbx-audit-hash-01: auditCanonical is stable under key order and camel/snake input', () => {
  const camel = auditCanonical({ id: 'e1', actionType: 'a', actorId: 'u', tenantId: 't', outcome: 'succeeded', createdAt: '2026-06-20T00:00:00.000Z', newState: { b: 1, a: 2 } });
  const snake = auditCanonical({ id: 'e1', action_type: 'a', actor_id: 'u', tenant_id: 't', outcome: 'succeeded', created_at: '2026-06-20T00:00:00.000Z', new_state: { a: 2, b: 1 } });
  assert.equal(camel, snake, 'canonical is key-order independent and accepts both shapes');
});

test('bbx-audit-hash-02: computeRowHash is deterministic and sensitive to inputs', () => {
  const c = auditCanonical({ id: 'e1', actionType: 'a', actorId: 'u', tenantId: 't', outcome: 'succeeded', createdAt: '2026-06-20T00:00:00.000Z', newState: {} });
  assert.equal(computeRowHash(c, 'prev'), computeRowHash(c, 'prev'));
  assert.notEqual(computeRowHash(c, 'prev'), computeRowHash(c, 'other'), 'depends on prevHash');
  assert.match(computeRowHash(c, ''), /^[0-9a-f]{64}$/, 'sha-256 hex');
});

// Build a valid chain of raw rows for a tenant.
function chain(tenantId, n) {
  const rows = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const row = { id: `e${i}`, action_type: `act${i}`, actor_id: 'u', tenant_id: tenantId, outcome: 'succeeded', created_at: `2026-06-20T00:00:0${i}.000Z`, new_state: { i }, prev_hash: prev };
    row.row_hash = computeRowHash(auditCanonical(row), prev);
    prev = row.row_hash;
    rows.push(row);
  }
  return rows;
}

test('bbx-audit-hash-verify-valid: an untampered chain verifies', () => {
  assert.deepEqual(verifyAuditChain(chain('t', 4)), { valid: true, brokenAt: null });
  assert.deepEqual(verifyAuditChain([]), { valid: true, brokenAt: null });
});

test('bbx-audit-hash-genesis: the first record has prevHash === "" and a single-row chain verifies', () => {
  const c = chain('t', 1);
  assert.equal(c[0].prev_hash, '');
  assert.deepEqual(verifyAuditChain(c), { valid: true, brokenAt: null });
});

test('bbx-audit-hash-verify-tamper-content: a modified field is detected at its index', () => {
  const c = chain('t', 4);
  c[2].action_type = 'TAMPERED'; // content changed after hashing
  assert.deepEqual(verifyAuditChain(c), { valid: false, brokenAt: 2 });
});

test('bbx-audit-hash-verify-tamper-link: a broken prev_hash link is detected', () => {
  const c = chain('t', 4);
  c[3].prev_hash = 'deadbeef'; // link no longer matches row 2's row_hash
  assert.deepEqual(verifyAuditChain(c), { valid: false, brokenAt: 3 });
});

test('bbx-audit-hash-per-tenant: verifying only one tenant\'s rows is unbroken by interleaving', () => {
  // Tenant A's chain is independent; verifying A's rows alone is valid.
  const a = chain('ten-a', 3);
  assert.deepEqual(verifyAuditChain(a), { valid: true, brokenAt: null });
});

test('bbx-audit-hash-legacy-prefix: an unhashed prefix never verifies', () => {
  const legacy = { id: 'legacy', prev_hash: null, row_hash: null };
  assert.deepEqual(verifyAuditChain([legacy, ...chain('t', 3)]), { valid: false, brokenAt: 0 });
});

test('bbx-audit-hash-full-log: deletion, reordering and resets identify the first break', () => {
  const rows = chain('t', 6);
  for (const [window, brokenAt] of [
    [rows.slice(2), 0],
    [[...rows.slice(0, 1), ...rows.slice(3)], 1],
    [[...rows.slice(0, 3), rows[5]], 3],
    [[rows[0], rows[2], rows[1], ...rows.slice(3)], 1],
  ]) assert.deepEqual(verifyAuditChain(window), { valid: false, brokenAt });
  const reset = chain('t', 1)[0];
  assert.deepEqual(verifyAuditChain([rows[0], reset]), { valid: false, brokenAt: 1 });
});

test('bbx-audit-hash-window: explicit anchor must match, and every row must be hashed', () => {
  const rows = chain('t', 4);
  assert.deepEqual(verifyAuditChain(rows.slice(2), { expectedAnchor: rows[1].row_hash }), { valid: true, brokenAt: null });
  assert.deepEqual(verifyAuditChain(rows.slice(2), { expectedAnchor: 'wrong-anchor' }), { valid: false, brokenAt: 0 });
  assert.deepEqual(verifyAuditChain([rows[0], { prev_hash: null, row_hash: null }, rows[2]]), { valid: false, brokenAt: 1 });
  assert.deepEqual(verifyAuditChain([{ ...rows[0], prev_hash: null }]), { valid: false, brokenAt: 0 });
});

// ---- store: recordAuditEvent writes a verifiable chain ---------------------

// Minimal pool stub modelling plan_audit_events with the chain columns + a txn.
function chainPool() {
  const audit = [];
  const q = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.startsWith('SELECT row_hash')) {
      const tenantId = params[0];
      const rows = audit.filter((r) => r.tenant_id === tenantId && (!s.includes('row_hash IS NOT NULL') || r.row_hash != null));
      const last = rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))).at(-1);
      return { rows: last ? [last] : [] };
    }
    if (s.includes('INSERT INTO plan_audit_events')) {
      // [id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash]
      const values = [...params];
      values.splice(4, 0, s.includes('$4,NULL,') ? null : values.pop());
      const [id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash] = values;
      const row = { id, action_type, actor_id, tenant_id, plan_id, previous_state: previous_state ? JSON.parse(previous_state) : null, new_state: new_state ? JSON.parse(new_state) : {}, outcome, correlation_id: correlation_id ?? null, created_at, prev_hash, row_hash };
      audit.push(row);
      return { rows: [row] };
    }
    if (s.includes('FROM plan_audit_events')) {
      let rows = audit.filter((r) => r.tenant_id === params[0]);
      if (s.includes("new_state->>'workspaceId' =")) {
        rows = rows.filter((r) => r.new_state.workspaceId === params[1]);
      }
      return { rows: rows.slice().reverse().slice(0, params.at(-1)) };
    }
    return { rows: [] };
  };
  const client = { query: q, release() {} };
  return { query: q, connect: async () => client, _audit: audit };
}

test('bbx-audit-store-chain: recordAuditEvent writes a verifiable per-tenant chain with outcomes', async () => {
  const pool = chainPool();
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'u', tenantId: 'ten-a', outcome: 'succeeded', newState: { a: 1 }, correlationId: 'c1' });
  await recordAuditEvent(pool, { actionType: 'workspace.create', actorId: 'u', tenantId: 'ten-a', outcome: 'denied', newState: { b: 2 }, correlationId: 'c2' });
  await recordAuditEvent(pool, { actionType: 'iam.user.create', actorId: 'u', tenantId: 'ten-a', outcome: 'failed', newState: {}, correlationId: 'c3' });
  const rows = pool._audit;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].prev_hash, '', 'genesis prevHash is empty');
  assert.equal(rows[1].prev_hash, rows[0].row_hash, 'row 1 links to row 0');
  assert.equal(rows[2].prev_hash, rows[1].row_hash, 'row 2 links to row 1');
  assert.deepEqual(rows.map((r) => r.outcome), ['succeeded', 'denied', 'failed']);
  assert.deepEqual(verifyAuditChain(rows), { valid: true, brokenAt: null }, 'the persisted chain verifies');
});

test('bbx-audit-store-null-head: an unhashed latest row cannot reset the chain', async () => {
  const pool = chainPool();
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'owner', tenantId: 't' });
  pool._audit.push({ id: 'legacy', tenant_id: 't', row_hash: null, prev_hash: null });
  await recordAuditEvent(pool, { actionType: 'workspace.create', actorId: 'owner', tenantId: 't' });
  assert.equal(pool._audit[2].prev_hash, pool._audit[0].row_hash);
});

test('bbx-audit-store-plan-id: hashed append preserves the plan reference and states', async () => {
  const pool = chainPool();
  const row = await recordAuditEvent(pool, { actionType: 'plan.updated', actorId: 'admin', planId: 'plan-1', previousState: { status: 'draft' }, newState: { status: 'active' }, correlationId: 'corr' });
  assert.equal(row.plan_id, 'plan-1');
  assert.deepEqual(row.previous_state, { status: 'draft' });
  assert.deepEqual(row.new_state, { status: 'active' });
  assert.deepEqual(verifyAuditChain([row]), { valid: true, brokenAt: null });
});

test('bbx-audit-store-json-state: hashes match persisted JSON including dates and optional fields', async () => {
  const pool = chainPool();
  await recordAuditEvent(pool, { actionType: 'plan.created', actorId: 'admin', newState: { createdAt: new Date('2026-10-09T00:00:00.000Z'), optional: undefined } });
  assert.deepEqual(pool._audit[0].new_state, { createdAt: '2026-10-09T00:00:00.000Z' });
  assert.deepEqual(verifyAuditChain(pool._audit), { valid: true, brokenAt: null });
});

test('bbx-audit-store-order: equal or backwards timestamps cannot fork the append order', async () => {
  const pool = chainPool();
  for (const [id, createdAt] of [
    ['z', '2026-10-09T00:00:00.000Z'],
    ['y', '2026-10-09T00:00:00.000Z'],
    ['x', '2026-10-08T23:59:59.000Z'],
  ]) await recordAuditEventInTransaction(pool, { actionType: 'plan.updated', actorId: 'admin' }, { id, createdAt });
  const rows = pool._audit.slice().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  assert.deepEqual(rows.map((row) => row.id), ['z', 'y', 'x']);
  assert.deepEqual(verifyAuditChain(rows), { valid: true, brokenAt: null });
});

test('bbx-audit-store-record: auditRowToRecord reads outcome from the row and exposes the hashes', () => {
  const rec = auditRowToRecord({ id: 'e1', action_type: 'tenant.create', actor_id: 'u', tenant_id: 't', outcome: 'denied', new_state: {}, created_at: 'now', prev_hash: 'p', row_hash: 'h' });
  assert.equal(rec.result.outcome, 'denied', 'outcome comes from the DB column, not a constant');
  assert.equal(rec.rowHash, 'h');
  assert.equal(rec.prevHash, 'p');
  // a legacy row with no outcome reads as 'unknown'
  assert.equal(auditRowToRecord({ id: 'e0', action_type: 'x', new_state: {} }).result.outcome, 'unknown');
});

// ---- writer: failures/denials recorded, secret-access auditable ------------

const IDENT = { sub: 'u', tenantId: 'ten-a', workspaceId: 'ws-a', actorType: 'tenant_owner' };
const routeFor = (lh, method = 'POST') => ({ method, path: `/x/${lh}`, localHandler: lh });

test('bbx-audit-no-shortcircuit: auditEventForRoute records failures/denials with the derived outcome', () => {
  const ctx = { params: { tenantId: 'ten-a' }, identity: IDENT, body: {} };
  const ok = auditEventForRoute(routeFor('createTenantUser'), ctx, { statusCode: 201, body: {} });
  assert.equal(ok?.outcome, 'succeeded');
  const denied = auditEventForRoute(routeFor('createTenantUser'), ctx, { statusCode: 403, body: {} });
  assert.ok(denied, 'a 403 mutating action now yields a descriptor (was null)');
  assert.equal(denied.outcome, 'denied');
  const failed = auditEventForRoute(routeFor('createTenant'), { params: {}, identity: IDENT, body: {} }, { statusCode: 400, body: {} });
  assert.equal(failed?.outcome, 'failed');
  const errored = auditEventForRoute(routeFor('createTenant'), { params: {}, identity: IDENT, body: {} }, { statusCode: 500, body: {} });
  assert.equal(errored?.outcome, 'error');
  // a read route is still not auditable
  assert.equal(auditEventForRoute({ method: 'GET', path: '/x', localHandler: 'listTenantUsers' }, ctx, { statusCode: 200, body: {} }), null);
});

test('bbx-audit-secret-handlers: secret-access handlers are auditable', () => {
  for (const lh of ['secretSet', 'secretGet', 'secretList', 'secretDelete']) {
    assert.ok(AUDITABLE_LOCAL_HANDLERS[lh], `${lh} is in the auditable set`);
    const desc = auditEventForRoute(routeFor(lh), { params: { workspaceId: 'ws-a' }, identity: IDENT, body: {} }, { statusCode: 200, body: {} });
    assert.ok(desc, `${lh} yields an audit descriptor`);
    assert.equal(desc.tenantId, 'ten-a', `${lh} scoped to the actor tenant`);
  }
});

// Resolved workspace-secret scope (#974). Only the persistence/vault boundaries are faked;
// the real handlers and writer must attribute bodyless, collection, and error responses.
const SECRET_ADMIN = { actorType: 'superadmin', sub: 'platform-admin' };
const SECRET_OWNER = { actorType: 'tenant_owner', sub: 'owner', tenantId: 'ten-a' };
const SECRET_META = { secretName: 'api_key', name: 'api_key', timestamps: { createdAt: null, updatedAt: null } };
const SECRET_META_BODY = '{"secretName":"api_key","name":"api_key","tenantId":"ten-a","workspaceId":"ws-a","resolvedRefCount":0,"timestamps":{"createdAt":null,"updatedAt":null}}';

function secretContext({ identity = SECRET_ADMIN, body = {}, params = {}, vault = {} } = {}) {
  return {
    pool: {}, identity, body, params: { workspaceId: 'ws-a', secretName: 'api_key', ...params },
    store: {
      async getWorkspace() { return { id: 'ws-a', tenant_id: 'ten-a' }; },
      async listFnActions() { return []; },
    },
    vaultStore: {
      validName: (name) => /^[a-z][a-z0-9_-]{0,62}$/.test(String(name ?? '')),
      async exists() { return false; },
      async set() { return SECRET_META; },
      async replace() { return SECRET_META; },
      async list() { return [SECRET_META]; },
      async getMeta() { return SECRET_META; },
      async delete() {},
      ...vault,
    },
  };
}

function secretDescriptor(handler, ctx, result) {
  assert.ok(!JSON.stringify(result.body).includes('auditScope'), 'audit scope is internal to dispatch');
  assert.deepEqual(result.headers ?? {}, {}, 'secret routes retain their existing response headers');
  return auditEventForRoute(routes.find((r) => r.localHandler === handler), ctx, result);
}

test('bbx-974-list: superadmin collection and vault error belong to the resolved workspace', async () => {
  for (const [vault, status, outcome, body] of [
    [{}, 200, 'succeeded', `{"items":[${SECRET_META_BODY}],"page":{"size":1}}`],
    [{ async list() { throw new Error('vault unavailable'); } }, 502, 'error', '{"code":"SECRET_LIST_FAILED","message":"vault unavailable"}'],
  ]) {
    const ctx = secretContext({ vault, params: { workspaceId: 'workspace-alias' }, body: { tenantId: 'forged', workspaceId: 'forged' } });
    const result = await FN_HANDLERS.secretList(ctx);
    assert.equal(result.statusCode, status);
    assert.equal(JSON.stringify(result.body), body, 'HTTP body stays byte-identical');
    const desc = secretDescriptor('secretList', ctx, result);
    assert.ok(desc, 'superadmin list must yield an audit descriptor');
    assert.deepEqual(result.auditScope, { tenantId: 'ten-a', workspaceId: 'ws-a' });
    assert.deepEqual([desc.tenantId, desc.workspaceId, desc.actorId, desc.actionType, desc.outcome],
      ['ten-a', 'ws-a', 'platform-admin', 'workspace.secret.list', outcome]);
  }
});

test('bbx-974-set: superadmin create, duplicate, validation and vault errors retain verified scope', async () => {
  for (const [body, vault, status, outcome, responseBody] of [
    [{ secretName: 'api_key', secretValue: 'sentinel-974' }, {}, 201, 'succeeded', SECRET_META_BODY],
    [{ secretName: 'api_key', secretValue: 'sentinel-974' }, { async exists() { return true; } }, 409, 'failed', '{"code":"SECRET_ALREADY_EXISTS","message":"secret api_key already exists; use PUT to replace it"}'],
    [{ secretName: 'INVALID', secretValue: 'sentinel-974' }, {}, 400, 'failed', '{"code":"VALIDATION_ERROR","message":"secret name must match ^[a-z][a-z0-9_-]{0,62}$"}'],
    [{ secretName: 'api_key', secretValue: '' }, {}, 400, 'failed', '{"code":"VALIDATION_ERROR","message":"secret value is required"}'],
    [{ secretName: 'api_key', secretValue: 'x'.repeat(65536) }, {}, 413, 'failed', '{"code":"VALUE_TOO_LARGE","message":"secret value exceeds 65535 characters"}'],
    [{ secretName: 'api_key', secretValue: 'sentinel-974' }, { async set() { throw new Error('vault unavailable'); } }, 502, 'error', '{"code":"SECRET_WRITE_FAILED","message":"vault unavailable"}'],
  ]) {
    const ctx = secretContext({ body: { tenantId: 'forged', workspaceId: 'forged', ...body }, vault });
    const result = await FN_HANDLERS.secretSet(ctx);
    assert.equal(result.statusCode, status);
    assert.equal(JSON.stringify(result.body), responseBody);
    assert.deepEqual(result.auditScope, { tenantId: 'ten-a', workspaceId: 'ws-a' });
    const desc = secretDescriptor('secretSet', ctx, result);
    assert.deepEqual([desc?.tenantId, desc?.workspaceId, desc?.actorId, desc?.actionType, desc?.outcome],
      ['ten-a', 'ws-a', 'platform-admin', 'workspace.secret.set', outcome]);
    assert.ok(!JSON.stringify(desc).includes('sentinel-974'));
  }
});

test('bbx-974-get: superadmin metadata, missing secret and vault error retain verified scope', async () => {
  for (const [vault, status, outcome, body] of [
    [{}, 200, 'succeeded', SECRET_META_BODY],
    [{ async getMeta() { return null; } }, 404, 'failed', '{"code":"SECRET_NOT_FOUND","message":"secret api_key not found"}'],
    [{ async getMeta() { throw new Error('vault unavailable'); } }, 502, 'error', '{"code":"SECRET_READ_FAILED","message":"vault unavailable"}'],
  ]) {
    const ctx = secretContext({ vault });
    const result = await FN_HANDLERS.secretGet(ctx);
    assert.equal(result.statusCode, status);
    assert.equal(JSON.stringify(result.body), body);
    assert.deepEqual(result.auditScope, { tenantId: 'ten-a', workspaceId: 'ws-a' });
    const desc = secretDescriptor('secretGet', ctx, result);
    assert.deepEqual([desc?.tenantId, desc?.workspaceId, desc?.actorId, desc?.actionType, desc?.outcome],
      ['ten-a', 'ws-a', 'platform-admin', 'workspace.secret.get', outcome]);
  }
});

test('bbx-974-delete: superadmin bodyless success, missing secret, validation and vault errors retain verified scope', async () => {
  for (const [params, vault, status, outcome, body] of [
    [{}, { async exists() { return true; } }, 204, 'succeeded', 'null'],
    [{}, {}, 404, 'failed', '{"code":"SECRET_NOT_FOUND","message":"secret api_key not found"}'],
    [{ secretName: 'INVALID' }, {}, 400, 'failed', '{"code":"VALIDATION_ERROR","message":"secret name must match ^[a-z][a-z0-9_-]{0,62}$"}'],
    [{}, { async exists() { return true; }, async delete() { throw new Error('vault unavailable'); } }, 502, 'error', '{"code":"SECRET_DELETE_FAILED","message":"vault unavailable"}'],
  ]) {
    const ctx = secretContext({ params, vault });
    const result = await FN_HANDLERS.secretDelete(ctx);
    assert.equal(result.statusCode, status);
    assert.equal(JSON.stringify(result.body), body);
    const desc = secretDescriptor('secretDelete', ctx, result);
    assert.ok(desc, 'superadmin delete must yield an audit descriptor');
    assert.deepEqual(result.auditScope, { tenantId: 'ten-a', workspaceId: 'ws-a' });
    assert.deepEqual([desc.tenantId, desc.workspaceId, desc.actorId, desc.actionType, desc.outcome],
      ['ten-a', 'ws-a', 'platform-admin', 'workspace.secret.delete', outcome]);
  }
});

test('bbx-974-sequence: superadmin and tenant-owner operations yield the same tenant-visible, value-free audit trail', async () => {
  const expected = [
    ['workspace.secret.set', 'succeeded', 'ten-a', 'ws-a'],
    ['workspace.secret.get', 'succeeded', 'ten-a', 'ws-a'],
    ['workspace.secret.list', 'succeeded', 'ten-a', 'ws-a'],
    ['workspace.secret.set', 'failed', 'ten-a', 'ws-a'],
    ['workspace.secret.delete', 'succeeded', 'ten-a', 'ws-a'],
    ['workspace.secret.delete', 'failed', 'ten-a', 'ws-a'],
  ];
  for (const identity of [SECRET_ADMIN, SECRET_OWNER]) {
    const pool = chainPool();
    let present = false;
    const vault = {
      async exists() { return present; },
      async set() { present = true; return SECRET_META; },
      async delete() { present = false; },
    };
    const descriptors = [];
    const operations = [
      ['secretSet', 201], ['secretGet', 200], ['secretList', 200],
      ['secretSet', 409], ['secretDelete', 204], ['secretDelete', 404],
    ];
    for (const [handler, status] of operations) {
      const ctx = secretContext({ identity, vault, body: { secretName: 'api_key', secretValue: 'sentinel-974' } });
      const result = await FN_HANDLERS[handler](ctx);
      assert.equal(result.statusCode, status);
      assert.ok(!JSON.stringify(result.body).includes('auditScope'));
      assert.ok(!JSON.stringify(result.headers ?? {}).includes('auditScope'));
      const desc = secretDescriptor(handler, ctx, result);
      assert.equal(desc?.actorId, identity.sub);
      assert.ok(!JSON.stringify(desc).includes('sentinel-974'));
      descriptors.push([desc.actionType, desc.outcome, desc.tenantId, desc.workspaceId]);
      await recordRouteAudit(pool, routes.find((r) => r.localHandler === handler), ctx, result, 'corr-974');
    }
    assert.deepEqual(descriptors, expected);
    const rows = await queryAuditEvents(pool, { tenantId: 'ten-a', workspaceId: 'ws-a' });
    assert.deepEqual(rows.map((r) => [r.action_type, r.outcome, r.tenant_id, r.new_state.workspaceId]).reverse(), expected);
    assert.ok(rows.every((r) => r.actor_id === identity.sub));
    assert.ok(!JSON.stringify(rows).includes('sentinel-974'), 'no persisted column carries the value');
    assert.equal((await queryAuditEvents(pool, { tenantId: 'ten-a' })).length, 6);
    assert.deepEqual(await queryAuditEvents(pool, { tenantId: 'ten-b', workspaceId: 'ws-a' }), []);
    assert.deepEqual(await queryAuditEvents(pool, { tenantId: 'ten-a', workspaceId: 'ws-b' }), []);
  }
});

test('bbx-974-isolation: a foreign workspace never supplies audit scope or leaks its owning tenant', async () => {
  for (const handler of ['secretSet', 'secretReplace', 'secretGet', 'secretList', 'secretDelete']) {
    const ctx = secretContext({
      identity: { actorType: 'tenant_member', sub: 'outsider', tenantId: 'ten-b' },
      body: { secretName: 'api_key', secretValue: 'sentinel-974', tenantId: 'ten-a' },
    });
    const result = await FN_HANDLERS[handler](ctx);
    assert.equal(result.statusCode, 404);
    assert.equal(JSON.stringify(result.body), '{"code":"WORKSPACE_NOT_FOUND","message":"workspace ws-a not found"}');
    assert.equal(result.auditScope, undefined);
    assert.notEqual(secretDescriptor(handler, ctx, result)?.tenantId, 'ten-a');
  }
});

test('bbx-974-denied: own-tenant forbidden mutations retain resolved scope and existing role-gate response', async () => {
  for (const handler of ['secretSet', 'secretDelete']) {
    const ctx = secretContext({ identity: { actorType: 'tenant_member', sub: 'member', tenantId: 'ten-a' } });
    const result = await FN_HANDLERS[handler](ctx);
    assert.equal(result.statusCode, 403);
    assert.equal(JSON.stringify(result.body), '{"code":"FORBIDDEN","message":"requires superadmin or tenant owner/admin"}');
    assert.deepEqual(result.auditScope, { tenantId: 'ten-a', workspaceId: 'ws-a' });
    assert.equal(secretDescriptor(handler, ctx, result)?.outcome, 'denied');
  }
});

test('bbx-974-replace-body: the fifth secret route keeps its existing body and headers without audit scope', async () => {
  const ctx = secretContext({ vault: { async exists() { return true; } }, body: { secretValue: 'sentinel-974' } });
  const result = await FN_HANDLERS.secretReplace(ctx);
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.stringify(result.body), SECRET_META_BODY);
  assert.deepEqual(result.headers ?? {}, {});
  assert.equal(secretDescriptor('secretReplace', ctx, result), null, 'PUT audit allow-list is a separate issue');
});

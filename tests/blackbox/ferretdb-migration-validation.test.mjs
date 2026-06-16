// Black-box suite for change add-ferretdb-migration-validation.
//
// Drives the public surface of the document-parity checker (checkParity) and the per-tenant
// smoke orchestrator (runSmoke) with injected dependencies, so the pass/fail (exit-code),
// waiver, and finding logic is deterministic without a live FerretDB backend. The real-stack
// assertions run via tests/env/validation/run-ferretdb-validation.sh against FerretDB v2.
//
// Parity:
//   bbx-fdb-val-A  100% parity (count+checksum) -> ok
//   bbx-fdb-val-B  missing namespace -> not ok, ref in missing[]
//   bbx-fdb-val-C  count mismatch -> not ok, expected/actual count reported
//   bbx-fdb-val-D  checksum mismatch -> not ok, expected/actual checksum reported
//   bbx-fdb-val-E  reviewed exception suppresses a known discrepancy
//   bbx-fdb-val-F  engine-agnostic checksum: key order + BSON number wrappers don't matter
// Smoke:
//   bbx-fdb-val-G  full pass -> ok, waivers + findings recorded, cross-tenant denied
//   bbx-fdb-val-H  supported aggregation must be 200 (no waiver) — a non-200 fails the gate
//   bbx-fdb-val-I  cross-database $lookup must be exactly Location40321
//   bbx-fdb-val-J  cross-tenant leak (A reads B) fails the gate
//   bbx-fdb-val-K  transaction commit must be exactly 59; abort must be a silent no-op
//   bbx-fdb-val-L  CDC watch/preAndPostImages must be exactly 115 / 40415
//   bbx-fdb-val-M  unique index must enforce E11000
//   bbx-fdb-val-N  isolation gap: read must SUCCEED; an unexpected denial is a new finding

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkParity, canon, digestDocuments } from '../../tests/env/validation/ferretdb-parity-check.mjs';
import { runSmoke } from '../../tests/env/validation/ferretdb-smoke-data-api.mjs';

const manifest = [
  { db: 'shop', collection: 'orders', documentCount: 2, checksum: 'aaa' },
  { db: 'shop', collection: 'products', documentCount: 1, checksum: 'bbb' },
];
// Injected live reader: returns the state the test wants the FerretDB destination to hold.
const liveFrom = (map) => async (entry) => map[`${entry.db}.${entry.collection}`] ?? null;

test('bbx-fdb-val-A: 100% parity -> report.ok true, no discrepancies', async () => {
  const report = await checkParity({
    manifest,
    getLiveState: liveFrom({ 'shop.orders': { documentCount: 2, checksum: 'aaa' }, 'shop.products': { documentCount: 1, checksum: 'bbb' } }),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.mismatched, []);
});

test('bbx-fdb-val-B: missing namespace -> report.ok false, ref in missing[]', async () => {
  const report = await checkParity({
    manifest,
    getLiveState: liveFrom({ 'shop.orders': { documentCount: 2, checksum: 'aaa' } }), // products missing
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ['shop.products']);
});

test('bbx-fdb-val-C: count mismatch -> report.ok false, expected/actual count reported', async () => {
  const report = await checkParity({
    manifest,
    getLiveState: liveFrom({ 'shop.orders': { documentCount: 1, checksum: 'aaa' }, 'shop.products': { documentCount: 1, checksum: 'bbb' } }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.mismatched.length, 1);
  assert.equal(report.mismatched[0].ref, 'shop.orders');
  assert.equal(report.mismatched[0].expectedCount, 2);
  assert.equal(report.mismatched[0].actualCount, 1);
});

test('bbx-fdb-val-D: checksum mismatch -> report.ok false, expected/actual checksum reported', async () => {
  const report = await checkParity({
    manifest,
    getLiveState: liveFrom({ 'shop.orders': { documentCount: 2, checksum: 'aaa' }, 'shop.products': { documentCount: 1, checksum: 'WRONG' } }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.mismatched.length, 1);
  assert.deepEqual(report.mismatched[0], { ref: 'shop.products', expectedChecksum: 'bbb', actualChecksum: 'WRONG' });
});

test('bbx-fdb-val-E: reviewed exception suppresses a known discrepancy -> report.ok true', async () => {
  const report = await checkParity({
    manifest,
    getLiveState: liveFrom({ 'shop.orders': { documentCount: 2, checksum: 'aaa' } }), // products missing
    exceptions: new Set(['shop.products']),
  });
  assert.equal(report.ok, true);
  assert.equal(report.acceptedExceptions.length, 1);
  assert.equal(report.acceptedExceptions[0].ref, 'shop.products');
});

test('bbx-fdb-val-F: checksum is engine-agnostic (key order + BSON number wrappers normalised)', () => {
  // canon sorts object keys recursively and collapses BSON number wrappers to plain numbers.
  assert.deepEqual(canon({ b: 1, a: { d: 4, c: 3 } }), { a: { c: 3, d: 4 }, b: 1 });
  assert.equal(canon({ $numberInt: '5' }), 5);
  assert.equal(canon({ $numberLong: '9' }), 9);
  // Same logical documents differing only in field order + int32-vs-int64 storage -> same digest.
  const mongoStyle = [{ _id: 1, qty: { $numberInt: '7' }, name: 'a' }];
  const ferretStyle = [{ name: 'a', _id: 1, qty: { $numberLong: '7' } }];
  assert.equal(digestDocuments(mongoStyle), digestDocuments(ferretStyle));
});

// ---- smoke orchestration (runSmoke) — deterministic via injected api -----------------------

const tenants = [
  { id: 'val_ten_a', workspaceId: 'wsA', collection: 'val_notes' },
  { id: 'val_ten_b', workspaceId: 'wsB', collection: 'val_notes' },
];
const quietLog = () => {};

// Fully-passing FerretDB v2 profile — the codeName strings FerretDB actually returns
// (live-verified); each is one of the ADR14_CODES accepted forms. Override per test.
function fakeApi(overrides = {}) {
  const base = {
    crud: async (op) => ({ statusCode: op === 'insert' ? 201 : op === 'cross-list' ? 403 : op === 'cross-get' ? 404 : 200 }),
    aggregate: async (ctx) => (ctx.kind === '$lookup-cross-db' ? { errorCode: 'Location40321' } : { statusCode: 200 }),
    index: async (kind) => (kind === 'unique' ? { errorCode: 11000, message: 'E11000 duplicate key error' } : { ok: true }),
    transaction: async (kind) => (kind === 'commit' ? { errorCode: 'CommandNotFound' } : { dataPresentAfterAbort: true }),
    changeStream: async (kind) => (kind === 'watch' ? { errorCode: 'CommandNotSupported' } : { errorCode: 'UnknownBsonField' }),
    isolationRead: async () => ({ read: true }),
  };
  return { ...base, ...overrides };
}

test('bbx-fdb-val-G: full pass -> ok, waivers + findings recorded, cross-tenant denied', async () => {
  const result = await runSmoke({ tenants, api: fakeApi(), log: quietLog });
  assert.equal(result.ok, true);
  assert.equal(result.perTenant.length, 2);
  assert.equal(result.crossTenant, 'denied');
  assert.equal(result.isolationGap, 'confirmed-gap');
  // Deterministic-failure outcomes are recorded as ADR-14 waivers, not failures.
  assert.ok(result.waivers.some((w) => /CommandNotFound 59/.test(w)));
  assert.ok(result.waivers.some((w) => /CommandNotSupported 115/.test(w)));
  assert.ok(result.waivers.some((w) => /40415/.test(w)));
  assert.ok(result.waivers.some((w) => /Location40321/.test(w)));
  // Data-integrity + isolation findings are recorded.
  assert.ok(result.findings.some((f) => /abort did NOT roll back/.test(f)));
  assert.ok(result.findings.some((f) => /ISOLATION-GAP/.test(f)));
  assert.deepEqual(result.failures, []);
});

test('bbx-fdb-val-H: supported aggregation must be 200 — a non-200 fails the gate (no waiver)', async () => {
  const api = fakeApi({ aggregate: async (ctx) => (ctx.kind === '$lookup' ? { statusCode: 500 } : ctx.kind === '$lookup-cross-db' ? { errorCode: 'Location40321' } : { statusCode: 200 }) });
  const result = await runSmoke({ tenants, api, log: quietLog });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => /aggregation \$lookup expected 200/.test(f)));
});

test('bbx-fdb-val-I: cross-database $lookup must be exactly Location40321', async () => {
  const api = fakeApi({ aggregate: async (ctx) => (ctx.kind === '$lookup-cross-db' ? { errorCode: 'SomeOtherError' } : { statusCode: 200 }) });
  const result = await runSmoke({ tenants, api, log: quietLog });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => /cross-db \$lookup expected Location40321/.test(f)));
});

test('bbx-fdb-val-J: cross-tenant leak (A reads B) fails the gate and is marked LEAKED', async () => {
  const api = fakeApi({ crud: async (op) => ({ statusCode: op === 'insert' ? 201 : 200 }) }); // cross probes return 200 = leak
  const result = await runSmoke({ tenants, api, log: quietLog });
  assert.equal(result.ok, false);
  assert.equal(result.crossTenant, 'LEAKED');
  assert.ok(result.failures.some((f) => /cross-tenant cross-list not denied/.test(f)));
});

test('bbx-fdb-val-K: transaction commit must be exactly 59; abort must be a silent no-op', async () => {
  const wrongCommit = await runSmoke({ tenants, api: fakeApi({ transaction: async (kind) => (kind === 'commit' ? { errorCode: 251 } : { dataPresentAfterAbort: true }) }), log: quietLog });
  assert.equal(wrongCommit.ok, false);
  assert.ok(wrongCommit.failures.some((f) => /transaction commit expected CommandNotFound 59/.test(f)));

  const rolledBack = await runSmoke({ tenants, api: fakeApi({ transaction: async (kind) => (kind === 'commit' ? { errorCode: 'CommandNotFound' } : { dataPresentAfterAbort: false }) }), log: quietLog });
  assert.equal(rolledBack.ok, false);
  assert.ok(rolledBack.failures.some((f) => /abort probe/.test(f)));
});

test('bbx-fdb-val-L: CDC watch/preAndPostImages must be exactly 115 / 40415', async () => {
  const api = fakeApi({ changeStream: async (kind) => (kind === 'watch' ? { errorCode: 26 } : { errorCode: 'UnknownBsonField' }) });
  const result = await runSmoke({ tenants, api, log: quietLog });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => /cdc watch\(\) expected CommandNotSupported 115/.test(f)));
});

test('bbx-fdb-val-M: unique index must enforce E11000', async () => {
  const api = fakeApi({ index: async (kind) => (kind === 'unique' ? { ok: false, errorCode: 'no-violation' } : { ok: true }) });
  const result = await runSmoke({ tenants, api, log: quietLog });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => /unique index expected E11000/.test(f)));
});

test('bbx-fdb-val-N: isolation gap read must SUCCEED; an unexpected denial is a new finding', async () => {
  const api = fakeApi({ isolationRead: async () => ({ read: false }) });
  const result = await runSmoke({ tenants, api, log: quietLog });
  assert.equal(result.ok, false);
  assert.equal(result.isolationGap, 'unexpected-denial');
  assert.ok(result.failures.some((f) => /isolation-gap probe/.test(f)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverride, modifyOverride, revokeOverride, listOverrides, expireOverrides } from '../../packages/provisioning-orchestrator/src/repositories/quota-override-repository.mjs';

test('create propagates a database failure instead of returning an unsaved override', async () => {
  const failure = new Error('database unavailable');
  const db = { async query() { throw failure; } };
  await assert.rejects(createOverride(db, {
    tenantId: 'tenant', dimensionKey: 'max_pg_databases', overrideValue: 10,
    justification: 'pilot', createdBy: 'admin',
  }), error => error === failure);
  assert.equal(Object.hasOwn(db, '_quotaOverrides'), false);
  assert.equal(Object.hasOwn(db, '_planAuditEvents'), false);
});

test('modify consults the database and propagates its failure', async () => {
  const failure = new Error('database unavailable');
  const db = { async query() { throw failure; } };
  await assert.rejects(modifyOverride(db, { overrideId: 'unknown', actorId: 'admin', justification: 'pilot', changes: { overrideValue: 12 } }), error => error === failure);
  assert.equal(Object.hasOwn(db, '_quotaOverrides'), false);
  assert.equal(Object.hasOwn(db, '_planAuditEvents'), false);
});

test('revoke consults the database and propagates its failure', async () => {
  const failure = new Error('database unavailable');
  const db = { async query() { throw failure; } };
  await assert.rejects(revokeOverride(db, { overrideId: 'unknown', actorId: 'admin', justification: 'pilot' }), error => error === failure);
  assert.equal(Object.hasOwn(db, '_quotaOverrides'), false);
  assert.equal(Object.hasOwn(db, '_planAuditEvents'), false);
});

test('list propagates database failure instead of reporting an empty page', async () => {
  const failure = new Error('database unavailable');
  const db = { async query() { throw failure; } };
  await assert.rejects(listOverrides(db), error => error === failure);
  assert.equal(Object.hasOwn(db, '_quotaOverrides'), false);
  assert.equal(Object.hasOwn(db, '_planAuditEvents'), false);
});

test('expiry propagates database failure instead of reporting an empty batch', async () => {
  const failure = new Error('database unavailable');
  const db = { async query() { throw failure; } };
  await assert.rejects(expireOverrides(db), error => error === failure);
  assert.equal(Object.hasOwn(db, '_quotaOverrides'), false);
  assert.equal(Object.hasOwn(db, '_planAuditEvents'), false);
});

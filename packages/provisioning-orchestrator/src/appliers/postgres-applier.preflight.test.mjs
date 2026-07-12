// Unit test for the pure pre-flight helper _checkExtensionAvailable
// (change add-pgvector-provisioning-preflight). No real DB: a mock `query`
// function drives the three branches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _checkExtensionAvailable } from './postgres-applier.mjs';

test('_checkExtensionAvailable: query returns a row -> true', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ '?column?': 1 }];
  };
  const available = await _checkExtensionAvailable('vector', query);
  assert.equal(available, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pg_available_extensions/);
  assert.deepEqual(calls[0].params, ['vector']);
});

test('_checkExtensionAvailable: query returns empty array -> false', async () => {
  const query = async () => [];
  const available = await _checkExtensionAvailable('vector', query);
  assert.equal(available, false);
});

test('_checkExtensionAvailable: query throws -> error propagates (no swallow)', async () => {
  const boom = new Error('PG connection error');
  const query = async () => {
    throw boom;
  };
  await assert.rejects(() => _checkExtensionAvailable('vector', query), /PG connection error/);
});

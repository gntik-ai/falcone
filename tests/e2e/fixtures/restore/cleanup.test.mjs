/**
 * Unit tests for restore cleanup helpers.
 * @module tests/e2e/fixtures/restore/cleanup.test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanupByExecutionId } from './cleanup.mjs';

test('cleanupByExecutionId ignores already deleted tenants (404)', async () => {
  const deleted = [];
  const client = {
    get: async () => ({ status: 200, body: {
      tenants: [
        { tenant_id: 'test-restore-abc-src', created_at: '2026-04-01T00:00:00.000Z' },
        { tenant_id: 'other-tenant', created_at: '2026-04-01T00:00:00.000Z' },
      ],
    } }),
    del: async (path) => {
      deleted.push(path);
      return { status: 404, body: { error: 'Not found' } };
    },
  };

  await cleanupByExecutionId('abc', client, {
    deleteTenant: async (id) => {
      deleted.push(id);
      return { status: 404 };
    },
  });

  assert.ok(deleted.length > 0);
});

test('cleanupByExecutionId retries transient failures', async () => {
  let calls = 0;
  const client = {
    get: async () => ({ status: 200, body: { tenants: [{ tenant_id: 'test-restore-abc-src', created_at: '2026-04-01T00:00:00.000Z' }] } }),
    del: async () => ({ status: 200 }),
  };

  await cleanupByExecutionId('abc', client, {
    deleteTenant: async () => {
      calls++;
      if (calls < 2) throw new Error('503 Service Unavailable');
      return { status: 200 };
    },
  });

  assert.ok(calls >= 2, 'cleanup should retry on transient failures');
});

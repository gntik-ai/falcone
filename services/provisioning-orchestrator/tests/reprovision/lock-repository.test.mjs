import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireLock, releaseLock, failLock, getActiveLock } from '../../src/repositories/config-reprovision-lock-repository.mjs';

/**
 * Create a mock pgClient that simulates the lock table behavior.
 */
function createMockPg(initialRows = []) {
  const rows = [...initialRows];

  return {
    _rows: rows,
    query: async (sql, params) => {
      // UPSERT for acquireLock
      if (sql.includes('INSERT INTO tenant_config_reprovision_locks')) {
        const tenantId = params[0];
        const newToken = params[1];
        const existing = rows.find(r => r.tenant_id === tenantId);

        if (existing && existing.status === 'active' && new Date(existing.expires_at) > new Date()) {
          // Lock held — return existing token (triggers LOCK_HELD detection)
          return { rows: [{ lock_token: existing.lock_token, expires_at: existing.expires_at }] };
        }

        // Insert or reclaim
        const newRow = {
          tenant_id: tenantId,
          lock_token: newToken,
          actor_id: params[2],
          actor_type: params[3],
          source_tenant_id: params[4],
          dry_run: params[5],
          correlation_id: params[6],
          status: 'active',
          acquired_at: new Date().toISOString(),
          expires_at: params[7],
          released_at: null,
          error_detail: null,
        };

        const idx = rows.findIndex(r => r.tenant_id === tenantId);
        if (idx >= 0) rows[idx] = newRow;
        else rows.push(newRow);

        return { rows: [{ lock_token: newToken, expires_at: params[7] }] };
      }

      // UPDATE for releaseLock
      if (sql.includes("status = 'released'")) {
        const tenantId = params[0];
        const lockToken = params[1];
        const row = rows.find(r => r.tenant_id === tenantId && r.lock_token === lockToken && r.status === 'active');
        if (row) {
          row.status = 'released';
          row.released_at = new Date().toISOString();
        }
        return { rowCount: row ? 1 : 0 };
      }

      // UPDATE for failLock
      if (sql.includes("status = 'failed'")) {
        const tenantId = params[0];
        const lockToken = params[1];
        const errorDetail = params[2];
        const row = rows.find(r => r.tenant_id === tenantId && r.lock_token === lockToken && r.status === 'active');
        if (row) {
          row.status = 'failed';
          row.released_at = new Date().toISOString();
          row.error_detail = errorDetail;
        }
        return { rowCount: row ? 1 : 0 };
      }

      // SELECT for getActiveLock
      if (sql.includes('SELECT * FROM tenant_config_reprovision_locks')) {
        const tenantId = params[0];
        const active = rows.find(r => r.tenant_id === tenantId && r.status === 'active' && new Date(r.expires_at) > new Date());
        return { rows: active ? [active] : [] };
      }

      return { rows: [] };
    },
  };
}

const defaultParams = {
  tenant_id: 'tenant-1',
  actor_id: 'sre-1',
  actor_type: 'sre',
  source_tenant_id: 'tenant-source',
  dry_run: false,
  correlation_id: 'req-123',
  ttlMs: 120_000,
};

test('acquireLock: succeeds with empty table', async () => {
  const pg = createMockPg();
  const result = await acquireLock(pg, defaultParams);
  assert.ok(result.lock_token);
  assert.ok(result.expires_at);
});

test('acquireLock: throws LOCK_HELD when active lock exists', async () => {
  const pg = createMockPg([{
    tenant_id: 'tenant-1',
    lock_token: 'existing-token',
    status: 'active',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }]);

  await assert.rejects(
    () => acquireLock(pg, defaultParams),
    (err) => err.code === 'LOCK_HELD'
  );
});

test('acquireLock: reclaims expired lock', async () => {
  const pg = createMockPg([{
    tenant_id: 'tenant-1',
    lock_token: 'old-token',
    status: 'active',
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }]);

  const result = await acquireLock(pg, defaultParams);
  assert.ok(result.lock_token);
  assert.notEqual(result.lock_token, 'old-token');
});

test('releaseLock: updates status with correct token', async () => {
  const pg = createMockPg([{
    tenant_id: 'tenant-1',
    lock_token: 'my-token',
    status: 'active',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }]);

  await releaseLock(pg, { tenant_id: 'tenant-1', lock_token: 'my-token' });
  assert.equal(pg._rows[0].status, 'released');
});

test('releaseLock: does not modify with wrong token', async () => {
  const pg = createMockPg([{
    tenant_id: 'tenant-1',
    lock_token: 'my-token',
    status: 'active',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }]);

  await releaseLock(pg, { tenant_id: 'tenant-1', lock_token: 'wrong-token' });
  assert.equal(pg._rows[0].status, 'active');
});

test('failLock: marks lock as failed', async () => {
  const pg = createMockPg([{
    tenant_id: 'tenant-1',
    lock_token: 'my-token',
    status: 'active',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }]);

  await failLock(pg, { tenant_id: 'tenant-1', lock_token: 'my-token', error_detail: 'timeout' });
  assert.equal(pg._rows[0].status, 'failed');
  assert.equal(pg._rows[0].error_detail, 'timeout');
});

test('getActiveLock: returns null when no active lock', async () => {
  const pg = createMockPg();
  const result = await getActiveLock(pg, 'tenant-1');
  assert.equal(result, null);
});

test('getActiveLock: returns active lock', async () => {
  const pg = createMockPg([{
    tenant_id: 'tenant-1',
    lock_token: 'my-token',
    status: 'active',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }]);

  const result = await getActiveLock(pg, 'tenant-1');
  assert.ok(result);
  assert.equal(result.lock_token, 'my-token');
});

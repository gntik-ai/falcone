import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingProviderStore } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Database-boundary double for an already migrated schema. Model relation locks,
// not query order: the real-Postgres suite also exercises this interleaving.
// These conflicts are PostgreSQL's table-level lock compatibility rules.
function concurrentDeletePool() {
  const conflicts = {
    'ACCESS SHARE': ['ACCESS EXCLUSIVE'],
    'ROW EXCLUSIVE': ['SHARE', 'SHARE ROW EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    SHARE: ['ROW EXCLUSIVE', 'SHARE ROW EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    'SHARE ROW EXCLUSIVE': ['ROW EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'ACCESS EXCLUSIVE'],
    'ACCESS EXCLUSIVE': ['ACCESS SHARE', 'ROW EXCLUSIVE', 'SHARE', 'SHARE ROW EXCLUSIVE', 'ACCESS EXCLUSIVE'],
  };
  const held = [];
  const waiting = new Map();
  const deleteStarted = deferred();
  const schemaBlocked = deferred();

  function blockers(client, table, mode) {
    return held.filter(lock => lock.client !== client && lock.table === table && conflicts[mode].includes(lock.mode));
  }

  function release(client) {
    for (let i = held.length - 1; i >= 0; i--) {
      if (held[i].client === client) held.splice(i, 1);
    }
    for (const [other, request] of waiting) {
      if (!blockers(other, request.table, request.mode).length) {
        waiting.delete(other);
        held.push({ client: other, table: request.table, mode: request.mode });
        request.resolve();
      }
    }
  }

  async function acquire(client, table, mode) {
    const owners = blockers(client, table, mode);
    if (!owners.length) {
      held.push({ client, table, mode });
      return;
    }
    // Two transactions suffice: one boot and one in-flight DELETE.
    if (owners.some(owner => {
      const request = waiting.get(owner.client);
      return request && blockers(owner.client, request.table, request.mode).some(lock => lock.client === client);
    })) {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }
    const ready = deferred();
    waiting.set(client, { table, mode, resolve: ready.resolve });
    if (table === 'workspace_embedding_connections') schemaBlocked.resolve();
    await ready.promise;
  }

  return {
    deleteStarted: deleteStarted.promise,
    async connect() {
      const client = {
        release() { release(client); },
        async query(sql) {
          const text = sql.trim().replace(/\s+/g, ' ');
          let match;
          if (text === 'COMMIT' || text === 'ROLLBACK') {
            release(client);
          } else if (/^(BEGIN$|SELECT pg_advisory_xact_lock|CREATE TABLE IF NOT EXISTS|CREATE OR REPLACE FUNCTION)/.test(text)) {
            // Tables and triggers already exist; advisory locks use separate keys
            // for schema setup and workspace writes, so neither blocks the other.
          } else if ((match = /^LOCK TABLE (\w+) IN (.+) MODE$/.exec(text))) {
            await acquire(client, match[1], match[2]);
          } else if ((match = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+ ON (\w+)/.exec(text))) {
            await acquire(client, match[1], 'SHARE');
          } else if ((match = /^ALTER TABLE (\w+)/.exec(text))) {
            await acquire(client, match[1], 'ACCESS EXCLUSIVE');
          } else if ((match = /^CREATE OR REPLACE TRIGGER .* ON (\w+) FOR EACH ROW/.exec(text))) {
            await acquire(client, match[1], 'SHARE ROW EXCLUSIVE');
          } else if ((match = /^(?:INSERT INTO|UPDATE) (\w+)/.exec(text))) {
            await acquire(client, match[1], 'ROW EXCLUSIVE');
          } else if ((match = /^DELETE FROM (\w+)/.exec(text))) {
            await acquire(client, match[1], 'ROW EXCLUSIVE');
            deleteStarted.resolve();
            // Pause at the installed in-use trigger until boot reaches a
            // conflicting relation lock, then perform its mappings read.
            await schemaBlocked.promise;
            await acquire(client, 'workspace_embedding_mappings', 'ACCESS SHARE');
            return { rowCount: 1, rows: [{ connection_id: 'default' }] };
          } else {
            assert.fail(`Unsupported database-boundary query: ${text}`);
          }
          return { rowCount: 0, rows: [] };
        },
      };
      return client;
    },
  };
}

for (const method of ['deleteConnection', 'removeProvider']) {
  test(`replica schema setup and in-flight ${method} both complete`, async () => {
    const pool = concurrentDeletePool();
    const store = createEmbeddingProviderStore({ pool });
    const deleting = method === 'deleteConnection'
      ? store.deleteConnection('workspace', 'default', 'tenant')
      : store.removeProvider('workspace', 'tenant');
    await pool.deleteStarted;
    const [removed] = await Promise.all([deleting, store.ensureSchema()]);
    assert.deepEqual(removed, { removed: true });
  });
}

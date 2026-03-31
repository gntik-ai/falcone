import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/api-key-domain-migration.mjs';

test('structural history classifies structural_admin', async () => {
  const updates = [];
  const result = await main({}, {
    db: {
      async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: [{ id: 'k1', tenant_id: 't-1', workspace_id: 'w-1', last_used_endpoint_category: 'structural_admin', last_used_path: '/v1/schemas', privilege_domain: null }] };
        updates.push(params);
        return { rows: [] };
      }
    }
  });
  assert.equal(result.body.classified, 1);
  assert.equal(updates[0][1], 'structural_admin');
});

test('data usage classifies data_access', async () => {
  const updates = [];
  const result = await main({}, {
    db: {
      async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: [{ id: 'k1', tenant_id: 't-1', workspace_id: 'w-1', last_used_endpoint_category: null, last_used_path: '/v1/collections/x/documents', privilege_domain: null }] };
        updates.push(params);
        return { rows: [] };
      }
    }
  });
  assert.equal(result.body.classified, 1);
  assert.equal(updates[0][1], 'data_access');
});

test('mixed or no history becomes pending', async () => {
  const events = [];
  const result = await main({}, {
    db: {
      async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: [{ id: 'k1', tenant_id: 't-1', workspace_id: 'w-1', last_used_endpoint_category: null, last_used_path: '/v1/unknown', privilege_domain: null }] };
        return { rows: [] };
      }
    },
    publishEvent: async (topic, payload) => events.push({ topic, payload })
  });
  assert.equal(result.body.pending, 1);
  assert.equal(events.length, 1);
});

test('already classified keys are skipped', async () => {
  const result = await main({}, {
    db: {
      async query() { return { rows: [{ id: 'k1', privilege_domain: 'data_access' }] }; }
    }
  });
  assert.equal(result.body.alreadyClassified, 1);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { collect } = await import('../../src/collectors/postgres-collector.mjs');

function mockPool(queryResults = {}) {
  return {
    query: async (sql, params) => {
      for (const [pattern, result] of Object.entries(queryResults)) {
        if (sql.includes(pattern)) return result;
      }
      return { rows: [] };
    },
    end: async () => {},
  };
}

describe('postgres-collector', () => {
  it('returns correct nested structure for schema with tables', async () => {
    const pgPool = mockPool({
      'information_schema.schemata': { rows: [{ schema_name: 'acme' }] },
      "table_type = 'BASE TABLE'": { rows: [{ table_name: 'users' }] },
      'information_schema.columns': { rows: [{ column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' }] },
      'table_constraints': { rows: [{ constraint_name: 'users_pkey', constraint_type: 'PRIMARY KEY', column_name: 'id' }] },
      'pg_indexes': { rows: [{ indexname: 'users_pkey', indexdef: 'CREATE UNIQUE INDEX...' }] },
      'information_schema.views': { rows: [] },
      'pg_extension': { rows: [{ extname: 'uuid-ossp', extversion: '1.1' }] },
      'role_table_grants': { rows: [] },
      'pg_namespace': { rows: [{ owner: 'postgres' }] },
    });

    const result = await collect('acme', { pgPool });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.schemas[0].schema_name, 'acme');
    assert.equal(result.data.schemas[0].tables[0].table_name, 'users');
    assert.equal(result.data.schemas[0].tables[0].columns[0].column_name, 'id');
    assert.ok(result.items_count >= 1);
  });

  it('returns empty when schema has no tables or views', async () => {
    const pgPool = mockPool({
      'information_schema.schemata': { rows: [{ schema_name: 'empty-tenant' }] },
      "table_type = 'BASE TABLE'": { rows: [] },
      'information_schema.views': { rows: [] },
      'pg_extension': { rows: [] },
      'role_table_grants': { rows: [] },
      'pg_namespace': { rows: [{ owner: 'postgres' }] },
    });

    const result = await collect('empty-tenant', { pgPool });
    assert.equal(result.status, 'empty');
  });

  it('returns empty when schema does not exist', async () => {
    const pgPool = mockPool({
      'information_schema.schemata': { rows: [] },
    });

    const result = await collect('nonexistent', { pgPool });
    assert.equal(result.status, 'empty');
    assert.equal(result.items_count, 0);
  });

  it('returns error on connection failure', async () => {
    const pgPool = {
      query: async () => { throw new Error('Connection refused'); },
      end: async () => {},
    };

    const result = await collect('acme', { pgPool });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('Connection refused'));
  });
});

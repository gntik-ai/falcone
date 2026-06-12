import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/appliers/postgres-applier.mjs';

function mockQuery(existingResources = {}, opts = {}) {
  // opts.availableExtensions: array of extension names present in
  // pg_available_extensions (i.e. the instance image ships their control files).
  // Defaults to all-available so existing tests keep their behaviour.
  const availableExtensions = opts.availableExtensions ?? null;
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      // Schema check
      if (sql.includes('information_schema.schemata')) {
        return existingResources[params[0]] ? [{ schema_name: params[0] }] : [];
      }
      // Table check
      if (sql.includes('information_schema.columns') && !sql.includes('role_table_grants')) {
        const key = `${params[0]}.${params[1]}`;
        return existingResources[key] ?? [];
      }
      // View check
      if (sql.includes('pg_views')) {
        const key = `view:${params[0]}.${params[1]}`;
        return existingResources[key] ? [existingResources[key]] : [];
      }
      // Extension availability pre-flight (pg_available_extensions)
      if (sql.includes('pg_available_extensions')) {
        if (availableExtensions === null) return [{ '?column?': 1 }];
        return availableExtensions.includes(params[0]) ? [{ '?column?': 1 }] : [];
      }
      // Extension existence check (pg_extension)
      if (sql.includes('pg_extension')) {
        return existingResources[`ext:${params[0]}`] ? [existingResources[`ext:${params[0]}`]] : [];
      }
      // Grant check
      if (sql.includes('role_table_grants')) {
        const key = `grant:${params[1]}:${params[2]}:${params[3]}`;
        return existingResources[key] ? [existingResources[key]] : [];
      }
      return [];
    },
  };
}

test('postgres-applier: empty domain returns applied', async () => {
  const result = await apply('tenant-1', {}, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
  assert.equal(result.counts.created, 0);
});

test('postgres-applier: creates non-existing schema', async () => {
  const mock = mockQuery();
  const domainData = { schema: 'test_schema', schemas: [{ name: 'test_schema' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.ok(mock.calls.some(c => c.sql.includes('CREATE SCHEMA')));
});

test('postgres-applier: skips existing identical schema', async () => {
  const mock = mockQuery({ 'test_schema': true });
  const domainData = { schema: 'test_schema', schemas: [{ name: 'test_schema' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'skipped');
});

test('postgres-applier: dry run does not execute DDL', async () => {
  const mock = mockQuery();
  const domainData = { schema: 'test_schema', schemas: [{ name: 'test_schema' }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'would_create');
  assert.ok(!mock.calls.some(c => c.sql.includes('CREATE SCHEMA')));
});

test('postgres-applier: reports conflict for different table structure', async () => {
  const mock = mockQuery({
    'test_schema.users': [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO' }],
  });
  const domainData = {
    schema: 'test_schema',
    tables: [{ name: 'users', columns: [{ column_name: 'id', data_type: 'text', is_nullable: 'YES' }] }],
  };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'conflict');
});

test('postgres-applier: redacted value produces applied_with_warnings', async () => {
  const mock = mockQuery();
  const domainData = { schema: 'test_schema', schemas: [{ name: 'test_schema', password: '***REDACTED***' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'applied_with_warnings');
  assert.ok(result.resource_results[0].warnings.length > 0);
});

test('postgres-applier: available extension is created normally (no behaviour change)', async () => {
  const mock = mockQuery({}, { availableExtensions: ['vector'] });
  const domainData = { schema: 'test_schema', extensions: [{ name: 'vector' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.ok(mock.calls.some(c => c.sql.includes('CREATE EXTENSION')));
});

test('postgres-applier: extension absent from pg_available_extensions -> error, no CREATE EXTENSION', async () => {
  const mock = mockQuery({}, { availableExtensions: [] });
  const domainData = { schema: 'test_schema', extensions: [{ name: 'vector' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.status, 'error');
  assert.equal(result.resource_results[0].action, 'error');
  assert.match(result.resource_results[0].message, /vector/);
  assert.match(result.resource_results[0].message, /pgvector\/pgvector/);
  assert.ok(!mock.calls.some(c => c.sql.includes('CREATE EXTENSION')), 'CREATE EXTENSION must not be issued');
});

test('postgres-applier: dry-run reports unavailable extension as error, no CREATE EXTENSION', async () => {
  const mock = mockQuery({}, { availableExtensions: [] });
  const domainData = { schema: 'test_schema', extensions: [{ name: 'vector' }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { query: mock.query } });
  assert.equal(result.status, 'error');
  assert.equal(result.resource_results[0].action, 'error');
  assert.match(result.resource_results[0].message, /vector/);
  assert.ok(!mock.calls.some(c => c.sql.includes('CREATE EXTENSION')), 'CREATE EXTENSION must not be issued in dry-run');
});

test('postgres-applier: non-vector unavailable extension error names the extension', async () => {
  const mock = mockQuery({}, { availableExtensions: [] });
  const domainData = { schema: 'test_schema', extensions: [{ name: 'postgis' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query: mock.query } });
  assert.equal(result.resource_results[0].action, 'error');
  assert.match(result.resource_results[0].message, /postgis/);
  assert.ok(!mock.calls.some(c => c.sql.includes('CREATE EXTENSION')));
});

test('postgres-applier: error in one resource does not abort others', async () => {
  let queryCount = 0;
  const query = async (sql, params) => {
    if (sql.includes('information_schema.schemata')) {
      queryCount++;
      if (queryCount === 1) throw new Error('PG connection error');
      return [];
    }
    if (sql.includes('CREATE SCHEMA')) return [];
    return [];
  };
  const domainData = { schema: 'test_schema', schemas: [{ name: 'schema1' }, { name: 'schema2' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { query } });
  assert.equal(result.counts.errors, 1);
  assert.equal(result.counts.created, 1);
});

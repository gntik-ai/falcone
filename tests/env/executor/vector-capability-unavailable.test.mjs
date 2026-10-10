// #983 negative real-stack case. Use the existing DB_URL/PG* fixture settings
// against bitnamilegacy/postgresql:17.2.0 (no vector control file). The standard
// pgvector fixture skips this case; its positive tests remain unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createEmbeddingMappingStore } from '../../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

const dsn = process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${process.env.PGHOST ?? 'localhost'}:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

test('Postgres without pgvector returns safe capability errors on tenant vector routes', async (t) => {
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn, adminDsn: dsn, routed: true }) });
  let server;
  try {
    const probe = await pool.query('SELECT 1 FROM pg_available_extensions WHERE name = $1', ['vector']);
    if (probe.rowCount > 0) return t.skip('Negative case requires the Bitnami/plain Postgres fixture without vector');
    server = createControlPlaneServer({ registry, mappingStore: createEmbeddingMappingStore({ pool }), logger: { error() {} } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const data = '/v1/postgres/workspaces/ws_vector_absent/data/appdb/schemas/public/tables/docs';
    const ddl = '/v1/postgres/databases/appdb/schemas/public/tables/docs';
    for (const [method, path, body] of [
      ['POST', `${data}/search`, { queryVector: [1, 0, 0], vectorColumn: 'embedding' }],
      ['POST', `${ddl}/vector-indexes`, { indexName: 'docs_embedding_idx', keys: [{ columnName: 'embedding' }] }],
      ['DELETE', `${ddl}/vector-indexes/docs_embedding_idx`],
      ['POST', `${ddl}/columns`, { columnName: 'embedding', dataType: 'vector(3)' }],
      ['PUT', `${data}/embedding-mapping`, { sourceColumn: 'body', targetColumn: 'embedding' }],
      ['DELETE', `${data}/embedding-mapping?targetColumn=embedding`],
    ]) {
      const response = await fetch(`${base}${path}`, {
        method, headers: {
          'content-type': 'application/json', 'x-tenant-id': 'ten_vector_absent',
          'x-workspace-id': 'ws_vector_absent', 'x-auth-subject': 'admin', 'x-actor-roles': 'tenant_admin',
        }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 501, `${method} ${path}`);
      assert.deepEqual(await response.json(), {
        code: 'CAPABILITY_UNAVAILABLE', capability: 'vector_search',
        message: 'Vector search is unavailable on this workspace database',
      });
    }
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await registry.end();
    await pool.end();
  }
});

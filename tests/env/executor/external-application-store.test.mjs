import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureSchema, upsertExternalApplication, getExternalApplication, listExternalApplications } from '../../../apps/control-plane/tenant-store.mjs';

// Real Postgres proof: additive migration, repeat bootstrap, IAM linkage and realized-state filters.
test('external application schema upgrades legacy rows idempotently and persists scoped IAM linkage', async () => {
  const pool = new pg.Pool({
    connectionString: process.env.DB_URL,
    host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? '55432'),
    user: process.env.PGUSER ?? 'falcone', password: process.env.PGPASSWORD ?? 'falcone',
    database: process.env.PGDATABASE ?? 'falcone_test',
  });
  const schema = `apps_969_${randomUUID().replaceAll('-', '')}`;
  let client;
  try {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    // Keep bootstrap mutations inside this test schema, even if the shared DB already has tables.
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE external_applications (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      slug TEXT NOT NULL, protocol TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
      app_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT, updated_by TEXT, UNIQUE(workspace_id, slug)
    )`);
    await client.query(`INSERT INTO external_applications (id, workspace_id, tenant_id, slug, protocol)
      VALUES ('legacy', 'ws', 'tenant', 'legacy', 'oidc')`);
    await ensureSchema(client);
    await ensureSchema(client);
    const { rows: columns } = await client.query(`SELECT column_name, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'external_applications'`, [schema]);
    for (const name of ['iam_realm', 'kc_client_id', 'kc_client_uuid']) {
      assert.equal(columns.find((column) => column.column_name === name)?.is_nullable, 'YES');
    }
    assert.match(columns.find((column) => column.column_name === 'state').column_default, /provisioning/);
    const scope = { workspaceId: 'ws', tenantId: 'tenant' };
    const legacy = await getExternalApplication(client, { ...scope, applicationId: 'legacy' });
    assert.equal(legacy.state, 'active', 'migration does not rewrite existing state');
    assert.equal(legacy.kc_client_uuid, null);
    const draft = await upsertExternalApplication(client, { ...scope, id: 'draft', slug: 'draft', protocol: 'oidc', appJson: {} });
    assert.equal(draft.state, 'provisioning');
    const active = await upsertExternalApplication(client, {
      ...scope, id: 'realized', slug: 'realized', protocol: 'oidc', state: 'active',
      iamRealm: 'tenant-realm', kcClientId: 'registered-client', kcClientUuid: 'kc-uuid', appJson: {},
    });
    assert.equal(active.iam_realm, 'tenant-realm');
    assert.equal(active.kc_client_id, 'registered-client');
    assert.equal(active.kc_client_uuid, 'kc-uuid');
    const read = await getExternalApplication(client, { ...scope, applicationId: 'realized' });
    assert.equal(read.kc_client_uuid, 'kc-uuid');
    assert.deepEqual((await listExternalApplications(client, { ...scope, state: 'active' })).items.map((row) => row.id), ['realized']);
    const provisioning = await listExternalApplications(client, { ...scope, state: 'provisioning' });
    assert.deepEqual(provisioning.items.map((row) => row.id).sort(), ['draft', 'legacy']);
    assert.equal((await listExternalApplications(client, { ...scope, tenantId: 'foreign' })).items.length, 0);
    assert.equal(await getExternalApplication(client, { ...scope, tenantId: 'foreign', applicationId: 'realized' }), null);
  } finally {
    if (client) {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
    await pool.end();
  }
});

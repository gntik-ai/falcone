import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmbeddingProviderStore, createEmbeddingMappingStore } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';
import { oldExecutorUpsert } from './fixtures/embedding-old-executor-upsert.mjs';

const config = { tenantId: 'tenant', displayName: 'Named provider', providerType: 'openai', endpoint: 'https://example.test/chat', model: 'model-a', dimension: 3, secretRef: { name: 'BYOK_TEST', key: 'token' } };

async function waitForBlockedBy(pool, waitingPid, blockingPid) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query('SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked', [waitingPid, blockingPid]);
    if (rows[0].blocked) return;
    await delay(10);
  }
  assert.fail(`Backend ${waitingPid} did not block on ${blockingPid}`);
}

test('Postgres 17 registry: copy fidelity, idempotence, rollout fence and concurrent writes', async t => {
  const dsn = process.env.EMBEDDING_CONNECTIONS_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.EMBEDDING_CONNECTIONS_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres 17');
    return t.skip('EMBEDDING_CONNECTIONS_TEST_DATABASE_URL is absent; a dedicated real Postgres 17 is required');
  }
  const { default: pg } = await import('pg');
  const schema = `embedding_registry_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: dsn });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 8 });
  const store = createEmbeddingProviderStore({ pool });
  const oldWrite = (workspaceId, providerType = 'old-image') => pool.query(oldExecutorUpsert, [config.tenantId, workspaceId, providerType, config.model, config.endpoint, config.dimension, JSON.stringify(config.secretRef)]);
  try {
    // Pristine pre-upgrade table; no migrated_at and no new registry.
    await pool.query(`CREATE TABLE workspace_embedding_providers (
      tenant_id text NOT NULL, workspace_id text NOT NULL, provider_type text, model text, endpoint text,
      dimension integer, secret_ref jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, workspace_id))`);
    await oldWrite('copy', 'legacy');
    await pool.query("UPDATE workspace_embedding_providers SET updated_at = '2026-01-02T03:04:05.678Z' WHERE workspace_id='copy'");
    await Promise.all([store.ensureSchema(), store.ensureSchema(), createEmbeddingMappingStore({ pool }).ensureSchema()]);
    const copied = await store.getProvider('copy', config.tenantId);
    assert.deepEqual(copied, {
      ...config, displayName: null, workspaceId: 'copy', connectionId: 'default', isDefault: true,
      providerType: 'legacy', createdAt: '2026-01-02T03:04:05.678Z', updatedAt: '2026-01-02T03:04:05.678Z',
    });
    assert.equal((await store.listConnections('copy', config.tenantId)).length, 1);
    await store.ensureSchema();
    assert.deepEqual(await store.getProvider('copy', config.tenantId), copied);
    await store.removeProvider('copy', config.tenantId);
    await store.ensureSchema();
    assert.deepEqual(await store.listConnections('copy', config.tenantId), []);

    await oldWrite('mirror');
    assert.equal((await store.getProvider('mirror', config.tenantId)).providerType, 'old-image');
    await oldWrite('mirror', 'old-update');
    assert.equal((await store.getProvider('mirror', config.tenantId)).providerType, 'old-update');
    await store.deployProvider('mirror', { ...config, providerType: 'new-edit' });
    const edited = await store.getProvider('mirror', config.tenantId);
    await pool.query("UPDATE workspace_embedding_providers SET migrated_at=now() WHERE workspace_id='mirror'");
    assert.deepEqual(await store.getProvider('mirror', config.tenantId), edited);
    await pool.query("DELETE FROM workspace_embedding_providers WHERE workspace_id='mirror'");
    assert.equal(await store.getProvider('mirror', config.tenantId), null);

    await store.createConnection('display-name', { ...config, connectionId: 'default', displayName: 'Original default' });
    await store.createConnection('display-name', { ...config, connectionId: 'openai-main', displayName: 'OpenAI main', isDefault: true });
    const { displayName, ...legacyConfig } = config;
    await store.deployProvider('display-name', { ...legacyConfig, providerType: 'anthropic' });
    assert.equal((await store.getConnection('display-name', 'openai-main', config.tenantId)).displayName, 'OpenAI main');
    assert.equal((await store.getProvider('display-name', config.tenantId)).providerType, 'anthropic');
    await store.removeProvider('display-name', config.tenantId);
    await store.deployProvider('display-name', legacyConfig);
    assert.equal((await store.getProvider('display-name', config.tenantId)).displayName, 'Original default');

    await oldWrite('promote');
    await store.createConnection('promote', { ...config, connectionId: 'moved', isDefault: true });
    await oldWrite('promote', 'mirrored-to-named');
    assert.equal((await store.getProvider('promote', config.tenantId)).connectionId, 'moved');
    assert.equal((await store.getProvider('promote', config.tenantId)).providerType, 'mirrored-to-named');
    assert.equal((await store.getConnection('promote', 'default', config.tenantId)).providerType, 'old-image');
    await store.deleteConnection('promote', 'moved', config.tenantId);
    await oldWrite('promote', 'promoted');
    assert.equal((await store.getProvider('promote', config.tenantId)).connectionId, 'default');
    assert.equal((await store.getProvider('promote', config.tenantId)).providerType, 'promoted');
    assert.equal((await store.listConnections('promote', config.tenantId)).length, 1);

    await oldWrite('full');
    for (let i = 1; i < 32; i++) await store.createConnection('full', { ...config, connectionId: `conn-${i}` });
    await oldWrite('full', 'updated-at-cap');
    assert.equal((await store.getProvider('full', config.tenantId)).providerType, 'updated-at-cap');
    // A default-named row can be promoted even at capacity.
    await store.replaceConnection('full', 'conn-1', { ...config, isDefault: true });
    await store.deleteConnection('full', 'conn-1', config.tenantId);
    await store.createConnection('full', { ...config, connectionId: 'replacement' });
    await oldWrite('full', 'promoted-at-cap');
    assert.equal((await store.getProvider('full', config.tenantId)).connectionId, 'default');
    assert.equal((await store.listConnections('full', config.tenantId)).length, 32);
    await store.deleteConnection('full', 'default', config.tenantId);
    await store.createConnection('full', { ...config, connectionId: 'last' });
    const before = await store.listConnections('full', config.tenantId);
    const legacyBefore = (await pool.query("SELECT * FROM workspace_embedding_providers WHERE workspace_id='full'")).rows;
    await assert.rejects(oldWrite('full', 'overflow'), /EMBEDDING_CONNECTION_LIMIT_REACHED/);
    assert.deepEqual(await store.listConnections('full', config.tenantId), before);
    assert.deepEqual((await pool.query("SELECT * FROM workspace_embedding_providers WHERE workspace_id='full'")).rows, legacyBefore);
    await assert.rejects(store.deployProvider('full', config), { code: 'EMBEDDING_CONNECTION_LIMIT_REACHED' });
    assert.deepEqual(await store.listConnections('full', config.tenantId), before);
    // BEFORE INSERT must also tolerate the insert arm of the verbatim old ON CONFLICT upsert.
    await pool.query("DELETE FROM workspace_embedding_providers WHERE workspace_id='full'");
    await assert.rejects(oldWrite('full'), /EMBEDDING_CONNECTION_LIMIT_REACHED/);
    assert.deepEqual((await pool.query("SELECT * FROM workspace_embedding_providers WHERE workspace_id='full'")).rows, []);

    // Old and current delete paths preserve both the connection and its explicit mapping.
    const mappings = createEmbeddingMappingStore({ pool });
    await oldWrite('in-use');
    const selector = { tenantId: config.tenantId, schemaName: 'public', tableName: 'docs', targetColumn: 'embedding' };
    await mappings.deployMapping('in-use', { ...selector, sourceColumn: 'body', connectionId: 'default' });
    assert.equal((await mappings.getMapping('in-use', selector)).connectionId, 'default');
    const legacy = (await pool.query("SELECT * FROM workspace_embedding_providers WHERE workspace_id='in-use'")).rows;
    const connections = await store.listConnections('in-use', config.tenantId);
    await assert.rejects(pool.query("DELETE FROM workspace_embedding_providers WHERE workspace_id='in-use'"), /EMBEDDING_CONNECTION_IN_USE/);
    await assert.rejects(store.removeProvider('in-use', config.tenantId), { statusCode: 409, code: 'EMBEDDING_CONNECTION_IN_USE' });
    await assert.rejects(store.deleteConnection('in-use', 'default', config.tenantId), { statusCode: 409, code: 'EMBEDDING_CONNECTION_IN_USE' });
    assert.deepEqual((await pool.query("SELECT * FROM workspace_embedding_providers WHERE workspace_id='in-use'")).rows, legacy);
    assert.deepEqual(await store.listConnections('in-use', config.tenantId), connections);
    assert.equal((await mappings.getMapping('in-use', selector)).connectionId, 'default');
    await mappings.removeMapping('in-use', selector);
    await pool.query("DELETE FROM workspace_embedding_providers WHERE workspace_id='in-use'");
    assert.equal(await store.getProvider('in-use', config.tenantId), null);
    await assert.rejects(mappings.deployMapping('in-use', { ...selector, sourceColumn: 'body', connectionId: 'default' }), { statusCode: 422, code: 'EMBEDDING_CONNECTION_NOT_FOUND' });

    // Hold DELETE inside a BEFORE trigger, after it owns the connections relation
    // lock but before the in-use trigger reads mappings. Boot must wait without
    // locking mappings, so releasing this barrier lets both operations finish.
    await pool.query(`CREATE FUNCTION pause_embedding_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('embedding_registry_delete_barrier'));
        RETURN OLD;
      END; $$`);
    await pool.query(`CREATE TRIGGER aa_pause_embedding_delete BEFORE DELETE ON workspace_embedding_connections
      FOR EACH ROW EXECUTE FUNCTION pause_embedding_delete()`);
    for (const action of ['plural', 'singular', 'legacy']) {
      await t.test(`ensureSchema coexists with an in-flight ${action} DELETE`, async () => {
        const workspaceId = `schema-delete-${action}`;
        await oldWrite(workspaceId);
        const deletingPool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 1 });
        const bootPool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 1 });
        const blocker = await pool.connect();
        const deletePid = (await deletingPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const bootPid = (await bootPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const deletingStore = createEmbeddingProviderStore({ pool: deletingPool });
        let pending = [];
        try {
          await blocker.query("SELECT pg_advisory_lock(hashtext('embedding_registry_delete_barrier'))");
          const deleting = action === 'plural'
            ? deletingStore.deleteConnection(workspaceId, 'default', config.tenantId)
            : action === 'singular'
              ? deletingStore.removeProvider(workspaceId, config.tenantId)
              : deletingPool.query('DELETE FROM workspace_embedding_providers WHERE tenant_id=$1 AND workspace_id=$2', [config.tenantId, workspaceId]);
          // Attach rejection handlers immediately; a real deadlock may abort
          // either backend, and the assertions below must report either victim.
          pending = [Promise.allSettled([deleting])];
          await waitForBlockedBy(pool, deletePid, blockerPid);
          const booting = createEmbeddingProviderStore({ pool: bootPool }).ensureSchema();
          pending.push(Promise.allSettled([booting]));
          await waitForBlockedBy(pool, bootPid, deletePid);
          await blocker.query("SELECT pg_advisory_unlock(hashtext('embedding_registry_delete_barrier'))");
          const [deleted, booted] = (await Promise.all(pending)).flat();
          assert.equal(deleted.status, 'fulfilled', deleted.reason?.stack);
          assert.equal(booted.status, 'fulfilled', booted.reason?.stack);
          if (action === 'legacy') assert.equal(deleted.value.rowCount, 1);
          else assert.deepEqual(deleted.value, { removed: true });
          assert.equal(await store.getProvider(workspaceId, config.tenantId), null);
        } finally {
          await blocker.query("SELECT pg_advisory_unlock(hashtext('embedding_registry_delete_barrier'))");
          await pool.query('SELECT pg_cancel_backend(pid) FROM unnest($1::integer[]) AS pid', [[deletePid, bootPid]]);
          await Promise.all(pending);
          blocker.release();
          await Promise.all([deletingPool.end(), bootPool.end()]);
        }
      });
    }
    await pool.query('DROP TRIGGER aa_pause_embedding_delete ON workspace_embedding_connections');
    await pool.query('DROP FUNCTION pause_embedding_delete()');

    // Concurrent public store writes cannot overrun the cap or create two defaults.
    const results = await Promise.allSettled(Array.from({ length: 34 }, (_, i) => store.createConnection('race', { ...config, connectionId: `conn-${i}`, isDefault: true })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 32);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'EMBEDDING_CONNECTION_LIMIT_REACHED'));
    const raced = await store.listConnections('race', config.tenantId);
    assert.equal(raced.length, 32);
    assert.equal(raced.filter(r => r.isDefault).length, 1);
    await assert.rejects(store.createConnection('race', { ...config, connectionId: 'conn-0' }), { code: 'EMBEDDING_CONNECTION_EXISTS' });
    await assert.rejects(store.createConnection('race', { ...config, connectionId: 'Bad' }), { code: 'INVALID_CONNECTION_ID' });
    for (const action of [() => store.getConnection('race', 'missing', config.tenantId), () => store.replaceConnection('race', 'missing', config), () => store.deleteConnection('race', 'missing', config.tenantId)]) await assert.rejects(action(), { code: 'EMBEDDING_CONNECTION_NOT_FOUND' });
    for (const id of ['Bad', '-bad', 'bad_id']) await assert.rejects(store.replaceConnection('race', id, config), { statusCode: 404, code: 'EMBEDDING_CONNECTION_NOT_FOUND' });
    assert.deepEqual(await store.listConnections('race', 'other-tenant'), []);

  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

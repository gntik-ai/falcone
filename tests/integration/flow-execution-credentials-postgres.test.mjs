import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFlowStore } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { newExecutionCredential } from '../../packages/internal-contracts/src/flow-execution-credentials.mjs';
import { mintExecutionToken } from '../../apps/control-plane-executor/src/runtime/execution-token.mjs';

test('real Postgres credentials: schema, effective privileges, conditional claims and bounded expiry sweep', async (t) => {
  const dsn = process.env.FLOW_CREDENTIALS_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.FLOW_CREDENTIALS_TEST_REQUIRED, '1', 'CI requires real PostgreSQL');
    return t.skip('FLOW_CREDENTIALS_TEST_DATABASE_URL absent; real PostgreSQL required');
  }
  const { default: pg } = await import('pg');
  const suffix = randomUUID().replaceAll('-', '');
  const database = `flow_credentials_${suffix}`;
  const inheritedRole = `flow_credential_reader_${suffix}`;
  const admin = new pg.Pool({ connectionString: dsn });
  const createdRoles = [];
  let pool;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const connection = new URL(dsn);
    connection.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: connection.toString(), max: 8 });
    for (const role of ['falcone_service', 'falcone_anon']) {
      if (!(await admin.query('SELECT FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await admin.query(`CREATE ROLE ${role}`);
        createdRoles.push(role);
      }
    }
    const flowStore = createFlowStore({ pool });
    await flowStore.ensureSchema();
    const store = flowStore.executionCredentials;
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='flow_execution_credentials'")).rows.map((r) => r.column_name).sort();
    assert.deepEqual(columns, ['attempt_id', 'created_at', 'expires_at', 'ref_hash', 'run_id', 'tenant_id', 'token', 'workflow_id', 'workspace_id']);
    const indexes = (await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename='flow_execution_credentials'")).rows.map((r) => r.indexdef);
    assert.ok(indexes.some((definition) => definition.includes('(expires_at)')));
    assert.ok(indexes.some((definition) => definition.includes('(run_id)') && definition.includes('WHERE (run_id IS NULL)')));
    for (const role of ['falcone_service', 'falcone_anon']) {
      await pool.query(`GRANT SELECT, INSERT ON public.flow_execution_credentials TO ${role}`);
      await store.ensureSchema();
      assert.equal((await pool.query("SELECT has_table_privilege($1, 'public.flow_execution_credentials', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS allowed", [role])).rows[0].allowed, false);
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE table_name='flow_execution_credentials' AND grantee='PUBLIC'")).rows[0].n, 0);
    await admin.query(`CREATE ROLE ${inheritedRole}`);
    await pool.query(`GRANT SELECT ON public.flow_execution_credentials TO ${inheritedRole}`);
    await admin.query(`GRANT ${inheritedRole} TO falcone_service`);
    await assert.rejects(() => flowStore.ensureSchema(), (error) => error.code === 'FLOW_CREDENTIAL_STORE_UNSAFE');
    await admin.query(`REVOKE ${inheritedRole} FROM falcone_service`);
    await flowStore.ensureSchema();

    const token = await mintExecutionToken('tenant', 'workspace');
    const credential = newExecutionCredential({ tenantId: 'tenant', workspaceId: 'workspace', workflowId: 'root', token });
    await store.insert(credential.row);
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => store.claim(credential.row.ref_hash, `run-${i}`)));
    assert.equal(new Set(claims.map((row) => row.run_id)).size, 1);
    const winner = (await store.get(credential.row.ref_hash)).run_id;
    assert.match(winner, /^run-[0-7]$/);
    assert.equal((await store.claim(credential.row.ref_hash, 'replacement')).run_id, winner);

    const recent = { ...credential.row, ref_hash: 'recent-expiry', expires_at: new Date(Date.now() - 3_570_000) };
    const old = { ...credential.row, ref_hash: 'old-expiry', expires_at: new Date(Date.now() - 3_630_000) };
    await store.insert(recent);
    await store.insert(old);
    await store.sweep();
    assert.ok(await store.get(recent.ref_hash), 'one-hour grace period retained');
    assert.equal(await store.get(old.ref_hash), null);
    await pool.query(`INSERT INTO public.flow_execution_credentials
      (ref_hash, tenant_id, workspace_id, workflow_id, attempt_id, token, expires_at)
      SELECT 'old-' || i, 'tenant', 'workspace', 'root', 'attempt', 'fixture', now() - interval '2 hours' FROM generate_series(1,501) i`);
    await store.sweep();
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.flow_execution_credentials WHERE ref_hash LIKE 'old-%'")).rows[0].n, 1);
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${inheritedRole}`);
    for (const role of createdRoles) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  }
});

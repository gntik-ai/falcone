// Real-Postgres proof for add-tenant-delete-purge-cascade (#501): store.purgeTenant removes
// every accessible row a tenant owns and discloses protected tables. Returns the physical
// resources to tear down without touching another tenant's rows. Run via tests/env/executor/run.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createEmbeddingProviderStore } from '../../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';
import * as store from '../../../apps/control-plane/tenant-store.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const PROBE_DB = 'cp_purge_probe';
const TEN = 'ten_purge'; const OTHER = 'ten_keep'; // OTHER must survive (cross-tenant safety)
const WS = 'ws_purge'; const OWS = 'ws_keep';

let bootstrap; let pool;
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

const EXTRA_TABLES = ['workspace_doc_notes', 'workspace_openapi_versions', 'workspace_sdk_packages',
  'webhook_deliveries', 'webhook_signing_secrets', 'webhook_subscriptions',
  'scheduled_executions', 'scheduled_jobs', 'scheduling_configurations',
  'realtime_sessions', 'realtime_scope_channel_mappings', 'restore_confirmation_requests',
  'backup_operations', 'backup_status_snapshots', 'quota_last_known_posture'];
const FORCED_RLS = ['flow_definitions', 'flow_versions', 'flow_trigger_secrets',
  'flow_trigger_registrations', 'service_account_rotation_states', 'service_account_rotation_history',
  'tenant_rotation_policies', 'webhook_subscriptions', 'webhook_signing_secrets',
  'webhook_deliveries', 'webhook_delivery_attempts', 'scheduled_jobs', 'scheduled_executions',
  'scheduling_configurations', 'realtime_sessions'];

// Tenant purge database seam: published versions, dependency order, role policy and isolation.
const SCHEMA = `
  CREATE TABLE tenants (id text PRIMARY KEY, slug text, display_name text, status text DEFAULT 'active', iam_realm text);
  CREATE TABLE workspaces (id text PRIMARY KEY, tenant_id text, slug text, display_name text);
  CREATE TABLE workspace_databases (id text PRIMARY KEY, workspace_id text, tenant_id text, engine text, database_name text, mode text, username text, host text, port int);
  CREATE TABLE workspace_buckets (id text PRIMARY KEY, workspace_id text, tenant_id text, bucket_name text);
  CREATE TABLE workspace_topics (id text PRIMARY KEY, workspace_id text, tenant_id text, topic_name text, physical_topic_name text);
  CREATE TABLE workspace_functions (id text PRIMARY KEY, workspace_id text, tenant_id text, name text);
  CREATE TABLE fn_actions (resource_id text PRIMARY KEY, workspace_id text, tenant_id text, action_name text, ksvc_name text);
  CREATE TABLE fn_activations (activation_id text PRIMARY KEY, resource_id text, workspace_id text, status text);
  CREATE TABLE service_accounts (id text PRIMARY KEY, workspace_id text, tenant_id text, iam_realm text, kc_client_id text, kc_client_uuid text, display_name text);
  CREATE TABLE workspace_api_keys (id serial PRIMARY KEY, tenant_id text, workspace_id text, key_type text, key_prefix text, key_hash text, scopes jsonb);
  CREATE TABLE async_operations (operation_id text PRIMARY KEY, tenant_id text, status text);
  CREATE TABLE async_operation_transitions (id serial PRIMARY KEY, operation_id text, tenant_id text);
  CREATE TABLE flow_definitions (id text PRIMARY KEY, tenant_id text, workspace_id text);
  CREATE TABLE flow_versions (flow_id text REFERENCES flow_definitions(id), version int, tenant_id text, workspace_id text, definition jsonb, PRIMARY KEY(flow_id, version));
  CREATE TABLE flow_schedules (id text PRIMARY KEY, flow_id text REFERENCES flow_definitions(id), tenant_id text);
  CREATE TABLE flow_trigger_secrets (id text PRIMARY KEY, flow_id text REFERENCES flow_definitions(id), tenant_id text, workspace_id text);
  CREATE TABLE flow_trigger_registrations (id text PRIMARY KEY, flow_id text REFERENCES flow_definitions(id), tenant_id text, workspace_id text);
  CREATE TABLE tenant_plan_assignments (id text PRIMARY KEY, tenant_id text);
  CREATE TABLE tenant_plan_change_history (id text PRIMARY KEY, tenant_id text);
  CREATE TABLE tenant_plan_quota_impacts (id text PRIMARY KEY, history_id text REFERENCES tenant_plan_change_history(id) ON DELETE CASCADE, tenant_id text);
  CREATE TABLE tenant_plan_capability_impacts (id text PRIMARY KEY, history_id text REFERENCES tenant_plan_change_history(id) ON DELETE CASCADE, tenant_id text);
  CREATE TABLE workspace_sub_quotas (id text PRIMARY KEY, workspace_id text REFERENCES workspaces(id), tenant_id text);
  CREATE TABLE service_account_rotation_states (id text PRIMARY KEY, tenant_id text, workspace_id text);
  CREATE TABLE service_account_rotation_history (id text PRIMARY KEY, tenant_id text, workspace_id text, state_id text REFERENCES service_account_rotation_states(id));
  CREATE TABLE tenant_rotation_policies (id text PRIMARY KEY, tenant_id text);
  ${EXTRA_TABLES.map((table) => `CREATE TABLE ${table} (id text PRIMARY KEY, tenant_id text, workspace_id text);`).join('\n')}
  ALTER TABLE webhook_deliveries ADD COLUMN subscription_id text REFERENCES webhook_subscriptions(id);
  ALTER TABLE webhook_signing_secrets ADD COLUMN subscription_id text REFERENCES webhook_subscriptions(id);
  ALTER TABLE scheduled_executions ADD COLUMN job_id text REFERENCES scheduled_jobs(id);
  CREATE TABLE webhook_delivery_attempts (id text PRIMARY KEY, delivery_id text REFERENCES webhook_deliveries(id));
  CREATE TABLE saga_instances (saga_id text PRIMARY KEY, tenant_id text);
  CREATE TABLE saga_steps (step_id text PRIMARY KEY, saga_id text REFERENCES saga_instances(saga_id));
  CREATE TABLE saga_compensation_log (id text PRIMARY KEY, saga_id text REFERENCES saga_instances(saga_id), step_id text REFERENCES saga_steps(step_id));
`;

async function seed(ten, ws, dbname) {
  const embeddings = createEmbeddingProviderStore({ pool });
  await embeddings.createConnection(ws, { tenantId: ten, connectionId: 'temporary-default', model: 'mock' });
  await embeddings.createConnection(ws, { tenantId: ten, connectionId: 'non-default', model: 'mock' });
  await embeddings.deleteConnection(ws, 'temporary-default', ten);
  assert.equal((await embeddings.getConnection(ws, 'non-default', ten)).isDefault, false);
  await pool.query("INSERT INTO tenants (id,slug,display_name,iam_realm) VALUES ($1,$1,$1,$1)", [ten]);
  await pool.query('INSERT INTO workspaces (id,tenant_id,slug,display_name) VALUES ($1,$2,$1,$1)', [ws, ten]);
  await pool.query('INSERT INTO workspace_databases (id,workspace_id,tenant_id,engine,database_name,mode,username,host,port) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [`db_${ws}`, ws, ten, 'postgresql', dbname, 'shared', 'falcone', 'h', 5432]);
  await pool.query('INSERT INTO workspace_buckets (id,workspace_id,tenant_id,bucket_name) VALUES ($1,$2,$3,$4)', [`b_${ws}`, ws, ten, `bucket-${ws}`]);
  await pool.query('INSERT INTO workspace_topics (id,workspace_id,tenant_id,topic_name,physical_topic_name) VALUES ($1,$2,$3,$4,$5)', [`t_${ws}`, ws, ten, 'orders', `phys-${ws}`]);
  await pool.query('INSERT INTO workspace_functions (id,workspace_id,tenant_id,name) VALUES ($1,$2,$3,$4)', [`f_${ws}`, ws, ten, 'fn']);
  await pool.query('INSERT INTO fn_actions (resource_id,workspace_id,tenant_id,action_name,ksvc_name) VALUES ($1,$2,$3,$4,$5)', [`a_${ws}`, ws, ten, 'act', `ksvc-${ws}`]);
  await pool.query('INSERT INTO fn_activations (activation_id,resource_id,workspace_id,status) VALUES ($1,$2,$3,$4)', [`act_${ws}`, `a_${ws}`, ws, 'done']);
  await pool.query('INSERT INTO service_accounts (id,workspace_id,tenant_id,iam_realm,kc_client_id,kc_client_uuid,display_name) VALUES ($1,$2,$3,$4,$5,$6,$7)', [`sa_${ws}`, ws, ten, ten, 'cid', 'uuid', 'sa']);
  await pool.query('INSERT INTO workspace_api_keys (tenant_id,workspace_id,key_type,key_prefix,key_hash,scopes) VALUES ($1,$2,$3,$4,$5,$6)', [ten, ws, 'service', 'flc', 'h', '[]']);
  await pool.query('INSERT INTO async_operations (operation_id,tenant_id,status) VALUES ($1,$2,$3)', [`op_${ws}`, ten, 'completed']);
  await pool.query('INSERT INTO async_operation_transitions (operation_id,tenant_id) VALUES ($1,$2)', [`op_${ws}`, ten]);
  await pool.query('INSERT INTO flow_definitions VALUES ($1,$2,$3)', [`flow_${ws}`, ten, ws]);
  await pool.query("INSERT INTO flow_versions VALUES ($1,1,$2,$3,'{}'),($1,2,$2,$3,'{}')", [`flow_${ws}`, ten, ws]);
  for (const table of ['flow_schedules', 'flow_trigger_secrets', 'flow_trigger_registrations']) {
    await pool.query(`INSERT INTO ${table} (id,flow_id,tenant_id) VALUES ($1,$2,$3)`, [`child_${ws}`, `flow_${ws}`, ten]);
    if (table !== 'flow_schedules') await pool.query(`UPDATE ${table} SET workspace_id=$1 WHERE tenant_id=$2`, [ws, ten]);
  }
  await pool.query('INSERT INTO tenant_plan_assignments VALUES ($1,$2)', [`plan_${ws}`, ten]);
  await pool.query('INSERT INTO tenant_plan_change_history VALUES ($1,$2)', [`history_${ws}`, ten]);
  for (const table of ['tenant_plan_quota_impacts', 'tenant_plan_capability_impacts']) {
    await pool.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, [`impact_${ws}`, `history_${ws}`, ten]);
  }
  await pool.query('INSERT INTO workspace_sub_quotas VALUES ($1,$2,$3)', [`quota_${ws}`, ws, ten]);
  for (const table of EXTRA_TABLES) {
    await pool.query(`INSERT INTO ${table} (id,tenant_id,workspace_id) VALUES ($1,$2,$3)`, [`extra_${ws}`, ten, ws]);
  }
  await pool.query('UPDATE webhook_deliveries SET subscription_id=$1 WHERE tenant_id=$2', [`extra_${ws}`, ten]);
  await pool.query('UPDATE webhook_signing_secrets SET subscription_id=$1 WHERE tenant_id=$2', [`extra_${ws}`, ten]);
  await pool.query('UPDATE scheduled_executions SET job_id=$1 WHERE tenant_id=$2', [`extra_${ws}`, ten]);
  await pool.query('INSERT INTO webhook_delivery_attempts VALUES ($1,$2)', [`attempt_${ws}`, `extra_${ws}`]);
  await pool.query('INSERT INTO service_account_rotation_states VALUES ($1,$2,$3)', [`state_${ws}`, ten, ws]);
  await pool.query('INSERT INTO service_account_rotation_history VALUES ($1,$2,$3,$4)', [`rotation_${ws}`, ten, ws, `state_${ws}`]);
  await pool.query('INSERT INTO tenant_rotation_policies VALUES ($1,$2)', [`policy_${ws}`, ten]);
  await pool.query('INSERT INTO saga_instances VALUES ($1,$2)', [`saga_${ws}`, ten]);
  await pool.query('INSERT INTO saga_steps VALUES ($1,$2)', [`step_${ws}`, `saga_${ws}`]);
  await pool.query('INSERT INTO saga_compensation_log VALUES ($1,$2,$3)', [`log_${ws}`, `saga_${ws}`, `step_${ws}`]);
}

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  await pool.query(SCHEMA);
  await createEmbeddingProviderStore({ pool }).ensureSchema();
  await seed(TEN, WS, 'wsdb_purge_me');
  await seed(OTHER, OWS, 'wsdb_keep_me');
  // Mirror the FORCE RLS table set from chart migration 20260612-004-flow-rls.sql
  // and the rotation, webhook, scheduling and realtime source migrations.
  // Keep published versions immutable for the isolated NOLOGIN application role.
  await bootstrap.query('CREATE ROLE cp_purge_app_probe NOLOGIN');
  await pool.query('GRANT USAGE ON SCHEMA public TO cp_purge_app_probe');
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${[...TABLES, 'tenants', 'fn_activations', 'saga_steps', 'saga_compensation_log'].filter((t) => t !== 'flow_versions').join(', ')} TO cp_purge_app_probe`);
  await pool.query('GRANT SELECT, INSERT ON flow_versions TO cp_purge_app_probe');
  for (const table of FORCED_RLS) {
    await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    const scope = table === 'webhook_delivery_attempts'
      ? "EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.id = webhook_delivery_attempts.delivery_id AND d.tenant_id = current_setting('app.tenant_id', true) AND d.workspace_id = current_setting('app.workspace_id', true))"
      : ['tenant_rotation_policies', 'scheduling_configurations'].includes(table)
        ? "tenant_id = current_setting('app.tenant_id', true)"
        : "tenant_id = current_setting('app.tenant_id', true) AND workspace_id = current_setting('app.workspace_id', true)";
    await pool.query(`CREATE POLICY ${table}_tenant_isolation ON ${table} USING (${scope}) WITH CHECK (${scope})`);
  }
  // The chart metadata role owns tables but has neither superuser nor BYPASSRLS.
  await bootstrap.query('CREATE ROLE cp_purge_metadata_probe NOLOGIN NOSUPERUSER NOBYPASSRLS');
  await pool.query('GRANT USAGE ON SCHEMA public TO cp_purge_metadata_probe');
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cp_purge_metadata_probe`);
  for (const table of FORCED_RLS) await pool.query(`ALTER TABLE ${table} OWNER TO cp_purge_metadata_probe`);
  const { rows } = await pool.query('SELECT rolsuper OR rolbypassrls AS admin FROM pg_roles WHERE rolname = current_user');
  assert.equal(rows[0].admin, true, 'fixture setup and privileged-path assertions require a migration-owner/BYPASSRLS connection');
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) { await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {}); await bootstrap.query('DROP ROLE IF EXISTS cp_purge_app_probe').catch(() => {}); await bootstrap.query('DROP ROLE IF EXISTS cp_purge_metadata_probe').catch(() => {}); await bootstrap.end().catch(() => {}); }
});

const TABLES = ['workspace_embedding_connections', 'workspaces', 'workspace_databases', 'workspace_buckets', 'workspace_topics', 'workspace_functions', 'fn_actions', 'service_accounts', 'workspace_api_keys', 'async_operations', 'async_operation_transitions', 'flow_definitions', 'flow_versions', 'flow_schedules', 'flow_trigger_secrets', 'flow_trigger_registrations', 'tenant_plan_assignments', 'tenant_plan_change_history', 'tenant_plan_quota_impacts', 'tenant_plan_capability_impacts', 'workspace_sub_quotas', 'saga_instances', 'service_account_rotation_states', 'service_account_rotation_history', 'tenant_rotation_policies', ...EXTRA_TABLES];

test('metadata owner without BYPASSRLS discloses all fifteen FORCE RLS tables and succeeds idempotently', async () => {
  const tenant = 'tenant_restricted'; const workspace = 'ws_restricted';
  await seed(tenant, workspace, 'wsdb_restricted');
  const restricted = {
    connect: async () => {
      const client = await pool.connect();
      await client.query('SET ROLE cp_purge_metadata_probe');
      return { query: client.query.bind(client), release: () => client.release(true) };
    },
  };
  const result = await store.purgeTenant(restricted, tenant);
  assert.deepEqual([...result.databaseResidual].sort((a, b) => a.table.localeCompare(b.table)),
    FORCED_RLS.map((table) => ({ table, count: null })).sort((a, b) => a.table.localeCompare(b.table)),
    'protected data must be disclosed, even though RLS hides it from the deployed role');
  for (const table of TABLES) {
    const count = (await pool.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [tenant])).rows[0].n;
    assert.equal(count, FORCED_RLS.includes(table) ? (table === 'flow_versions' ? 2 : 1) : 0, table);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [OTHER])).rows[0].n,
      table === 'flow_versions' ? 2 : 1, `${table}: other tenant remains intact`);
  }
  for (const ws of [workspace, OWS]) {
    assert.equal((await pool.query('SELECT count(*)::int n FROM webhook_delivery_attempts WHERE delivery_id=$1', [`extra_${ws}`])).rows[0].n, 1,
      'protected delivery attempts and the other tenant remain intact');
  }
  const again = await store.purgeTenant(restricted, tenant);
  assert.deepEqual(again.databaseResidual, result.databaseResidual);
  const { rows } = await pool.query("SELECT has_table_privilege('cp_purge_app_probe', 'flow_versions', 'DELETE') AS allowed");
  assert.equal(rows[0].allowed, false, 'normal API version immutability stays enforced');
  await store.purgeTenant(pool, tenant); // privileged path can finish the disclosed cleanup
  for (const table of FORCED_RLS.filter((table) => table !== 'webhook_delivery_attempts')) {
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [tenant])).rows[0].n, 0);
  }
  assert.equal((await pool.query('SELECT count(*)::int n FROM webhook_delivery_attempts WHERE delivery_id=$1', [`extra_${workspace}`])).rows[0].n, 0);
});

test('purgeTenant removes every owned row + returns the physical resources to tear down', async () => {
  const phys = await store.purgeTenant(pool, TEN);
  assert.deepEqual(phys.databaseResidual, []);
  assert.deepEqual(phys.databases, ['wsdb_purge_me'], 'returns the wsdb_* to drop');
  assert.deepEqual(phys.buckets, ['bucket-ws_purge']);
  assert.deepEqual(phys.topics, ['phys-ws_purge']);
  assert.deepEqual(phys.ksvcs, ['ksvc-ws_purge']);

  for (const t of [...TABLES, 'fn_activations']) {
    const col = t === 'fn_activations' ? 'workspace_id' : (['workspaces'].includes(t) ? 'tenant_id' : 'tenant_id');
    const val = t === 'fn_activations' ? WS : TEN;
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${t} WHERE ${col} = $1`, [val]);
    assert.equal(rows[0].n, 0, `${t} has no rows for the purged tenant`);
  }
  assert.equal((await pool.query('SELECT count(*)::int n FROM webhook_delivery_attempts WHERE delivery_id=$1', [`extra_${WS}`])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM webhook_delivery_attempts WHERE delivery_id=$1', [`extra_${OWS}`])).rows[0].n, 1);
  const { rows: tt } = await pool.query('SELECT count(*)::int n FROM tenants WHERE id=$1', [TEN]);
  assert.equal(tt[0].n, 0, 'the tenant row itself is gone');
  for (const table of ['saga_steps', 'saga_compensation_log']) {
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE saga_id=$1`, [`saga_${WS}`])).rows[0].n, 0);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE saga_id=$1`, [`saga_${OWS}`])).rows[0].n, 1);
  }
});

test('another tenant\'s rows are untouched (no over-deletion)', async () => {
  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${t} WHERE tenant_id = $1`, [OTHER]);
    assert.equal(rows[0].n, t === 'flow_versions' ? 2 : 1, `${t} still has the other tenant's row`);
  }
  const { rows } = await pool.query('SELECT count(*)::int n FROM tenants WHERE id=$1', [OTHER]);
  assert.equal(rows[0].n, 1, 'the other tenant survives');
});

test('purge is idempotent (a second run is a no-op, not an error)', async () => {
  const phys = await store.purgeTenant(pool, TEN);
  assert.deepEqual(phys.databases, [], 'nothing left to tear down');
  for (const table of TABLES) {
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [OTHER])).rows[0].n,
      table === 'flow_versions' ? 2 : 1, `${table} still survives a second purge`);
  }
});

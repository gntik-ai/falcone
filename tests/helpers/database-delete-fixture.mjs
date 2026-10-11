// In-memory database boundary for the public database lifecycle handlers (#967).
export function databaseDeleteFixture() {
  const workspace = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app' };
  const pg = [{ id: 'db-a', workspace_id: workspace.id, tenant_id: workspace.tenant_id,
    database_name: 'wsdb_tenant_a_app', engine: 'postgresql', mode: 'dedicated_role' }];
  const mongo = [];
  const physical = new Set(['wsdb_tenant_a_app']);
  const roles = new Set(['wsdb_tenant_a_app_app']);
  const audit = [];
  const other = {
    workspace_buckets: [{ bucket_name: 'bucket-a' }],
    workspace_topics: [{ id: 'topic-a', topic_name: 'events', partitions: 1 }],
    workspace_functions: [{ id: 'fn-a', name: 'hello' }],
    service_accounts: [{ id: 'sa-a', kc_client_id: 'sa-client', status: 'active' }],
  };
  const query = async (sql, values = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('SELECT row_hash, created_at FROM plan_audit_events')) return { rows: audit.slice(-1) };
    if (sql.includes('INSERT INTO plan_audit_events')) {
      const row = { id: values[0], action_type: values[1], actor_id: values[2], tenant_id: values[3],
        new_state: JSON.parse(values[5]), outcome: values[6], correlation_id: values[7],
        created_at: values[8], row_hash: values[10] };
      audit.push(row);
      return { rows: [row] };
    }
    if (sql.includes('FROM plan_audit_events')) return { rows: audit.filter((r) => r.tenant_id === values[0]
      && (typeof values[1] === 'number' || r.new_state.workspaceId === values[1])) };
    if (/^\s*(INSERT INTO|UPDATE) (saga_|async_operation)/.test(sql)) return { rows: [] };
    for (const [table, rows] of Object.entries(other)) if (sql.includes(`FROM ${table}`)) return { rows };
    if (sql.includes('INSERT INTO workspace_databases')) {
      const row = { id: values[0], workspace_id: values[1], tenant_id: values[2], engine: values[3],
        database_name: values[4], mode: values[5], username: values[6], host: values[7], port: values[8] };
      pg.push(row);
      return { rows: [row] };
    }
    if (sql.includes('COUNT(*)') && /workspace_(mongo_)?databases/.test(sql)) {
      const rows = sql.includes('workspace_mongo_databases') ? mongo : pg;
      return { rows: [{ value: rows.filter((r) => r.tenant_id === values[0]
        && (values[1] == null || r.workspace_id === values[1])
        && (!sql.includes("engine = 'mongodb'") || r.engine === 'mongodb')).length }] };
    }
    if (sql.includes('FROM workspaces')) return { rows: values[0] === workspace.id ? [workspace] : [] };
    if (sql.includes('FROM tenants')) return { rows: [{ id: workspace.tenant_id, iam_realm: 'tenant-a', slug: 'tenant_a' }] };
    if (/^\s*SELECT/.test(sql) && sql.includes('FROM workspace_databases')) return { rows: pg.filter((r) => r.workspace_id === values[0]) };
    if (/^\s*SELECT/.test(sql) && sql.includes('FROM workspace_mongo_databases')) return { rows: mongo.filter((r) => r.workspace_id === values[0] && r.database_name === values[1]) };
    if (sql.startsWith('DELETE FROM workspace_databases')) {
      const i = pg.findIndex((r) => r.id === values[0]);
      if (i !== -1) pg.splice(i, 1);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM workspace_mongo_databases')) {
      const i = mongo.findIndex((r) => r.workspace_id === values[0] && r.database_name === values[1]);
      if (i !== -1) mongo.splice(i, 1);
      return { rows: [] };
    }
    if (sql.includes('FROM pg_database')) return { rows: physical.has(values[0]) ? [{}] : [] };
    if (sql.includes('FROM pg_roles')) return { rows: sql.includes('rolcreaterole') ? [{ can: true }] : roles.has(values[0]) ? [{}] : [] };
    if (sql.startsWith('CREATE DATABASE')) { physical.add(/"([^"]+)"/.exec(sql)[1]); return { rows: [] }; }
    if (sql.startsWith('CREATE ROLE')) { roles.add(/"([^"]+)"/.exec(sql)[1]); return { rows: [] }; }
    if (sql.startsWith('GRANT CONNECT') || sql.startsWith('REVOKE CONNECT')) return { rows: [] };
    if (sql.includes('pg_terminate_backend')) return { rows: [] };
    if (sql.startsWith('DROP DATABASE')) { physical.delete(/"([^"]+)"/.exec(sql)[1]); return { rows: [] }; }
    if (sql.startsWith('DROP ROLE')) { roles.delete(/"([^"]+)"/.exec(sql)[1]); return { rows: [] }; }
    throw new Error('unexpected database operation in lifecycle fixture');
  };
  return { workspace, pg, mongo, physical, roles, ctx: {
    pool: { query }, params: { workspaceId: workspace.id, databaseName: pg[0].database_name },
    identity: { sub: 'owner-a', actorType: 'tenant_owner', tenantId: workspace.tenant_id, roles: ['tenant_owner'] },
    query: {}, body: {}, isWorkspaceDatabaseEmpty: async () => true,
  } };
}

export function mongoDeleteFixture(documents = []) {
  const h = databaseDeleteFixture();
  h.ctx.query.engine = 'mongodb';
  h.ctx.params.databaseName = 'shared';
  h.mongo.push({ workspace_id: 'ws-a', tenant_id: 'tenant-a', database_name: 'shared' });
  let dropped = false;
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value);
  const collection = {
    async countDocuments(filter) { return documents.filter((doc) => matches(doc, filter)).length; },
    async deleteMany(filter) {
      for (let i = documents.length - 1; i >= 0; i--) if (matches(documents[i], filter)) documents.splice(i, 1);
    },
  };
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: 'notes', type: 'collection' }] }),
    collection: () => collection,
    async dropDatabase() { dropped = true; },
  };
  h.ctx.mongoClient = { db: () => db };
  return { ...h, documents, db, wasDropped: () => dropped };
}

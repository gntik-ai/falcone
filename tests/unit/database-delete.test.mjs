import test from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../../apps/control-plane/routes.mjs';
import { loadRoutes, matchRoute } from '../../apps/control-plane/route-table.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { databaseDeleteFixture, mongoDeleteFixture } from '../helpers/database-delete-fixture.mjs';
import { auditEventForRoute } from '../../apps/control-plane/audit-writer.mjs';

test('#967: database DELETE resolves to an authenticated local handler', () => {
  const matched = matchRoute(loadRoutes(routes), 'DELETE', '/v1/workspaces/ws-a/databases/wsdb_tenant_a_app');
  assert.ok(matched, 'database DELETE must resolve instead of NO_ROUTE');
  assert.equal(matched.route.localHandler, 'deleteDatabase');
  assert.equal(matched.route.auth, 'authenticated');
  assert.deepEqual({ ...matched.params }, { workspaceId: 'ws-a', databaseName: 'wsdb_tenant_a_app' });
});

test('#967: owner deletes an empty Postgres database and its role, then reads 404', async () => {
  const h = databaseDeleteFixture();
  const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { workspaceId: 'ws-a', databaseName: 'wsdb_tenant_a_app', engine: 'postgresql', deleted: true });
  assert.equal(h.physical.size, 0);
  assert.equal(h.roles.size, 0);
  assert.equal((await LOCAL_HANDLERS.getDatabase(h.ctx)).body.code, 'DB_NOT_PROVISIONED');
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.code, 'DATABASE_NOT_FOUND');
});

test('#967: the default Postgres probe protects a database with user tables until force=true', async () => {
  const h = databaseDeleteFixture();
  delete h.ctx.isWorkspaceDatabaseEmpty;
  h.ctx.pgClient = { query: async () => ({ rows: [{ empty: false }] }) };
  const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'DATABASE_NOT_EMPTY');
  assert.equal(h.pg.length, 1);
  assert.equal(h.physical.size, 1);
  h.ctx.query.force = 'true';
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 200);
});

test('#967: cross-tenant and missing workspaces have identical responses and preserve resources', async () => {
  const foreign = databaseDeleteFixture();
  foreign.ctx.identity.tenantId = 'tenant-other';
  const missing = databaseDeleteFixture();
  missing.ctx.params.workspaceId = 'ws-missing';
  assert.deepEqual(await LOCAL_HANDLERS.deleteDatabase(foreign.ctx), await LOCAL_HANDLERS.deleteDatabase(missing.ctx));
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(foreign.ctx)).statusCode, 404);
  assert.equal(foreign.physical.size, 1);
  assert.equal(foreign.pg.length, 1);
});

test('#967: same-tenant callers without database.admin receive 403', async () => {
  const h = databaseDeleteFixture();
  h.ctx.identity.roles = ['tenant_viewer'];
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.code, 'FORBIDDEN');
  assert.equal(h.physical.size, 1);
});

test('#967: admin and superadmin can delete; request body cannot redirect scope', async () => {
  for (const role of ['tenant_admin', 'superadmin']) {
    const h = databaseDeleteFixture();
    h.ctx.identity.roles = [role];
    h.ctx.identity.actorType = role;
    if (role === 'superadmin') h.ctx.identity.tenantId = null;
    h.ctx.body = { tenantId: 'tenant-other', workspaceId: 'ws-other', force: true };
    const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
  }
});

test('#967: body-supplied force cannot bypass the non-empty database guard', async () => {
  for (const fixture of [
    () => {
      const h = databaseDeleteFixture();
      h.ctx.isWorkspaceDatabaseEmpty = async () => false;
      return h;
    },
    () => mongoDeleteFixture([{ tenantId: 'tenant-a', workspaceId: 'ws-a' }]),
  ]) {
    const h = fixture();
    h.ctx.body = { force: true };
    const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.code, 'DATABASE_NOT_EMPTY');
    assert.equal(h.pg.length, 1);
    assert.equal(h.physical.size, 1);
    assert.equal(h.roles.size, 1);
    if (h.documents) {
      assert.deepEqual(h.documents, [{ tenantId: 'tenant-a', workspaceId: 'ws-a' }]);
      assert.equal(h.mongo.length, 1);
      assert.equal(h.wasDropped(), false);
    }
  }
});

test('#967: foreign registry records are indistinguishable from missing databases', async () => {
  const foreign = databaseDeleteFixture();
  foreign.pg[0].tenant_id = 'tenant-other';
  const missing = databaseDeleteFixture();
  missing.pg.length = 0;
  assert.deepEqual(await LOCAL_HANDLERS.deleteDatabase(foreign.ctx), await LOCAL_HANDLERS.deleteDatabase(missing.ctx));
  assert.equal(foreign.physical.size, 1);
});

test('#967: probe and physical drop failures keep the registry and redact backend messages', async () => {
  for (const seam of ['isWorkspaceDatabaseEmpty', 'dropWorkspaceDatabase']) {
    const h = databaseDeleteFixture();
    h.ctx[seam] = async () => { throw new Error('password=fixture-secret postgres://fixture-dsn'); };
    const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
    assert.equal(result.statusCode, 502);
    assert.equal(h.pg.length, 1);
    assert.equal(h.physical.size, 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-dsn/);
  }
});

test('#967: already-missing physical Postgres database succeeds without a probe connection', async () => {
  const h = databaseDeleteFixture();
  h.physical.clear();
  delete h.ctx.isWorkspaceDatabaseEmpty;
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 200);
  assert.equal(h.pg.length, 0);
  assert.equal(h.roles.size, 0);
});

test('#967: a failed dedicated-role drop keeps the registry for retry', async () => {
  const h = databaseDeleteFixture();
  const query = h.ctx.pool.query;
  h.ctx.pool.query = async (sql, values) => {
    if (sql.startsWith('DROP ROLE')) throw new Error('role drop unavailable');
    return query(sql, values);
  };
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 502);
  assert.equal(h.pg.length, 1);
  h.ctx.pool.query = query;
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 200);
  assert.equal(h.roles.size, 0);
});

test('#967: Mongo force deletes only matching tenant AND workspace documents and retains a shared database', async () => {
  const h = mongoDeleteFixture([
    { tenantId: 'tenant-a', workspaceId: 'ws-a', text: 'delete' },
    { tenantId: 'tenant-a', workspaceId: 'ws-other', text: 'other workspace' },
    { tenantId: 'tenant-other', workspaceId: 'ws-a', text: 'other tenant' },
    { tenantId: 'tenant-a', text: 'legacy unscoped' },
  ]);
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.code, 'DATABASE_NOT_EMPTY');
  assert.equal(h.documents.length, 4);
  h.ctx.query.force = 'true';
  const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { workspaceId: 'ws-a', databaseName: 'shared', engine: 'mongodb', deleted: true, retained: true });
  assert.deepEqual(h.documents.map((doc) => doc.text), ['other workspace', 'other tenant', 'legacy unscoped']);
  assert.equal(h.wasDropped(), false);
  assert.equal(h.mongo.length, 0);
  assert.equal(h.pg.length, 1);
});

test('#967: an invalid engine is rejected without deleting either registry', async () => {
  const h = databaseDeleteFixture();
  h.ctx.query.engine = 'mysql';
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 400);
  assert.equal(h.pg.length, 1);
  assert.equal(h.physical.size, 1);
});

test('#967: database delete attempts audit actual outcomes with trusted tenant/workspace scope', async () => {
  const route = routes.find((r) => r.localHandler === 'deleteDatabase');
  const cases = [
    ['succeeded', (h) => { h.ctx.identity.actorType = 'superadmin'; h.ctx.identity.tenantId = null; }],
    ['denied', (h) => { h.ctx.identity.roles = ['tenant_viewer']; }],
    ['failed', (h) => { h.ctx.isWorkspaceDatabaseEmpty = async () => false; }],
    ['failed', (h) => { h.pg.length = 0; }],
    ['failed', (h) => { h.ctx.identity.tenantId = 'tenant-other'; }],
    ['error', (h) => { h.ctx.dropWorkspaceDatabase = async () => { throw new Error('password=fixture-secret'); }; }],
  ];
  for (const [outcome, arrange] of cases) {
    const h = databaseDeleteFixture();
    arrange(h);
    h.ctx.body = { tenantId: 'spoofed', workspaceId: 'spoofed', password: 'fixture-secret' };
    const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
    const audit = auditEventForRoute(route, h.ctx, result);
    assert.ok(audit);
    assert.equal(audit.actionType, 'workspace.database.delete');
    assert.equal(audit.outcome, outcome);
    assert.equal(audit.tenantId, h.ctx.identity.tenantId === 'tenant-other' ? 'tenant-other' : 'tenant-a');
    assert.equal(audit.workspaceId, 'ws-a');
    assert.doesNotMatch(JSON.stringify(audit), /fixture-secret|spoofed|password|dsn/i);
  }
});

test('#967: a registry outage returns a safe auditable 502 without dropping anything', async () => {
  const h = databaseDeleteFixture();
  h.ctx.pool.query = async () => { throw new Error('password=fixture-secret'); };
  const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
  assert.equal(result.statusCode, 502);
  assert.equal(h.physical.size, 1);
  assert.equal(auditEventForRoute(routes.find((r) => r.localHandler === 'deleteDatabase'), h.ctx, result).outcome, 'error');
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
});

test('#967: superadmin attempts on missing workspaces are audited without inventing an owning tenant', async () => {
  const h = databaseDeleteFixture();
  h.ctx.identity = { sub: 'platform-a', actorType: 'superadmin' };
  h.ctx.params.workspaceId = 'ws-missing';
  const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
  const audit = auditEventForRoute(routes.find((r) => r.localHandler === 'deleteDatabase'), h.ctx, result);
  assert.ok(audit);
  assert.equal(audit.tenantId, null);
  assert.equal(audit.workspaceId, 'ws-missing');
  assert.equal(audit.outcome, 'failed');
});

test('#967: Mongo drops an empty database and force drops a sole-workspace database', async () => {
  for (const force of [false, true]) {
    const h = mongoDeleteFixture(force ? [{ tenantId: 'tenant-a', workspaceId: 'ws-a' }] : []);
    if (force) h.ctx.query.force = 'true';
    const result = await LOCAL_HANDLERS.deleteDatabase(h.ctx);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.retained, false);
    assert.equal(h.wasDropped(), true);
    assert.equal(h.documents.length, 0);
    assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.code, 'DATABASE_NOT_FOUND');
  }
});

test('#967: Mongo teardown or emptiness-probe failure leaves the registry retryable', async () => {
  for (const failDrop of [false, true]) {
    const h = mongoDeleteFixture();
    if (failDrop) h.db.dropDatabase = async () => { throw new Error('backend unavailable'); };
    else h.db.listCollections = () => { throw new Error('backend unavailable'); };
    assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 502);
    assert.equal(h.mongo.length, 1);
  }
});

test('#967: explicit engine chooses between overlapping registry names; omitted engine discovers Mongo', async () => {
  for (const engine of ['postgresql', 'mongodb', undefined]) {
    const h = mongoDeleteFixture();
    h.mongo[0].database_name = h.pg[0].database_name;
    h.ctx.params.databaseName = h.pg[0].database_name;
    h.ctx.query = engine ? { engine } : {};
    assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.engine, engine ?? 'postgresql');
    assert.equal(h.pg.length, engine === 'mongodb' ? 1 : 0);
    assert.equal(h.mongo.length, engine === 'mongodb' ? 0 : 1);
  }
  const h = mongoDeleteFixture();
  h.ctx.query = {};
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.engine, 'mongodb');
});

test('#967: a non-Postgres registry entry cannot reach the Postgres dropper', async () => {
  const h = databaseDeleteFixture();
  h.pg[0].engine = 'mongodb';
  h.ctx.query.engine = 'postgresql';
  assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).body.code, 'DATABASE_NOT_FOUND');
  assert.equal(h.physical.size, 1);
});

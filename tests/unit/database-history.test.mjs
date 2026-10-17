import test from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../../apps/control-plane/routes.mjs';
import { loadRoutes, matchRoute } from '../../apps/control-plane/route-table.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { auditEventForRoute, recordRouteAudit, recordRouteDenial } from '../../apps/control-plane/audit-writer.mjs';

const historyPath = '/v1/workspaces/{workspaceId}/database/history';
const at = '2026-01-01T00:00:00.000Z';
const operation = (overrides = {}) => ({
  transition_id: 'op-start', tenant_id: 'tenant-a', transition_tenant_id: 'tenant-a', workspace_id: 'ws-a',
  operation_type: 'workspace.database.provision', previous_status: 'pending', new_status: 'running',
  transitioned_at: new Date(at), actor_id: 'provision-actor', correlation_id: 'provision-correlation',
  ...overrides,
});
const audit = (overrides = {}) => ({
  id: 'audit-success', tenant_id: 'tenant-a', action_type: 'workspace.database.credential.rotate',
  created_at: at, outcome: 'succeeded', actor_id: 'rotation-actor', correlation_id: null,
  new_state: { workspaceId: 'ws-a', status: 201 }, ...overrides,
});

function newest(rows, time, id) {
  return rows.slice().sort((a, b) => new Date(b[time]) - new Date(a[time])
    || (a[id] < b[id] ? 1 : a[id] > b[id] ? -1 : 0)).slice(0, 201);
}

function fixture() {
  const h = {
    ws: { id: 'ws-a', tenant_id: 'tenant-a' },
    tenant: { id: 'tenant-a', iam_realm: 'realm-a' },
    database: { id: 'db-a', workspace_id: 'ws-a', tenant_id: 'tenant-a' },
    operations: [], audits: [], queries: [],
  };
  h.ctx = {
    params: { workspaceId: 'ws-a' }, query: {}, body: {},
    identity: { sub: 'owner-a', actorType: 'tenant_owner', tenantId: 'tenant-a' },
    store: {
      async getWorkspace(_pool, id) { return id === h.ws?.id ? h.ws : null; },
      async getTenant(_pool, id) { return id === h.tenant?.id ? h.tenant : null; },
      async getWorkspaceDatabase() { return h.database; },
    },
    pool: {
      async query(sql, values) {
        h.queries.push({ sql, values });
        assert.match(sql, /^\s*SELECT\b/i, 'history must only read');
        assert.match(sql, /tenant_id\s*=\s*\$1/);
        assert.deepEqual(values, ['tenant-a', 'ws-a'], 'scope comes from the resolved workspace');
        if (/FROM workspace_databases/.test(sql)) {
          assert.match(sql, /workspace_id\s*=\s*\$2/);
          return { rows: h.database ? [h.database] : [] };
        }
        if (/JOIN async_operations/.test(sql)) {
          assert.match(sql, /o\.operation_id\s*=\s*t\.operation_id/);
          assert.match(sql, /o\.tenant_id\s*=\s*\$1/);
          assert.match(sql, /t\.tenant_id\s*=\s*\$1/);
          assert.match(sql, /o\.workspace_id\s*=\s*\$2/);
          assert.match(sql, /operation_type\s*=\s*'workspace\.database\.provision'/);
          assert.match(sql, /previous_status\s*=\s*'pending'.*new_status\s*=\s*'running'/s);
          assert.match(sql, /previous_status\s*=\s*'running'.*new_status IN \('completed', 'failed'\)/s);
          assert.match(sql, /ORDER BY t\.transitioned_at DESC, t\.transition_id DESC\s+LIMIT 201/);
          if (h.operationError) throw h.operationError;
          const rows = h.operations.filter(row => row.tenant_id === values[0]
            && row.transition_tenant_id === values[0] && row.workspace_id === values[1]
            && row.operation_type === 'workspace.database.provision'
            && ((row.previous_status === 'pending' && row.new_status === 'running')
              || (row.previous_status === 'running' && ['completed', 'failed'].includes(row.new_status))));
          return { rows: newest(rows, 'transitioned_at', 'transition_id') };
        }
        if (/FROM plan_audit_events/.test(sql)) {
          assert.match(sql, /action_type\s*=\s*'workspace\.database\.credential\.rotate'/);
          assert.match(sql, /new_state->>'workspaceId'\s*=\s*\$2/);
          assert.match(sql, /outcome IN \('succeeded', 'failed', 'error'\)/);
          assert.match(sql, /new_state->>'status'\)? IS DISTINCT FROM '404'/);
          assert.match(sql, /ORDER BY created_at DESC, id DESC\s+LIMIT 201/);
          const rows = h.audits.filter(row => row.tenant_id === values[0]
            && row.new_state.workspaceId === values[1]
            && row.action_type === 'workspace.database.credential.rotate'
            && ['succeeded', 'failed', 'error'].includes(row.outcome)
            && String(row.new_state.status) !== '404');
          return { rows: newest(rows, 'created_at', 'id') };
        }
        assert.fail(`unexpected history query: ${sql}`);
      },
    },
  };
  return h;
}

test('database history resolves to an authenticated local handler', () => {
  const match = matchRoute(loadRoutes(routes), 'GET', '/v1/workspaces/ws-a/database/history');
  assert.ok(match, 'history must resolve instead of NO_ROUTE');
  assert.equal(match.route.path, historyPath);
  assert.equal(match.route.auth, 'authenticated');
  assert.equal(match.route.localHandler, 'getDatabaseHistory');
  assert.equal(typeof LOCAL_HANDLERS[match.route.localHandler], 'function');
  assert.deepEqual({ ...match.params }, { workspaceId: 'ws-a' });
});

test('history uses the getDatabase management roles and resolver errors before querying events', async () => {
  for (const actorType of ['superadmin', 'internal', 'tenant_owner', 'tenant_admin']) {
    const h = fixture();
    h.ctx.identity.actorType = actorType;
    if (['superadmin', 'internal'].includes(actorType)) h.ctx.identity.tenantId = 'tenant-b';
    assert.deepEqual(await LOCAL_HANDLERS.getDatabaseHistory(h.ctx), {
      statusCode: 200,
      body: { items: [], page: { size: 0, hasMore: false }, completeness: 'best_effort' },
    });
  }
  for (const [arrange, status, code] of [
    [h => { h.ctx.identity.tenantId = 'tenant-b'; }, 403, 'FORBIDDEN'],
    [h => { h.ctx.identity.actorType = 'workspace_developer'; }, 403, 'FORBIDDEN'],
    [h => { h.ws = null; }, 404, 'WORKSPACE_NOT_FOUND'],
    [h => { h.tenant.iam_realm = null; }, 409, 'NO_REALM'],
  ]) {
    const h = fixture();
    arrange(h);
    const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
    assert.deepEqual(result, await LOCAL_HANDLERS.getDatabase(h.ctx));
    assert.equal(result.statusCode, status);
    assert.equal(result.body.code, code);
    assert.equal(result.body.items, undefined);
    assert.equal(h.queries.length, 0);
  }
});

test('history requires a provisioned workspace database', async () => {
  const h = fixture();
  h.database = null;
  const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.code, 'DB_NOT_PROVISIONED');
  assert.equal(result.body.items, undefined);
});

test('history maps saga transitions to allowlisted provisioning events', async () => {
  const h = fixture();
  h.operations = [
    operation(),
    operation({ transition_id: 'op-done', previous_status: 'running', new_status: 'completed',
      transitioned_at: '2026-01-01T01:00:00+01:00', actor_id: 'completion-actor' }),
    operation({ transition_id: 'op-failed', previous_status: 'running', new_status: 'failed',
      transitioned_at: '2026-01-02T00:00:00Z', correlation_id: 'failed-correlation' }),
    operation({ transition_id: 'ignored', previous_status: 'completed', new_status: 'running' }),
    operation({ transition_id: 'another-operation', operation_type: 'workspace.create' }),
  ];
  const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    items: [
      { eventId: 'op-done', type: 'database.provisioned', occurredAt: at, outcome: 'succeeded',
        actorId: 'completion-actor', correlationId: 'provision-correlation', source: 'operation' },
      { eventId: 'op-start', type: 'database.provision_started', occurredAt: at, outcome: 'succeeded',
        actorId: 'provision-actor', correlationId: 'provision-correlation', source: 'operation' },
      { eventId: 'op-failed', type: 'database.provision_failed', occurredAt: '2026-01-02T00:00:00.000Z', outcome: 'failed',
        actorId: 'provision-actor', correlationId: 'failed-correlation', source: 'operation' },
    ], page: { size: 3, hasMore: false }, completeness: 'best_effort',
  });
});

test('history maps rotation outcomes and excludes denied, 404 and unrelated audit rows', async () => {
  const h = fixture();
  h.audits = [
    audit(),
    audit({ id: 'audit-failed', outcome: 'failed', correlation_id: 'rotation-correlation',
      created_at: new Date('2026-01-02T00:00:00Z'), new_state: { workspaceId: 'ws-a', status: 409 } }),
    audit({ id: 'audit-error', outcome: 'error', created_at: '2026-01-03T01:00:00+01:00',
      new_state: { workspaceId: 'ws-a', status: 502 } }),
    audit({ id: 'denied', outcome: 'denied', new_state: { workspaceId: 'ws-a', status: 403 } }),
    audit({ id: 'not-found', outcome: 'failed', new_state: { workspaceId: 'ws-a', status: 404 } }),
    audit({ id: 'not-found-string', outcome: 'error', new_state: { workspaceId: 'ws-a', status: '404' } }),
    audit({ id: 'provision-audit', action_type: 'workspace.database.provision' }),
  ];
  const { body, statusCode } = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(statusCode, 200);
  assert.deepEqual(body, {
    items: [
      { eventId: 'audit-success', type: 'database.credential_rotated', occurredAt: at, outcome: 'succeeded',
        actorId: 'rotation-actor', correlationId: null, source: 'audit' },
      { eventId: 'audit-failed', type: 'database.credential_rotation_failed', occurredAt: '2026-01-02T00:00:00.000Z',
        outcome: 'failed', actorId: 'rotation-actor', correlationId: 'rotation-correlation', source: 'audit' },
      { eventId: 'audit-error', type: 'database.credential_rotation_failed', occurredAt: '2026-01-03T00:00:00.000Z',
        outcome: 'error', actorId: 'rotation-actor', correlationId: null, source: 'audit' },
    ], page: { size: 3, hasMore: false }, completeness: 'best_effort',
  });
});

test('mixed history is stable by timestamp, operation before audit, then event ID', async () => {
  const h = fixture();
  h.operations = [operation({ transition_id: 'z-operation' }), operation({ transition_id: 'b-operation' }),
    operation({ transition_id: 'last', transitioned_at: '2026-01-03T00:00:00Z' })];
  h.audits = [audit({ id: 'a-audit' }), audit({ id: 'c-audit' }),
    audit({ id: 'first', created_at: '2025-12-31T23:59:59Z' })];
  const first = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.deepEqual(first.body.items.map(item => item.eventId),
    ['first', 'b-operation', 'z-operation', 'a-audit', 'c-audit', 'last']);
  assert.deepEqual(first.body.page, { size: 6, hasMore: false });
  h.operations.reverse();
  h.audits.reverse();
  assert.deepEqual((await LOCAL_HANDLERS.getDatabaseHistory(h.ctx)).body, first.body);
});

test('history keeps the most recent 200 matching events and detects dropped older events', async () => {
  for (const [opCount, auditCount, firstId, lastId, hasMore] of [
    [250, 0, 'op-050', 'op-249', true],
    [0, 250, 'audit-050', 'audit-249', true],
    [125, 125, 'op-050', 'audit-124', true],
    [100, 100, 'op-000', 'audit-099', false],
    [201, 0, 'op-001', 'op-200', true],
  ]) {
    const h = fixture();
    h.operations = Array.from({ length: opCount }, (_, i) => operation({ transition_id: `op-${String(i).padStart(3, '0')}` }));
    h.audits = Array.from({ length: auditCount }, (_, i) => audit({ id: `audit-${String(i).padStart(3, '0')}` }));
    const { body } = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
    assert.deepEqual(body.page, { size: 200, hasMore });
    assert.equal(body.items.length, 200);
    assert.equal(body.items[0].eventId, firstId);
    assert.equal(body.items.at(-1).eventId, lastId);
    assert.deepEqual((await LOCAL_HANDLERS.getDatabaseHistory(h.ctx)).body, body);
  }
});

test('unavailable operation tables degrade to audit-only history without echoing database errors', async () => {
  for (const code of ['42P01', '42501']) {
    const h = fixture();
    h.operations = [operation()];
    h.audits = [audit()];
    h.operationError = Object.assign(new Error('undefined_table password=fixture-secret postgres://fixture-dsn'), { code });
    const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.items.map(item => item.eventId), ['audit-success']);
    assert.deepEqual(result.body.page, { size: 1, hasMore: false });
    assert.equal(result.body.completeness, 'best_effort');
    assert.doesNotMatch(JSON.stringify(result), /undefined_table|fixture-secret|fixture-dsn/);
  }
});

test('privileged reads use resolved tenant and workspace even with colliding IDs and hostile request scope', async () => {
  const h = fixture();
  h.ctx.identity.actorType = 'superadmin';
  h.ctx.identity.tenantId = 'tenant-b';
  h.ctx.query = { tenantId: 'tenant-b', workspaceId: 'ws-sibling' };
  h.ctx.body = { tenantId: 'tenant-b', workspaceId: 'ws-sibling' };
  h.operations = [operation(),
    operation({ transition_id: 'other-tenant', tenant_id: 'tenant-b', transition_tenant_id: 'tenant-b' }),
    operation({ transition_id: 'other-workspace', workspace_id: 'ws-sibling' }),
    operation({ transition_id: 'foreign-transition', transition_tenant_id: 'tenant-b' })];
  h.audits = [audit(), audit({ id: 'other-tenant-audit', tenant_id: 'tenant-b' }),
    audit({ id: 'other-workspace-audit', new_state: { workspaceId: 'ws-sibling', status: 201 } })];
  // Newer nonmatching records must not consume either source's 201-row budget.
  for (let i = 0; i < 250; i++) {
    h.operations.push(operation({ transition_id: `foreign-${i}`, tenant_id: 'tenant-b',
      transition_tenant_id: 'tenant-b', transitioned_at: '2026-02-01T00:00:00Z' }));
    h.audits.push(audit({ id: `denied-${i}`, outcome: 'denied', created_at: '2026-02-01T00:00:00Z' }));
  }
  const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items.map(item => item.eventId), ['op-start', 'audit-success']);
  assert.deepEqual(result.body.page, { size: 2, hasMore: false });
  h.ctx.identity.actorType = 'tenant_owner';
  h.queries.length = 0;
  const denied = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'FORBIDDEN');
  assert.equal(denied.body.items, undefined);
  assert.equal(h.queries.length, 0);
});

test('history serializes exactly seven allowlisted fields and no raw secret-bearing payloads', async () => {
  const h = fixture();
  const payload = { password: 'fixture-secret', dsn: 'postgres://fixture-dsn',
    connectionString: 'fixture-connection', host: 'fixture-host', port: 6543 };
  h.database = { ...h.database, ...payload };
  h.operations = [operation({ metadata: payload, error_summary: payload, new_state: payload })];
  h.audits = [audit({ metadata: payload, previous_state: payload,
    new_state: { workspaceId: 'ws-a', status: 201, ...payload } })];
  const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(result.body.items.length, 2);
  for (const item of result.body.items) {
    assert.deepEqual(Object.keys(item).sort(),
      ['actorId', 'correlationId', 'eventId', 'occurredAt', 'outcome', 'source', 'type']);
  }
  assert.doesNotMatch(JSON.stringify(result),
    /password|dsn|connectionString|host|port|new_state|metadata|previous_state|error_summary|fixture-|6543/i);
});

test('a successful rotation with a skipped audit write stays successful and absent from history', async () => {
  const h = fixture();
  h.ctx.rotateWorkspaceDatabaseCredential = async () => ({ rotated: true, password: 'fixture-secret' });
  const result = await LOCAL_HANDLERS.rotateDatabaseCredential(h.ctx);
  assert.equal(result.statusCode, 201);
  const rotationRoute = routes.find(route => route.localHandler === 'rotateDatabaseCredential');
  const warnings = [];
  const auditResult = await recordRouteAudit({ query: async () => { throw new Error('audit unavailable'); } },
    rotationRoute, h.ctx, result, 'rotation-correlation', { warn: line => warnings.push(line) });
  assert.equal(auditResult, null);
  assert.equal(warnings.length, 1);
  assert.equal(result.statusCode, 201);
  const history = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.deepEqual(history.body, { items: [], page: { size: 0, hasMore: false }, completeness: 'best_effort' });
});

test('successful history is unaudited while a handler 403 still records a route denial', async () => {
  const h = fixture();
  const route = routes.find(route => route.path === historyPath);
  assert.equal(route.audit, undefined);
  const result = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  assert.equal(auditEventForRoute(route, h.ctx, result), null);
  const noWrites = { query: () => assert.fail('a successful history read must not write') };
  assert.equal(await recordRouteAudit(noWrites, route, h.ctx, result, 'read-correlation'), null);
  assert.equal(await recordRouteDenial(noWrites, route, h.ctx, result, 'read-correlation'), null);
  h.ctx.identity.tenantId = 'tenant-b';
  const denied = await LOCAL_HANDLERS.getDatabaseHistory(h.ctx);
  const writes = [];
  const db = { async query(sql, values) {
    assert.match(sql, /INSERT INTO scope_enforcement_denials/);
    const columns = sql.match(/scope_enforcement_denials\s*\(([^)]+)\)/)[1].split(',').map(s => s.trim());
    const row = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
    writes.push(row);
    return { rows: [row] };
  } };
  const row = await recordRouteDenial(db, route, h.ctx, denied, 'denied-correlation');
  assert.equal(writes.length, 1);
  assert.equal(row.tenant_id, 'tenant-b');
  assert.equal(row.denial_type, 'ROLE_INSUFFICIENT');
  assert.equal(row.request_path, historyPath);
  assert.equal(row.actor_id, 'owner-a');
  assert.equal(row.correlation_id, 'denied-correlation');
});

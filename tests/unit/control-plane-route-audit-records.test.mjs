import test from 'node:test';
import { fileURLToPath } from 'node:url';
process.env.REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
import assert from 'node:assert/strict';
import { routes } from '../../apps/control-plane/routes.mjs';
import { auditEventForRoute, recordRouteAudit } from '../../apps/control-plane/audit-writer.mjs';

const routeFor = (name) => routes.find((route) => route.localHandler === name);

test('#971: secret replacement records its trusted owning tenant without bodies', async () => {
  for (const actorType of ['tenant_admin', 'superadmin']) {
    const ctx = { identity: { sub: 'actor', actorType, roles: [actorType], tenantId: actorType === 'superadmin' ? null : 'tenant-a' }, params: { workspaceId: 'ws-a' }, body: { tenantId: 'spoofed', value: 'secret-value' } };
    const result = { statusCode: 200, body: { value: 'secret-value' }, auditScope: { tenantId: 'tenant-a', workspaceId: 'ws-a' } };
    const event = auditEventForRoute(routeFor('secretReplace'), ctx, result);
    assert.ok(event, 'secret replacement must produce an audit event');
    assert.equal(event.actionType, 'workspace.secret.replace');
    assert.equal(event.tenantId, 'tenant-a');
    assert.deepEqual(event.newState, { method: 'PUT', path: routeFor('secretReplace').path, status: 200 });
    assert.doesNotMatch(JSON.stringify(event), /secret-value|spoofed/);
  }
});

// Database system boundary: observe the real writer's persisted row.
function auditPool() {
  const rows = [];
  return { rows, async query(sql, values = []) {
    if (/INSERT INTO plan_audit_events/.test(sql)) {
      const [id, action_type, actor_id, tenant_id, previous_state, state, outcome, correlation_id] = values;
      const row = { id, action_type, actor_id, tenant_id, previous_state, new_state: JSON.parse(state), outcome, correlation_id };
      rows.push(row);
      return { rows: [row] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)|pg_advisory_xact_lock|SELECT row_hash/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}

const platform = { sub: 'platform-actor', actorType: 'superadmin' };
test('#971: only an explicit trusted global scope permits a tenantless row', async () => {
  for (const name of ['iamUpdateRealm', 'deleteDatabase']) {
    const db = auditPool();
    const route = routeFor(name);
    assert.equal(await recordRouteAudit(db, route, { identity: platform }, { statusCode: 502 }, 'corr'), null);
    const row = await recordRouteAudit(db, route, { identity: { ...platform, tenantId: 'caller-tenant' } },
      { statusCode: 502, auditScope: { tenantId: null, global: true }, body: { tenantId: 'body-tenant', error: 'secret-error-detail' } }, 'corr');
    assert.ok(row);
    assert.equal(row.tenant_id, null);
    assert.equal(row.outcome, 'error');
    assert.doesNotMatch(JSON.stringify(row), /secret-error-detail|body-tenant|caller-tenant/);
    assert.equal(db.rows.length, 1);
  }
});

test('#971: real secretReplace returns the workspace scope for tenant admin and superadmin', async () => {
  const { FN_HANDLERS } = await import('../../apps/control-plane/fn-handlers.mjs');
  for (const actorType of ['tenant_admin', 'superadmin']) {
    const ctx = {
      identity: { sub: 'actor', actorType, roles: [actorType], tenantId: actorType === 'superadmin' ? null : 'tenant-a' },
      params: { workspaceId: 'ws-a', secretName: 'password' }, body: { value: 'secret-value', tenantId: 'spoofed' },
      pool: {}, store: { getWorkspace: async () => ({ id: 'ws-a', tenant_id: 'tenant-a' }), listFnActions: async () => [] },
      vaultStore: { validName: () => true, exists: async () => true, replace: async () => ({ secretName: 'password' }) }
    };
    const result = await FN_HANDLERS.secretReplace(ctx);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
    const db = auditPool();
    const row = await recordRouteAudit(db, routeFor('secretReplace'), ctx, result, 'corr-secret');
    assert.equal(row.tenant_id, 'tenant-a');
    assert.equal(row.action_type, 'workspace.secret.replace');
    assert.equal(db.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(row), /secret-value|spoofed/);
  }
});

test('#971: superadmin credential rotation carries bucket scope and never records either key', async () => {
  const { STORAGE_HANDLERS } = await import('../../apps/control-plane/storage-handlers.mjs');
  const ctx = { params: { bucketId: 'bucket-a' }, identity: platform,
    pool: { query: async () => ({ rows: [{ bucket_name: 'bucket-a', workspace_id: 'ws-a', tenant_id: 'tenant-a' }] }) },
    seaweedClient: async (method, path, body) => method === 'POST' ? { metadata: { name: body.metadata.name } } : { status: { succeeded: 1 } }
  };
  const result = await STORAGE_HANDLERS.storageRotateCredential(ctx);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
  const { accessKey, secretKey } = result.body.storageCredential;
  assert.ok(accessKey && secretKey);
  const db = auditPool();
  const row = await recordRouteAudit(db, routeFor('storageRotateCredential'), ctx, result, 'corr-storage');
  assert.equal(row.action_type, 'workspace.storage.credential.rotate');
  assert.equal(row.tenant_id, 'tenant-a');
  assert.equal(db.rows.length, 1);
  assert.ok(!JSON.stringify(row).includes(accessKey));
  assert.ok(!JSON.stringify(row).includes(secretKey));
});

test('#971: database lookup outage is a safe 502 audited on the global chain', async () => {
  const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
  const ctx = { identity: platform, params: { workspaceId: 'missing', databaseName: 'db' },
    body: { tenantId: 'spoofed' }, pool: { query: async () => { throw new Error('private-backend-detail'); } } };
  const result = await LOCAL_HANDLERS.deleteDatabase(ctx);
  assert.equal(result.statusCode, 502);
  assert.deepEqual(result.auditScope, { tenantId: null, global: true });
  const db = auditPool();
  const row = await recordRouteAudit(db, routeFor('deleteDatabase'), ctx, result, 'corr-db');
  assert.equal(row.action_type, 'workspace.database.delete');
  assert.equal(row.tenant_id, null);
  assert.equal(row.outcome, 'error');
  assert.doesNotMatch(JSON.stringify(row), /private-backend-detail|spoofed/);
});

test('#971: workspace deletion retains the owning scope on cleanup-pending responses', async () => {
  const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
  const ctx = { identity: platform, params: { workspaceId: 'ws-a' },
    pool: { query: async () => ({ rows: [{ id: 'ws-a', tenant_id: 'tenant-a' }] }) },
    runtimeTeardownCoordinator: { purgeWorkspace: async () => ({ pending: true }) } };
  const result = await LOCAL_HANDLERS.deleteWorkspace(ctx);
  assert.equal(result.statusCode, 202);
  assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
  const db = auditPool();
  const row = await recordRouteAudit(db, routeFor('deleteWorkspace'), ctx, result, 'corr-delete');
  assert.equal(row.action_type, 'workspace.delete');
  assert.equal(row.tenant_id, 'tenant-a');
});

test('#971: realm writes use tenant realm scope or an explicit platform-global scope', async () => {
  const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
  for (const realmId of ['in-falcone-platform', 'tenant-a']) {
    for (const name of ['iamUpdateRealm', 'iamDeleteRole']) {
      const ctx = { identity: platform, params: { realmId, roleName: 'role-a' }, body: { tenantId: 'spoofed' },
        kcAdmin: { setRealmAuthConfig: async () => {}, getRealmAuthConfig: async () => ({}), deleteRealmRole: async () => {} } };
      const result = await LOCAL_HANDLERS[name](ctx);
      assert.equal(result.statusCode, 200);
      const expected = realmId === 'in-falcone-platform' ? { tenantId: null, global: true } : { tenantId: 'tenant-a' };
      assert.deepEqual(result.auditScope, expected);
      const row = await recordRouteAudit(auditPool(), routeFor(name), ctx, result, 'corr-realm');
      assert.equal(row.tenant_id, expected.tenantId);
      assert.doesNotMatch(JSON.stringify(row), /spoofed/);
    }
  }
});

test('#971: workspace and bucket validation failures keep trusted scope for newly audited handlers', async (t) => {
  const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
  const cases = [
    ['cloneWorkspace', { targetTenantId: 'foreign' }, 404],
    ['fnDefinitionImport', { definitions: [] }, 400],
    ['fnPackageDefinitionImport', { definitions: [] }, 400],
    ['mongoDataImport', {}, 400],
    ['pgDataImport', {}, 400],
    ['storageBucketImport', {}, 400],
    ['storageProvisionBucket', {}, 409],
    ['eventsProvisionTopic', { name: '' }, 400],
    ['createExternalApplication', { protocol: 'saml' }, 422],
    ['updateExternalApplication', { protocol: 'saml' }, 422],
    ['createExternalApplicationFederatedProvider', {}, 400],
    ['updateExternalApplicationFederatedProvider', { providerId: 'different' }, 400],
    ['metricsWorkspaceAuditExport', {}, 200],
    ['metricsTenantAuditExport', {}, 200],
    ['storageRevokeCredential', {}, 502]
  ];
  for (const [name, body, expectedStatus] of cases) await t.test(name, async () => {
    const ctx = { identity: platform,
      params: { workspaceId: 'ws-a', bucketId: 'bucket-a', databaseName: 'appdb', schemaName: 'public', tableName: 'table_a', applicationId: 'app-a', providerId: 'provider-a', tenantId: 'tenant-a' }, body, query: {},
      pool: { query: async (sql) => {
        if (/FROM workspaces/.test(sql)) return { rows: [{ id: 'ws-a', tenant_id: 'tenant-a' }] };
        if (/FROM workspace_databases/.test(sql)) return { rows: [{ database_name: 'appdb', workspace_id: 'ws-a', tenant_id: 'tenant-a' }] };
        if (/FROM workspace_buckets/.test(sql)) return { rows: Array.from({ length: 100 }, () => ({ bucket_name: 'bucket-a', workspace_id: 'ws-a', tenant_id: 'tenant-a' })) };
        if (/FROM external_applications/.test(sql)) return { rows: [{ id: 'app-a', workspace_id: 'ws-a', tenant_id: 'tenant-a', app_json: { applicationId: 'app-a', protocol: 'oidc', federatedProviders: [{ providerId: 'provider-a' }] } }] };
        return { rows: [] };
      } }, seaweedClient: async () => { throw new Error('fixture-downstream-unavailable'); }
    };
    if (name === 'metricsTenantAuditExport') delete ctx.params.workspaceId;
    const result = await LOCAL_HANDLERS[name](ctx);
    assert.equal(result.statusCode, expectedStatus, JSON.stringify(result));
    assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', ...(name === 'metricsTenantAuditExport' ? {} : { workspaceId: 'ws-a' }) });
    const row = await recordRouteAudit(auditPool(), routeFor(name), ctx, result, 'corr-validation');
    assert.equal(row.tenant_id, 'tenant-a');
  });
});

test('#971: export handlers and bucket deletion retain scope even on backend failures', async (t) => {
  const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fixture-backend-down'); });
  for (const name of ['pgDataExport', 'mongoDataExport', 'storageBucketExport', 'storageDeleteBucket']) {
    const ctx = { identity: platform, params: { workspaceId: 'ws-a', bucketId: 'bucket-a', databaseName: 'appdb', schemaName: 'public', tableName: 'table_a' }, body: {},
      pool: { query: async (sql) => ({ rows: /FROM workspaces/.test(sql) ? [{ id: 'ws-a', tenant_id: 'tenant-a' }]
        : /FROM workspace_databases/.test(sql) ? [{ database_name: 'appdb', workspace_id: 'ws-a', tenant_id: 'tenant-a' }]
        : /FROM workspace_buckets/.test(sql) ? [{ bucket_name: 'bucket-a', workspace_id: 'ws-a', tenant_id: 'tenant-a' }] : [] }) },
      pgClient: { query: async () => { throw new Error('fixture-backend-down'); } }, mongoClient: { db() { throw new Error('fixture-backend-down'); } } };
    const result = await LOCAL_HANDLERS[name](ctx);
    assert.equal(result.statusCode, 502, name);
    assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' }, name);
  }
});

test('#971: tenant export and service account deletion return loaded ownership', async () => {
  const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');
  const tenantCtx = { identity: platform, params: { tenantId: 'tenant-a' }, pool: { query: async (sql) => ({ rows: /FROM tenants/.test(sql) ? [{ id: 'tenant-a' }] : [] }) } };
  const exported = await LOCAL_HANDLERS.exportTenantConfiguration(tenantCtx);
  assert.equal(exported.statusCode, 200);
  assert.deepEqual(exported.auditScope, { tenantId: 'tenant-a' });
  const ctx = { identity: platform, params: { workspaceId: 'ws-a', serviceAccountId: 'sa-a' }, pool: {},
    store: { getWorkspace: async () => ({ id: 'ws-a', tenant_id: 'tenant-a' }), getTenant: async () => ({ id: 'tenant-a', iam_realm: 'tenant-a' }),
      getServiceAccount: async () => ({ id: 'sa-a', tenant_id: 'tenant-a', workspace_id: 'ws-a' }), deleteServiceAccount: async () => {} },
    kcAdmin: { deleteClient: async () => {} } };
  const deleted = await LOCAL_HANDLERS.deleteServiceAccount(ctx);
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
});

test('#971: docs note POST, PUT and DELETE return auth scope and their distinct audit types', async () => {
  const { main } = await import('../../packages/workspace-docs-service/actions/workspace-docs.mjs');
  const notes = new Map();
  const db = { query: async (sql, values) => {
    if (sql.includes('INSERT INTO')) {
      const row = { id: 'note-a', content: values[2], author_id: values[3], created_at: '2026-01-01', updated_at: '2026-01-01' };
      notes.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }
    const row = notes.get(values[2]);
    if (!row) return { rows: [], rowCount: 0 };
    if (sql.includes('deleted_at = now()')) notes.delete(row.id);
    else row.content = values[3];
    return { rows: [row], rowCount: 1 };
  } };
  for (const [method, status, suffix] of [['POST', 201, 'create'], ['PUT', 200, 'update'], ['DELETE', 204, 'delete']]) {
    const route = routes.find((r) => r.module?.endsWith('workspace-docs.mjs') && r.method === method);
    const result = await main({ method, path: '/v1/workspaces/ws-a/docs/notes' + (method === 'POST' ? '' : '/note-a'),
      auth: { tenantId: 'tenant-a', workspaceId: 'ws-a', actorId: 'actor', roles: ['workspace_admin'] }, body: { content: 'private-note-body', tenantId: 'spoofed' }, db });
    assert.equal(result.statusCode, status);
    assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
    const row = await recordRouteAudit(auditPool(), route, { identity: platform }, result, 'corr-docs');
    assert.equal(row.action_type, `workspace.docs.note.${suffix}`);
    assert.equal(row.tenant_id, 'tenant-a');
    assert.doesNotMatch(JSON.stringify(row), /private-note-body|spoofed/);
  }
});

test('#971: object writes and auth sessions are exempt, while audited 403s record denied', async () => {
  for (const name of ['storagePutObject', 'login']) {
    const db = auditPool();
    assert.equal(await recordRouteAudit(db, routeFor(name), { identity: { tenantId: 'tenant-a' } },
      { statusCode: 201, auditScope: { tenantId: 'tenant-a', workspaceId: 'ws-a' } }, 'corr'), null);
    assert.equal(db.rows.length, 0);
  }
  const row = await recordRouteAudit(auditPool(), routeFor('secretReplace'), { identity: platform },
    { statusCode: 403, auditScope: { tenantId: 'tenant-a', workspaceId: 'ws-a' } }, 'corr-denied');
  assert.equal(row.outcome, 'denied');
});

test('#971: HTTP module dispatch writes exactly once from module auditScope; exemptions and audit failure preserve response', async (t) => {
  const { startDenialServer } = await import('../blackbox/helpers/authorization-denial-server.mjs');
  for (const mode of ['audited', 'exempt', 'unavailable']) {
    const db = auditPool();
    const warnings = [];
    if (mode === 'unavailable') db.query = async () => { throw new Error('audit database unavailable'); };
    t.mock.method(console, 'warn', (line) => warnings.push(line));
    const server = await startDenialServer({ auditDb: db, extraRoutes: [{
      method: 'POST', path: '/audit-module', auth: 'authenticated', invoke: 'params-only', export: 'main',
      module: fileURLToPath(new URL('../fixtures/route-audit-module.mjs', import.meta.url)),
      audit: mode === 'exempt' ? { exempt: 'fixture exemption' } : 'workspace.docs.note.create'
    }] });
    const response = await server.request('/audit-module', { method: 'POST', body: '{"tenantId":"spoofed"}', correlationId: 'corr-module-audit' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response.status, 201, response.body);
    assert.equal(db.rows.length, mode === 'audited' ? 1 : 0);
    if (mode === 'audited') {
      assert.equal(db.rows[0].action_type, 'workspace.docs.note.create');
      assert.equal(db.rows[0].tenant_id, 'module-tenant');
      assert.equal(db.rows[0].new_state.workspaceId, 'module-workspace');
      assert.equal(db.rows[0].correlation_id, 'corr-module-audit');
      assert.doesNotMatch(JSON.stringify(db.rows), /private-module-body|spoofed/);
    }
    if (mode === 'unavailable') assert.equal(warnings.length, 1);
    t.mock.restoreAll();
    await server.close();
  }
});

test('#971: platform-path webhook secret rotation records scope without signing material', async () => {
  const { webhookManage } = await import('../../apps/control-plane/webhook-handlers.mjs');
  const { TEST_WEBHOOK_KEY_CONTEXT } = await import('../helpers/webhook-key.mjs');
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const ctx = { identity: { sub: 'actor', actorType: 'tenant_admin', tenantId: 'tenant-a', workspaceId: 'ws-a' },
    params: { subscriptionId }, req: { method: 'POST', url: `/v1/webhooks/subscriptions/${subscriptionId}/rotate-secret` },
    body: { tenantId: 'spoofed', secret: 'private-request-secret' }, pool: {}, webhookRuntimePool: { query() {} }, webhookWritePool: { query() {} } };
  const result = await webhookManage(ctx, { keyContext: TEST_WEBHOOK_KEY_CONTEXT, buildDb: () => ({
    getSubscription: async () => ({ id: subscriptionId, tenant_id: 'tenant-a', workspace_id: 'ws-a' }), rotateSecret: async () => {}
  }) });
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.newSigningSecret);
  assert.deepEqual(result.auditScope, { tenantId: 'tenant-a', workspaceId: 'ws-a' });
  const route = routes.find((r) => r.path === '/v1/webhooks/subscriptions/{subscriptionId}/rotate-secret');
  const db = auditPool();
  const row = await recordRouteAudit(db, route, ctx, result, 'corr-webhook');
  assert.equal(row.action_type, 'webhook.subscription.rotate-secret');
  assert.equal(row.tenant_id, 'tenant-a');
  assert.equal(db.rows.length, 1);
  assert.ok(!JSON.stringify(row).includes(result.body.newSigningSecret));
  assert.doesNotMatch(JSON.stringify(row), /private-request-secret|spoofed/);
});

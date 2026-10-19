import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from '../../apps/control-plane/routes.mjs';
import * as writer from '../../apps/control-plane/audit-writer.mjs';
import * as store from '../../apps/control-plane/audit-store.mjs';

// Public seed-route contract: every mutation declares how it is audited (#971).
test('#971: seed routes have complete, valid audit coverage', () => {
  assert.equal(typeof writer.validateRouteAuditCoverage, 'function');
  assert.doesNotThrow(() => writer.validateRouteAuditCoverage(routes));
});

// Literal compatibility table from the pre-#971 writer; never derive from routes.
const legacyTypes = {
  "createTenant": "tenant.create",
  "deleteTenant": "tenant.delete",
  "purgeTenant": "tenant.purge",
  "createTenantUser": "tenant.user.create",
  "setAuthConfig": "tenant.auth-config.update",
  "setSocialProvider": "tenant.social-provider.upsert",
  "deleteSocialProvider": "tenant.social-provider.delete",
  "createWorkspace": "workspace.create",
  "promoteWorkspace": "workspace.promote",
  "createServiceAccount": "workspace.service-account.create",
  "createWorkspaceIamClient": "workspace.iam-client.create",
  "issueCredential": "workspace.service-account.credential.issue",
  "rotateCredential": "workspace.service-account.credential.rotate",
  "revokeCredential": "workspace.service-account.credential.revoke",
  "provisionDatabase": "workspace.database.provision",
  "provisionDatabaseGeneric": "workspace.database.provision",
  "deleteDatabase": "workspace.database.delete",
  "rotateDatabaseCredential": "workspace.database.credential.rotate",
  "registerFunction": "workspace.function.register",
  "iamCreateUser": "iam.user.create",
  "iamDeleteUser": "iam.user.delete",
  "iamSetUserStatus": "iam.user.status",
  "iamCreateRole": "iam.role.create",
  "iamCreateGroup": "iam.group.create",
  "iamAssignUserRoles": "iam.user.role-assign",
  "iamRemoveUserRoles": "iam.user.role-remove",
  "iamAddUserToGroup": "iam.user.group-add",
  "iamRemoveUserFromGroup": "iam.user.group-remove",
  "secretSet": "workspace.secret.set",
  "secretGet": "workspace.secret.get",
  "secretList": "workspace.secret.list",
  "secretDelete": "workspace.secret.delete",
  "fnDeploy": "workspace.function.deploy",
  "fnDelete": "workspace.function.delete",
  "fnInvoke": "workspace.function.invoke",
  "fnRollback": "workspace.function.rollback",
  "fnActivationRerun": "workspace.function.activation.rerun"
};
test('#971: all 37 legacy handler mappings retain their exact action types', () => {
  assert.equal(Object.keys(legacyTypes).length, 37);
  for (const [handler, type] of Object.entries(legacyTypes)) {
    const matching = routes.filter((route) => route.localHandler === handler);
    assert.ok(matching.length, handler);
    for (const route of matching) assert.equal(route.audit, type, `${route.method} ${route.path}`);
  }
});

test('#971: validation names offending routes for all invalid metadata forms', () => {
  const invalid = [
    [undefined, 'missing audit'],
    ...['', 'Bad.type', 'single', 'a.b_underscore', 'a.' + 'b'.repeat(63)].map((type) => [type, 'invalid audit type']),
    ['unknown.action', 'audit type has no explicit category'],
    ...[{ exempt: '' }, { self: '  ' }, { self: 1 }, {}, { self: 'x', exempt: 'y' }]
      .map((audit) => [audit, 'invalid self/exempt audit reason'])
  ];
  for (const [audit, reason] of invalid) {
    const route = { method: 'POST', path: '/invalid-route', audit };
    assert.throws(() => writer.validateRouteAuditCoverage([route]), (error) => {
      assert.match(error.message, /POST \/invalid-route/);
      assert.ok(error.message.includes(reason), error.message);
      return true;
    });
  }
  assert.doesNotThrow(() => writer.validateRouteAuditCoverage([
    { method: 'GET', path: '/read' },
    { method: 'POST', path: '/self', audit: { self: 'transaction recorder' } },
    { method: 'DELETE', path: '/exempt', audit: { exempt: 'data-plane' } }
  ]));
  assert.throws(() => writer.validateRouteAuditCoverage([
    { method: 'POST', path: '/one' }, { method: 'DELETE', path: '/two' }
  ]), /POST \/one.*DELETE \/two/);
});

test('#971: every string type has an explicit schema category, including seven legacy defaults', () => {
  const schema = JSON.parse(readFileSync(new URL('../../packages/internal-contracts/src/observability-audit-event-schema.json', import.meta.url)));
  for (const route of routes.filter((route) => typeof route.audit === 'string')) {
    assert.ok(Object.hasOwn(store.ACTION_CATEGORY_BY_TYPE, route.audit), route.audit);
    assert.ok(schema.action.categories.includes(store.ACTION_CATEGORY_BY_TYPE[route.audit]), route.audit);
  }
  for (const type of ['workspace.iam-client.create', 'workspace.database.delete', 'workspace.function.deploy', 'workspace.function.delete', 'workspace.function.invoke', 'workspace.function.rollback', 'workspace.function.activation.rerun']) {
    assert.equal(store.ACTION_CATEGORY_BY_TYPE[type], 'configuration_change', type);
  }
});

test('#971: exemptions are exactly the 13 D1 routes', () => {
  assert.deepEqual(routes.filter((route) => route.audit?.exempt).map((route) => route.localHandler).sort(), [
    'storagePutObject', 'storageDeleteObject', 'storagePresignObject', 'storageMultipartInitiate',
    'storageMultipartUploadPart', 'storageMultipartComplete', 'storageMultipartAbort',
    'eventsWorkspaceTopicPublish', 'eventsTopicPublish', 'login', 'signup', 'refresh', 'logout'
  ].sort());
});

test('#971: self-recorded routes name a recorder present in their source', () => {
  const self = routes.filter((route) => route.audit?.self);
  assert.equal(self.length, 10);
  for (const route of self) {
    let file, recorder;
    if (route.module) {
      file = route.module.replace('/repo/', '../../');
      recorder = /appendPlanAudit\(/;
      assert.match(route.audit.self, /appendPlanAudit/);
    } else if (route.localHandler === 'productQuotaDecision') {
      file = '../../apps/control-plane/product-quota.mjs';
      recorder = /await recordQuotaEnforcement\(/;
      assert.match(route.audit.self, /recordQuotaEnforcement/);
      assert.match(readFileSync(new URL('../../apps/control-plane/audit-writer.mjs', import.meta.url), 'utf8'), /INSERT INTO quota_enforcement_log/);
    } else if (route.localHandler === 'recordScopeEnforcementDenial') {
      file = '../../apps/control-plane/b-handlers.mjs';
      recorder = /await recordScopeDenial\(/;
      assert.match(readFileSync(new URL('../../apps/control-plane/audit-writer.mjs', import.meta.url), 'utf8'), /INSERT INTO scope_enforcement_denials/);
      assert.match(route.audit.self, /scope_enforcement_denials/);
    } else {
      file = '../../apps/control-plane/invitation-handlers.mjs';
      recorder = /await audit\(/;
      assert.match(route.audit.self, /audit\(/);
    }
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    if (route.module) assert.match(source, recorder);
    else {
      const start = source.indexOf(`async function ${route.localHandler}(`);
      assert.ok(start >= 0, route.localHandler);
      assert.match(source.slice(start, source.indexOf('\n}', start)), recorder);
    }
  }
});

test('#971: route loading rejects seed gaps and reports extra gaps only when requested at startup', async () => {
  const { startDenialServer } = await import('../blackbox/helpers/authorization-denial-server.mjs');
  await assert.rejects(startDenialServer({ seed: [{ method: 'POST', path: '/seed-gap', localHandler: 'fake' }] }), /POST \/seed-gap/);
  const server = await startDenialServer();
  const route = { method: 'POST', path: '/extra-gap', module: 'unused' };
  // The actual loader is exposed by the source-only HTTP harness.
  server.loadRoutes([route, route]);
  server.loadRoutes([route]);
  assert.equal(server.warnings.filter((line) => line.includes('/extra-gap')).length, 0,
    'embedded route loading must not emit process-startup diagnostics');
  server.loadRoutes([route, route], { warnUnaudited: true });
  server.loadRoutes([route], { warnUnaudited: true });
  const warnings = server.warnings.filter((line) => line.includes('/extra-gap'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unaudited/);
  await server.close();
});

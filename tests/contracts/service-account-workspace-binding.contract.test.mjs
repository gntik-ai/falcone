import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthorizationModel } from '../../packages/internal-contracts/src/index.mjs';
import { TENANT_REALM_ROLES, WORKSPACE_ID_MAPPER } from '../../apps/control-plane/kc-admin.mjs';

test('workspace SA catalog, unchanged 13-action grant and tenant realm provisioning agree', () => {
  const model = readAuthorizationModel();
  const role = model.role_catalog.workspace.find(role => role.id === 'workspace_service_account');
  assert.equal(role.scope, 'workspace');
  const grants = model.permission_matrix.workspace.filter(entry => entry.role === 'workspace_service_account');
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].allowed_actions, [
    'workspace.read', 'database.read', 'database.write', 'bucket.read', 'bucket.write',
    'topic.read', 'topic.publish', 'topic.consume', 'function.read', 'function.invoke',
    'app.read', 'service_account.read', 'database.rpc.execute',
  ]);
  assert.ok(TENANT_REALM_ROLES.includes('workspace_service_account'));
});

test('workspace mapper contract is singular, hardcoded and string-valued in all three token surfaces', () => {
  assert.deepEqual(WORKSPACE_ID_MAPPER, {
    name: 'workspace_id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
    config: { 'claim.name': 'workspace_id', 'jsonType.label': 'String',
      'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' },
  });
});

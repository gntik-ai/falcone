import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = JSON.parse(readFileSync(new URL('../../apps/control-plane-executor/openapi/control-plane.openapi.json', import.meta.url), 'utf8'));

test('tenant purge and workspace deletion publish secret destruction, disabled-backend disclosure, and recoverable failure', () => {
  for (const [path, method, completed] of [
    ['/v1/tenants/{tenantId}/purge', 'post', 'TenantPurgeCompleted'],
    ['/v1/workspaces/{workspaceId}', 'delete', 'WorkspaceDeleteCompleted'],
  ]) {
    const op = api.paths[path][method];
    assert.equal(op.responses['502']?.content['application/json'].schema.$ref, '#/components/schemas/SecretTeardownIncomplete');
    const properties = api.components.schemas[completed].properties;
    assert.equal(properties.removed.properties.secrets.type, 'array');
    assert.equal(properties.removed.properties.secrets.items.type, 'string');
    assert.equal(properties.residual.properties.secrets.items.type, 'string');
    assert.equal(properties.residual.properties.secretsBackend.const, 'disabled');
  }
  const error = api.components.schemas.SecretTeardownIncomplete;
  assert.equal(error.properties.code.const, 'SECRET_TEARDOWN_INCOMPLETE');
  assert.equal(error.properties.residual.properties.secrets.items.type, 'string');
});

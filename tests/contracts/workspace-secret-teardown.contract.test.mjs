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

test('published tenant and workspace family contracts disclose secret teardown completion and failure', () => {
  for (const [family, path, method, completed] of [
    ['tenants', '/v1/tenants/{tenantId}/purge', 'post', 'TenantPurgeCompleted'],
    ['workspaces', '/v1/workspaces/{workspaceId}', 'delete', 'WorkspaceDeleteCompleted'],
  ]) {
    const document = JSON.parse(readFileSync(new URL(`../../apps/control-plane-executor/openapi/families/${family}.openapi.json`, import.meta.url), 'utf8'));
    const responses = document.paths[path][method].responses;
    assert.equal(responses['200'].content['application/json'].schema.$ref, `#/components/schemas/${completed}`);
    assert.equal(responses['502']?.content['application/json'].schema.$ref, '#/components/schemas/SecretTeardownIncomplete', family);
    const properties = document.components.schemas[completed].properties;
    for (const field of ['removed', 'residual']) {
      assert.equal(properties[field].properties.secrets.type, 'array');
      assert.equal(properties[field].properties.secrets.items.type, 'string');
      assert.ok(properties[field].required.includes('secrets'));
    }
    assert.equal(properties.residual.properties.secretsBackend.const, 'disabled');
    const error = document.components.schemas.SecretTeardownIncomplete;
    assert.equal(error.properties.code.const, 'SECRET_TEARDOWN_INCOMPLETE');
    assert.equal(error.properties.residual.properties.secrets.items.type, 'string');
    assert.equal(error.properties.residual.properties.secrets.minItems, 1);
  }
});

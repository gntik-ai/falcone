import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

for (const file of ['families/workspaces.openapi.json', 'control-plane.openapi.json']) {
  test(`${file}: provider secret ref contract accepts one confined reference form`, () => {
    const document = JSON.parse(readFileSync(new URL(`../../apps/control-plane-executor/openapi/${file}`, import.meta.url)));
    const schema = document.components.schemas.ByokProviderSecretRef;
    assert.ok(schema, 'shared LLM/embedding secret reference schema is published');
    const validate = new Ajv().compile(schema);
    for (const ref of [{ name: 'BYOK_OPENAI' }, { workspaceSecret: 'openai-key' }]) assert.equal(validate(ref), true);
    for (const ref of [{}, { name: 'BYOK_OPENAI', workspaceSecret: 'openai-key' },
      { workspaceSecret: '../key' }, { workspaceSecret: 'a/b' }, { workspaceSecret: 'UPPER' },
      { workspaceSecret: 'a'.repeat(64) }, { workspaceSecret: 'key', tenantId: 'forged' }]) {
      assert.equal(validate(ref), false, JSON.stringify(ref));
    }
    for (const path of ['/v1/workspaces/{workspaceId}/llm-provider', '/v1/workspaces/{workspaceId}/embedding-provider']) {
      const config = document.paths[path].put.requestBody.content['application/json'].schema;
      assert.equal(document.components.schemas[config.$ref.split('/').at(-1)].properties.secretRef.$ref,
        '#/components/schemas/ByokProviderSecretRef');
    }
  });
}

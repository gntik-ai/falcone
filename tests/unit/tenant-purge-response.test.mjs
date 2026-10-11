import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const path of ['families/tenants.openapi.json', 'control-plane.openapi.json']) {
  test(`tenant purge contract admits retryable database cleanup errors (${path})`, () => {
    const document = JSON.parse(readFileSync(new URL(`../../apps/control-plane-executor/openapi/${path}`, import.meta.url)));
    const response = document.paths['/v1/tenants/{tenantId}/purge'].post.responses['503'];
    const variants = response.content['application/json'].schema.oneOf ?? [response.content['application/json'].schema];
    const codes = variants.map((variant) => document.components.schemas[variant.$ref.split('/').at(-1)].properties.code.const);
    assert.ok(codes.includes('TENANT_PURGE_INCOMPLETE'), '503 must admit database cleanup failures');
    assert.ok(codes.includes('RUNTIME_TEARDOWN_UNAVAILABLE'), 'runtime safety gate remains documented');
    assert.match(response.description, /retry/i);
  });
}

for (const path of ['families/tenants.openapi.json', 'control-plane.openapi.json']) {
  test(`tenant purge contract discloses database residue and unknown counts (${path})`, () => {
    const document = JSON.parse(readFileSync(new URL(`../../apps/control-plane-executor/openapi/${path}`, import.meta.url)));
    const schema = document.components.schemas.TenantPurgeCompleted.properties.residual;
    const entry = schema.properties.databaseTables?.items;
    assert.ok(entry, 'database table residual must be part of the response contract');
    assert.deepEqual(entry.required, ['table', 'count']);
    assert.deepEqual(entry.properties.count.type, ['integer', 'null']);
    assert.match(entry.properties.count.description, /unknown|cannot/i);
    assert.deepEqual(schema.required, ['knativeServices', 'secrets']);
  });
}

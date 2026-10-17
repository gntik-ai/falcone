import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import catalog, { catalogVersion, entries } from '../../apps/control-plane-executor/src/runtime/llm-adapters/model-catalog.mjs';

// Independent ModelEntry capability/lifecycle contract; unknown values are nullable.
const nullableBoolean = { type: ['boolean', 'null'] };
const nullableLimit = { type: ['integer', 'null'], minimum: 1 };
const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    displayName: { type: ['string', 'null'] },
    sourceUrl: { type: 'string', pattern: '^https://[^/]+/.+' },
    capabilities: {
      type: 'object', additionalProperties: false,
      properties: {
        contextWindow: nullableLimit, maxOutputTokens: nullableLimit,
        streaming: nullableBoolean, structuredOutput: nullableBoolean, toolUse: nullableBoolean,
        batch: nullableBoolean, promptCaching: nullableBoolean,
        inputModalities: { type: ['array', 'null'], items: { type: 'string' } },
        pricingRef: { type: ['string', 'null'] },
      },
    },
    lifecycle: {
      type: 'object', additionalProperties: false,
      properties: {
        state: { enum: ['active', 'deprecated', 'retired', null] },
        retiresAt: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$' },
      },
    },
  },
};
const validate = new Ajv({ strict: true }).compile(schema);
function assertCatalog(value) {
  assert.equal(typeof value.catalogVersion, 'string');
  assert.ok(value.catalogVersion.length > 0);
  assert.ok(value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries));
  for (const models of Object.values(value.entries)) {
    for (const [modelId, entry] of Object.entries(models)) {
      assert.match(modelId, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
      assert.ok(validate(entry), JSON.stringify(validate.errors));
      const values = [entry.displayName, ...Object.values(entry.capabilities ?? {}), ...Object.values(entry.lifecycle ?? {})];
      if (values.some(value => value != null)) assert.ok(entry.sourceUrl, `${modelId} needs a provider citation`);
      if (entry.lifecycle?.retiresAt != null) assert.ok(Number.isFinite(Date.parse(entry.lifecycle.retiresAt)));
    }
  }
}

test('shipped catalog is frozen, schema-valid and cites every known value; empty is valid', () => {
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(entries));
  assert.equal(catalog.catalogVersion, catalogVersion);
  assert.equal(catalog.entries, entries);
  assertCatalog(catalog);
  assertCatalog({ catalogVersion: 'empty-fixture', entries: {} });
});

test('catalog contract rejects uncited values and malformed metadata', () => {
  const fixture = entry => ({ catalogVersion: 'fixture', entries: { fixture: { 'example-model': entry } } });
  assert.throws(() => assertCatalog(fixture({ capabilities: { streaming: true } })), /citation/);
  assert.throws(() => assertCatalog(fixture({ capabilities: { streaming: 'yes' }, sourceUrl: 'https://provider.example/models' })));
  assert.throws(() => assertCatalog(fixture({ lifecycle: { state: 'obsolete' }, sourceUrl: 'https://provider.example/models' })));
  assert.throws(() => assertCatalog(fixture({ capabilities: { maxOutputTokens: -1 }, sourceUrl: 'https://provider.example/models' })));
  assertCatalog(fixture({ capabilities: { streaming: null }, lifecycle: { state: null } }));
});

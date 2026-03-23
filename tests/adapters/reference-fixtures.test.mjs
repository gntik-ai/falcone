import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixtureIndex, readReferenceDataset, readTestingStrategy } from '../../scripts/lib/testing-strategy.mjs';

test('adapter integration scenarios are anchored to reusable adapter fixtures', () => {
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const fixtureIndex = buildFixtureIndex(dataset);
  const scenarios = strategy.cross_domain_matrix.scenarios.filter((scenario) => scenario.level === 'adapter_integration');

  assert.equal(scenarios.length >= 2, true);
  assert.equal(scenarios.some((scenario) => scenario.domain === 'data'), true);
  assert.equal(scenarios.some((scenario) => scenario.domain === 'events'), true);

  for (const scenario of scenarios) {
    assert.equal(
      scenario.fixtures.some((fixtureId) => fixtureIndex.get(fixtureId)?.section === 'adapters'),
      true,
      `${scenario.id} should reference at least one adapter fixture`
    );
  }
});

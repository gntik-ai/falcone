import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectTestingStrategyViolations,
  readReferenceDataset,
  readTestingStrategy
} from '../../scripts/lib/testing-strategy.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';

test('testing strategy package remains internally consistent', () => {
  const violations = collectTestingStrategyViolations(
    readTestingStrategy(),
    readReferenceDataset(),
    readJson(OPENAPI_PATH)
  );

  assert.deepEqual(violations, []);
});

test('collectTestingStrategyViolations flags missing layers, fixtures, and console states', () => {
  const strategy = {
    pyramid: [{ level: 'unit', purpose: '', why_now: '' }],
    cross_domain_matrix: {
      domains: [{ id: 'console' }],
      scenarios: [
        {
          id: 'bad-id',
          level: 'unit',
          domain: 'console',
          taxonomy: 'positive',
          fixtures: ['missing-fixture']
        }
      ]
    },
    scenario_taxonomy: {
      categories: [{ id: 'positive' }]
    },
    console: {
      states: [{ id: 'unauthenticated', visible_sections: [], blocked_sections: [], allowed_actions: [] }]
    },
    api_contract: {
      uri_prefix: '/v2/',
      version_header: { name: 'X-Other-Version', current_value: '' },
      required_error_contracts: true
    }
  };

  const dataset = {
    tenants: [],
    users: [],
    workspaces: [],
    adapters: [],
    api_versions: [],
    events: [],
    resilience_cases: [],
    console_routes: []
  };

  const violations = collectTestingStrategyViolations(strategy, dataset, {
    openapi: '3.1.0',
    info: { version: '0.1.0' },
    paths: {
      '/v1/example': {
        get: {
          operationId: 'getExample',
          parameters: [],
          responses: {
            '200': { description: 'ok' }
          }
        }
      }
    }
  });

  assert.ok(violations.some((violation) => violation.includes('missing level adapter_integration')));
  assert.ok(violations.some((violation) => violation.includes('Scenario id bad-id')));
  assert.ok(violations.some((violation) => violation.includes('unknown fixture missing-fixture')));
  assert.ok(violations.some((violation) => violation.includes('console states are missing platform_admin')));
  assert.ok(violations.some((violation) => violation.includes('uri_prefix must be /v1/')));
});

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

test('EventSource header exemption is bounded by path, operation id and GET method', () => {
  const path = '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes';
  for (const change of ['path', 'operationId', 'method']) {
    const document = readJson(OPENAPI_PATH);
    const operation = document.paths[path].get;
    if (change === 'path') {
      delete document.paths[path];
      document.paths[`${path}/extra`] = { get: operation };
    } else if (change === 'operationId') {
      operation.operationId = 'streamOtherChanges';
    } else {
      document.paths[path] = { post: operation };
    }
    const violations = collectTestingStrategyViolations(readTestingStrategy(), readReferenceDataset(), document);
    assert.ok(violations.some((violation) => violation.includes('must require X-API-Version')), change);
  }
});

test('EventSource exemption retains error contract requirements', () => {
  const document = readJson(OPENAPI_PATH);
  document.paths['/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes'].get.responses = {
    '200': { description: 'stream' }
  };
  const violations = collectTestingStrategyViolations(readTestingStrategy(), readReferenceDataset(), document);
  assert.deepEqual(violations, [
    'GET /v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes in OpenAPI must declare an error contract to match strategy expectations.'
  ]);
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
